import type { Hex } from '@keel/schemas';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { config } from '@/config';
import { proposals, useData } from '@/data';
import { tokenToCents } from '@/data/amounts';
import { exporterRejects, exporterSigns } from '@/data/proposalFlow';
import {
  CHECK_WORDS,
  checkForExporter,
  incotermText,
  SIGNING_NOT_SET_UP,
  signingSetup,
  type OrderCheck,
} from '@/data/signOrder';
import { useT } from '@/i18n';
import { useSession } from '@/session';
import { Avatar } from '@/ui/Avatar';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { formatDay, formatMinor } from '@/ui/format';
import { MoneySteps } from '@/ui/MoneySteps';
import { PayoutPanel } from '@/ui/PayoutPanel';
import { Text } from '@/ui/Text';
import { colors } from '@/ui/theme';

import { Bullet, Frame, Row, StatusView } from './parts';

// 10a Exporter: review and sign the order. The importer proposed it and the exporter signs first.
// Reject is the default; Sign waits for the checks, the box and the escrow address.
export function ExporterReview({ orderId }: { orderId: Hex }) {
  const t = useT();
  const { signer, address } = useSession();
  const view = useData(async (d) => {
    const proposal = await proposals.get(orderId);
    if (!proposal) return null;
    const { po } = proposal;
    const [importer, carrier, arbiter, account, suppliers] = await Promise.all([
      d.partyByAddress(po.importer),
      d.partyByAddress(po.carrier),
      d.partyByAddress(po.arbiter),
      d.account('exporter'),
      d.verifiedSuppliers(),
    ]);
    const registered = suppliers.find((s) => s.party.id === account.party);
    const holder = suppliers.find((s) => s.payoutAddress.toLowerCase() === po.payoutAddress.toLowerCase())?.party;
    return importer && carrier && arbiter ? { proposal, importer, carrier, arbiter, registeredPayout: registered?.payoutAddress, holder } : null;
  }, [orderId, address]);

  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [failed, setFailed] = useState<OrderCheck[]>([]);
  const [problem, setProblem] = useState<string>();

  if (view === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (view === null) return <Frame label={t('Order')}><Text color="textMuted">{t('This order is not on this phone.')}</Text></Frame>;
  const { proposal, importer, carrier, arbiter, registeredPayout, holder } = view;
  const { po, terms } = proposal;

  // Not waiting for this signature any more: say where the order is
  if (proposal.status !== 'awaiting_exporter') {
    const words = {
      awaiting_importer: [t('You signed'), t('It is with {name} for the last signature. Nothing is paid until they sign and the escrow opens.', { name: importer.short }), 'done'],
      signed: [t('Signed by both'), t('The order waits to be opened in the escrow.'), 'done'],
      rejected: [t('You rejected this order'), t('{name} sees it as rejected. Nothing was signed or paid.', { name: importer.short }), 'no'],
    } as const;
    const [title, text, tone] = words[proposal.status as keyof typeof words];
    return <StatusView label={proposal.label} title={title} text={text} tone={tone} goods={proposal.goods || proposal.label} onDone={() => router.replace('/home')} />;
  }

  const setup = signingSetup(config);
  const checks = address
    ? checkForExporter(proposal, proposal.proposed, { exporter: address, registeredPayout, now: Date.now() / 1000, escrow: setup?.escrow })
    : (['wrong_exporter'] as OrderCheck[]);
  const canSign = !!setup && !!signer && checks.length === 0 && ticked && !busy;

  const total = tokenToCents(po.totalAmount);
  const advanceUnits = (po.totalAmount * BigInt(po.advanceBps)) / 10_000n;
  const advance = tokenToCents(advanceUnits);
  const balance = tokenToCents(po.totalAmount - advanceUnits);
  const deadline = formatDay(po.shipmentDeadline);
  const own = !!registeredPayout && registeredPayout.toLowerCase() === po.payoutAddress.toLowerCase();

  async function sign() {
    if (!canSign || !setup || !signer) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const move = await exporterSigns(proposals, proposal, { signer, setup, registeredPayout, now: Date.now() / 1000 });
      if (!move.ok) setFailed(move.checks);
    } catch {
      setProblem(t('The wallet could not sign. Try again.'));
    }
    setBusy(false);
  }

  const help = !setup
    ? t(SIGNING_NOT_SET_UP)
    : checks.length > 0
      ? t('Fix the problems above, or reject the order.')
      : !ticked
        ? t('Tick the box above to sign with your wallet.')
        : t('Signs with your wallet. Nothing is paid yet.');

  return (
    <Frame label={proposal.label}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Avatar name={importer.name} tint={importer.tint} size={36} />
          <Text size={15} color="textMuted" style={{ flex: 1 }}>
            {t('{name} asks you to sign first', { name: importer.name })}
          </Text>
        </View>
        <Text size={28} weight={800} leading={1.15} accessibilityRole="header">
          {proposal.goods || t('Order {label}', { label: proposal.label })}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text mono size={44} weight={600} tracking={-1.6}>
            {formatMinor(total)}
          </Text>
          <Text size={16} weight={700} color="textMuted">
            {terms.currency}
          </Text>
        </View>
      </View>

      <MoneySteps
        title={t('When you get paid')}
        steps={[
          po.advanceBps > 0
            ? { title: t('{name} signs', { name: importer.short }), amount: formatMinor(advance), text: t('The advance arrives the moment they sign after you.') }
            : { title: t('{name} signs', { name: importer.short }), text: t('There is no advance. You are paid when the shipment is proven.') },
          { title: t('On board by {date}', { date: deadline }), text: t('{name} confirms the shipment. You upload the bill of lading and invoice.', { name: carrier.short }) },
          { title: t('Balance'), amount: formatMinor(balance), text: t('Paid to you once the shipment is proven.') },
        ]}
        note={t('No proof of shipment by {date} and the balance goes back to {name}.', { date: deadline, name: importer.short })}
      />

      <PayoutPanel
        heading={t('You get paid only to')}
        holder={holder?.name ?? t('Not a registered account')}
        address={po.payoutAddress}
        notes={[
          own
            ? { text: t('This is the payout account registered for your company.'), tone: 'ok' }
            : { text: t('This is not the payout account registered for your company.'), tone: 'bad' },
          { text: t('Check it\'s yours. Locked once both sign.'), tone: 'neutral' },
        ]}
      />

      <View>
        <Row label={t('Incoterm')} value={incotermText(po.incoterm)} />
        <Row label={t('Proof of shipment from')} value={carrier.name} />
        <Row label={t('Disputes settled by')} value={arbiter.name} />
      </View>

      <View style={{ gap: 10 }}>
        <Text size={16} weight={800}>
          {t('What the contract does with the funds')}
        </Text>
        <Bullet ok>{t('Pays that account the advance when you both have signed and the buyer deposits.')}</Bullet>
        <Bullet ok>{t('Pays that account the balance only when the carrier proves the shipment.')}</Bullet>
        <Bullet ok>{t('Sends the balance back to {name} if there is no proof by {date}.', { name: importer.short, date: deadline })}</Bullet>
        <Bullet>{t('Cannot pay any other account. The account is part of what you sign.')}</Bullet>
        <Bullet>{t('Cannot change these terms after you sign. A new version is a new order.')}</Bullet>
      </View>

      {checks.length > 0 ? (
        <View style={{ gap: 6 }}>
          {checks.map((check) => (
            <View key={check} style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: colors.danger }} />
              <Text size={14} leading={1.4} style={{ flex: 1, color: colors.danger }}>
                {t(CHECK_WORDS[check])}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text size={13} color="textMuted">
          {t('Checked on this phone: the terms, the order id and your payout account.')}
        </Text>
      )}
      {failed.length > 0 ? (
        <Text size={14} style={{ color: colors.danger }}>
          {failed.map((c) => t(CHECK_WORDS[c])).join('. ')}
        </Text>
      ) : null}
      {problem ? (
        <Text size={14} style={{ color: colors.danger }}>
          {problem}
        </Text>
      ) : null}

      <View style={{ gap: 14, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.divider }}>
        <Checkbox checked={ticked} onChange={setTicked} label={t('These are the terms I agreed with {name}.', { name: importer.short })} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button label={t('Reject')} onPress={() => setRejecting(true)} disabled={busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={busy ? t('Signing') : t('Sign')} onPress={sign} disabled={!canSign} />
          </View>
        </View>
        <Text size={13} color="textFaint" style={{ textAlign: 'center' }}>
          {help}
        </Text>
      </View>

      <BottomSheet visible={rejecting} title={t('Reject this order?')} onClose={() => setRejecting(false)}>
        <View style={{ gap: 12, paddingTop: 6 }}>
          <Text size={14} leading={1.45} color="textMuted">
            {t('{name} will see it as rejected. Nothing is signed or paid, and they would have to send a new order.', { name: importer.short })}
          </Text>
          <Button
            label={t('Reject the order')}
            onPress={async () => {
              setRejecting(false);
              await exporterRejects(proposals, proposal);
            }}
          />
          <Button label={t('Keep reviewing')} variant="secondary" onPress={() => setRejecting(false)} />
        </View>
      </BottomSheet>
    </Frame>
  );
}

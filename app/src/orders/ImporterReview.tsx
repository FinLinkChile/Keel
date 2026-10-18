import type { Hex, Incoterm } from '@keel/schemas';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { config } from '@/config';
import { proposals, useData } from '@/data';
import { agentNotes } from '@/data/agentNotes';
import { tokenToCents } from '@/data/amounts';
import { apiProblem } from '@/data/apiProblem';
import { importerRejects, importerSigns, reviewForImporter, type Review } from '@/data/proposalFlow';
import {
  CHECK_WORDS,
  differenceWords,
  incotermText,
  payoutHistory,
  SAFE_NOT_SET_UP,
  SIGNING_NOT_SET_UP,
  signingSetup,
  type OrderCheck,
} from '@/data/signOrder';
import { useT } from '@/i18n';
import { useSession } from '@/session';
import { AgentNotes } from '@/ui/AgentNotes';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { formatDay, formatLocalDayTime, formatMinor } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { PayoutPanel } from '@/ui/PayoutPanel';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

import { Bullet, Frame, Row } from './parts';

// 04 Review before you sign. The supplier signed first; the importer reads the order as a
// document and gives the last signature. Nothing is signed unless the supplier's signature
// recovers to the supplier on this very order and the order is the one that was sent.
export function ImporterReview({ orderId }: { orderId: Hex }) {
  const t = useT();
  const { signer, address } = useSession();
  const view = useData(async (d) => {
    const proposal = await proposals.get(orderId);
    if (!proposal) return null;
    const { po } = proposal;
    const [supplier, carrier, arbiter, orders] = await Promise.all([
      d.partyByAddress(po.exporter),
      d.partyByAddress(po.carrier),
      d.partyByAddress(po.arbiter),
      d.orders(),
    ]);
    if (!supplier || !carrier || !arbiter) return null;
    // The supplier already signed, so the notes only inform: changing a term would void its signature
    const notes = agentNotes({
      supplier: { name: supplier.name, address: po.exporter },
      totalCents: Number(tokenToCents(po.totalAmount)),
      advanceBps: po.advanceBps,
      shipmentDeadline: Number(po.shipmentDeadline),
      incoterm: incotermText(po.incoterm) as Incoterm,
      orders,
      excludeOrderId: po.orderId,
      now: Date.now() / 1000,
    });
    return { proposal, supplier, carrier, arbiter, history: payoutHistory(orders, po), notes };
  }, [orderId, address]);

  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [failed, setFailed] = useState<Review>();
  const [problem, setProblem] = useState<string>();
  const [review, setReview] = useState<Review>();

  const proposal = view?.proposal;
  const setup = signingSetup(config);
  // The supplier's signature is recovered against the order, so this runs when the order changes
  useEffect(() => {
    if (!proposal || proposal.status !== 'awaiting_importer') return;
    let live = true;
    reviewForImporter(proposal, { owner: address, setup, now: Date.now() / 1000 }).then((r) => live && setReview(r));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal, address, setup?.escrow, setup?.chainId, setup?.safe]);

  if (view === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (view === null || !proposal) {
    return (
      <Frame label={t('Order')}>
        <Text color="textMuted">{t('This order is not on this phone.')}</Text>
      </Frame>
    );
  }
  const { supplier, carrier, arbiter, history } = view;
  const { po, terms } = proposal;

  // Nothing to sign (signed, rejected, or not signed by the supplier yet): back to the timeline
  if (proposal.status !== 'awaiting_importer') {
    return <Redirect href={{ pathname: '/order/[orderId]', params: { orderId } }} />;
  }

  const checks: OrderCheck[] = review?.checks ?? [];
  const differences = review?.differences ?? [];
  const canSign = !!setup?.safe && !!signer && !!review && checks.length === 0 && ticked && !busy;

  const total = tokenToCents(po.totalAmount);
  const advanceUnits = (po.totalAmount * BigInt(po.advanceBps)) / 10_000n;
  const advance = tokenToCents(advanceUnits);
  const balance = tokenToCents(po.totalAmount - advanceUnits);
  const deadline = formatDay(po.shipmentDeadline);

  async function sign() {
    if (!canSign || !setup || !signer) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const move = await importerSigns(proposals, proposal!, { signer, setup, now: Date.now() / 1000 });
      if (!move.ok) setFailed({ checks: move.checks, differences: move.differences ?? [] });
    } catch (e) {
      setProblem(apiProblem(e) ?? t('The wallet could not sign. Try again.'));
    }
    setBusy(false);
  }

  const help = !setup
    ? t(SIGNING_NOT_SET_UP)
    : !setup.safe
      ? t(SAFE_NOT_SET_UP)
      : !review
        ? t('Checking the order on this phone.')
        : checks.length > 0
          ? t('Do not sign this order. Reject it, or ask for a new one.')
          : !ticked
            ? t('Tick the box above to sign with your wallet.')
            : t('Signs with your wallet. The agent deposits after this.');

  const history_ =
    history.different > 0
      ? { text: t(history.different === 1 ? 'Different from an earlier order with {name}. Check it before you sign.' : 'Different from {n} earlier orders with {name}. Check it before you sign.', { n: history.different, name: supplier.short }), tone: 'bad' as const }
      : history.same > 0
        ? { text: t(history.same === 1 ? 'Same account as your last order with {name}' : 'Same account as your last {n} orders with {name}', { n: history.same, name: supplier.short }), tone: 'ok' as const }
        : { text: t('First order with {name}. Check the account with them.', { name: supplier.short }), tone: 'neutral' as const };

  return (
    <Frame label={proposal.label}>
      <Text size={28} weight={800} accessibilityRole="header" style={{ marginTop: -8 }}>
        {t('Review before you sign')}
      </Text>

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: 22, paddingHorizontal: 20, gap: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text mono size={12} weight={600} color="textFaint" tracking={1}>
            {t('PURCHASE ORDER')}
          </Text>
          <Text mono size={13} color="textMuted">
            {proposal.label}
          </Text>
        </View>
        <View style={{ gap: 4 }}>
          <Text size={22} weight={800} leading={1.2}>
            {proposal.goods || t('Order {label}', { label: proposal.label })}
          </Text>
          <Text size={14} color="textMuted">
            {t('From {name}, {place}.', { name: supplier.name, place: supplier.place })} {incotermText(po.incoterm)}.
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text size={16} weight={700} color="textMuted">
            {terms.currency}
          </Text>
          <Text mono size={36} weight={600} tracking={-1.4}>
            {formatMinor(total)}
          </Text>
        </View>
        <View>
          {po.advanceBps > 0 ? <Row label={t('When both sign')} value={formatMinor(advance)} mono /> : null}
          <Row label={t('When shipment is proven')} value={formatMinor(balance)} mono />
          <Row label={t('On board by')} value={`${deadline}, ${new Date(Number(po.shipmentDeadline) * 1000).getUTCFullYear()}`} />
          <Row label={t('Proof of shipment from')} value={carrier.name} />
          <Row label={t('Disputes settled by')} value={arbiter.name} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.dividerOnSurface }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text size={15} weight={700}>
              {supplier.short}
            </Text>
            <Text size={13} color="textMuted">
              {proposal.exporterSignedAt ? t('signed {when}', { when: formatLocalDayTime(proposal.exporterSignedAt) }) : t('signed')}
              {review && !review.checks.includes('bad_exporter_signature') ? ` ${t('(checked)')}` : ''}
            </Text>
          </View>
          {review && !review.checks.includes('bad_exporter_signature') ? <Icon name="check" size={18} strokeWidth={3} color="money" /> : null}
          <View style={{ width: 80, height: 40, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.control, alignItems: 'center', justifyContent: 'center' }}>
            <Text size={14} weight={800} color="textMuted">
              {t('You')}
            </Text>
          </View>
        </View>
      </View>

      <AgentNotes
        notes={view.notes}
        footer={t('{name} already signed these terms. To change one, reject and send a new order.', { name: supplier.short })}
      />

      <PayoutPanel
        heading={t('Paid only to this account')}
        holder={supplier.name}
        address={po.payoutAddress}
        notes={[history_, { text: t('Locked once both sign.'), tone: 'neutral' }]}
      />

      <View style={{ gap: 10 }}>
        <Text size={16} weight={800}>
          {t('Once you sign')}
        </Text>
        <Bullet ok>{t('You sign the terms, you don\'t send money. The agent deposits {amount} after both of you sign.', { amount: formatMinor(total) })}</Bullet>
        <Bullet>{t('The money can only go to the account above, or back to you if there is no proof of shipment by {date}.', { date: deadline })}</Bullet>
        <Bullet>{t('You can\'t pull it back on your own. To stop the order, open a dispute or cancel together.')}</Bullet>
      </View>

      {checks.length > 0 || failed ? (
        <View style={{ gap: 6 }}>
          {[...new Set([...checks, ...(failed?.checks ?? [])])].map((check) => (
            <Problem key={check}>{t(CHECK_WORDS[check])}</Problem>
          ))}
          {[...new Set([...differences, ...(failed?.differences ?? [])])].length > 0 ? (
            <Problem>{t('Changed since it was sent: {what}', { what: differenceWords([...new Set([...differences, ...(failed?.differences ?? [])])]).map((w) => t(w)).join(', ') })}</Problem>
          ) : null}
        </View>
      ) : review ? (
        <Text size={13} color="textMuted">
          {t('Checked on this phone: {name}\'s signature, the terms, the order id and that nothing changed since it was sent.', { name: supplier.short })}
        </Text>
      ) : null}
      {problem ? (
        <Text size={14} style={{ color: colors.danger }}>
          {problem}
        </Text>
      ) : null}

      <View style={{ gap: 14, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.divider }}>
        <Checkbox checked={ticked} onChange={setTicked} label={t('These are the terms I agreed with {name}.', { name: supplier.short })} />
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
            {t('Nothing is signed or paid, and {name} would need a new order from you.', { name: supplier.short })}
          </Text>
          <Button
            label={t('Reject the order')}
            onPress={async () => {
              setRejecting(false);
              await importerRejects(proposals, proposal).catch((e) => setProblem(apiProblem(e) ?? 'The order could not be rejected. Try again.'));
            }}
          />
          <Button label={t('Keep reviewing')} variant="secondary" onPress={() => setRejecting(false)} />
        </View>
      </BottomSheet>
    </Frame>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: colors.danger }} />
      <Text size={14} leading={1.4} style={{ flex: 1, color: colors.danger }}>
        {children}
      </Text>
    </View>
  );
}

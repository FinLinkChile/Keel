import type { Hex } from '@keel/schemas';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { useSession } from '@/session';
import { Avatar } from '@/ui/Avatar';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { formatDay, formatMinor } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { MoneySteps } from '@/ui/MoneySteps';
import { PayoutPanel } from '@/ui/PayoutPanel';
import { Text } from '@/ui/Text';
import { colors, gutter } from '@/ui/theme';

// 10a Exporter: review and sign the order. The importer proposed it and the exporter signs first.
// Reject is the default; Sign waits for the checks, the box and the escrow address.
export function ExporterReview({ orderId }: { orderId: Hex }) {
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
  if (view === null) return <Frame label="Order" onBack={back}><Text color="textMuted">This order is not on this phone.</Text></Frame>;
  const { proposal, importer, carrier, arbiter, registeredPayout, holder } = view;
  const { po, terms } = proposal;

  // Not waiting for this signature any more: say where the order is
  if (proposal.status !== 'awaiting_exporter') {
    const words = {
      awaiting_importer: ['You signed', `It is with ${importer.short} for the last signature. Nothing is paid until they sign and the escrow opens.`],
      signed: ['Signed by both', 'The order waits to be opened in the escrow.'],
      rejected: ['You rejected this order', `${importer.short} sees it as rejected. Nothing was signed or paid.`],
    } as const;
    const [title, text] = words[proposal.status as keyof typeof words];
    return (
      <Frame label={proposal.label} onBack={back}>
        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 32 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: proposal.status === 'rejected' ? colors.surface : colors.moneyMuted, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={proposal.status === 'rejected' ? 'info' : 'check'} size={28} strokeWidth={3} color={proposal.status === 'rejected' ? 'textMuted' : 'money'} />
          </View>
          <Text size={24} weight={800} accessibilityRole="header">
            {title}
          </Text>
          <Text size={15} leading={1.5} color="textMuted" style={{ textAlign: 'center', maxWidth: 300 }}>
            {text}
          </Text>
          <Text size={15} weight={700}>
            {proposal.goods || proposal.label}
          </Text>
        </View>
        <Button label="Done" onPress={() => router.replace('/home')} />
      </Frame>
    );
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
      setProblem('The wallet could not sign. Try again.');
    }
    setBusy(false);
  }

  const help = !setup
    ? SIGNING_NOT_SET_UP
    : checks.length > 0
      ? 'Fix the problems above, or reject the order.'
      : !ticked
        ? 'Tick the box above to sign with your wallet.'
        : 'Signs with your wallet. Nothing is paid yet.';

  return (
    <Frame label={proposal.label} onBack={back}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Avatar name={importer.name} tint={importer.tint} size={36} />
          <Text size={15} color="textMuted" style={{ flex: 1 }}>
            {importer.name} asks you to sign first
          </Text>
        </View>
        <Text size={28} weight={800} leading={1.15} accessibilityRole="header">
          {proposal.goods || `Order ${proposal.label}`}
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
        title="When you get paid"
        steps={[
          po.advanceBps > 0
            ? { title: `${importer.short} signs`, amount: formatMinor(advance), text: 'The advance arrives the moment they sign after you.' }
            : { title: `${importer.short} signs`, text: 'There is no advance. You are paid when the shipment is proven.' },
          { title: `On board by ${deadline}`, text: `${carrier.short} confirms the shipment. You upload the bill of lading and invoice.` },
          { title: 'Balance', amount: formatMinor(balance), text: 'Paid to you once the shipment is proven.' },
        ]}
        note={`No proof of shipment by ${deadline} and the balance goes back to ${importer.short}.`}
      />

      <PayoutPanel
        heading="You get paid only to"
        holder={holder?.name ?? 'Not a registered account'}
        address={po.payoutAddress}
        notes={[
          own
            ? { text: 'This is the payout account registered for your company.', tone: 'ok' }
            : { text: 'This is not the payout account registered for your company.', tone: 'bad' },
          { text: "Check it's yours. Locked once both sign.", tone: 'neutral' },
        ]}
      />

      <View>
        <Row label="Incoterm" value={incotermText(po.incoterm)} />
        <Row label="Proof of shipment from" value={carrier.name} />
        <Row label="Disputes settled by" value={arbiter.name} />
      </View>

      <View style={{ gap: 10 }}>
        <Text size={16} weight={800}>
          What the contract does with the funds
        </Text>
        <Bullet ok>Pays that account the advance when you both have signed and the buyer deposits.</Bullet>
        <Bullet ok>Pays that account the balance only when the carrier proves the shipment.</Bullet>
        <Bullet ok>Sends the balance back to {importer.short} if there is no proof by {deadline}.</Bullet>
        <Bullet>Cannot pay any other account. The account is part of what you sign.</Bullet>
        <Bullet>Cannot change these terms after you sign. A new version is a new order.</Bullet>
      </View>

      {checks.length > 0 ? (
        <View style={{ gap: 6 }}>
          {checks.map((check) => (
            <View key={check} style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: colors.danger }} />
              <Text size={14} leading={1.4} style={{ flex: 1, color: colors.danger }}>
                {CHECK_WORDS[check]}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text size={13} color="textMuted">
          Checked on this phone: the terms, the order id and your payout account.
        </Text>
      )}
      {failed.length > 0 ? (
        <Text size={14} style={{ color: colors.danger }}>
          {failed.map((c) => CHECK_WORDS[c]).join('. ')}
        </Text>
      ) : null}
      {problem ? (
        <Text size={14} style={{ color: colors.danger }}>
          {problem}
        </Text>
      ) : null}

      <View style={{ gap: 14, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.divider }}>
        <Checkbox checked={ticked} onChange={setTicked} label={`These are the terms I agreed with ${importer.short}.`} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button label="Reject" onPress={() => setRejecting(true)} disabled={busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={busy ? 'Signing' : 'Sign'} onPress={sign} disabled={!canSign} />
          </View>
        </View>
        <Text size={13} color="textFaint" style={{ textAlign: 'center' }}>
          {help}
        </Text>
      </View>

      <BottomSheet visible={rejecting} title="Reject this order?" onClose={() => setRejecting(false)}>
        <View style={{ gap: 12, paddingTop: 6 }}>
          <Text size={14} leading={1.45} color="textMuted">
            {importer.short} will see it as rejected. Nothing is signed or paid, and they would have to send a new order.
          </Text>
          <Button
            label="Reject the order"
            onPress={async () => {
              setRejecting(false);
              await exporterRejects(proposals, proposal);
            }}
          />
          <Button label="Keep reviewing" variant="secondary" onPress={() => setRejecting(false)} />
        </View>
      </BottomSheet>
    </Frame>
  );
}

const back = () => (router.canGoBack() ? router.back() : router.replace('/home'));

// The screen shell: back, the order label in the middle, content, scroll
function Frame({ label, onBack, children }: { label: string; onBack: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: Math.max(52, insets.top + 8), paddingBottom: insets.bottom + 32, paddingHorizontal: gutter, gap: 26 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: -8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="back" size={22} />
        </Pressable>
        <Text mono size={14} color="textMuted" style={{ flex: 1, textAlign: 'center' }}>
          {label}
        </Text>
        <View style={{ width: 44 }} />
      </View>
      {children}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.divider }}>
      <Text size={15} color="textMuted" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text size={15} weight={600} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

// A thing the contract does (ok) or cannot do
function Bullet({ ok = false, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ marginTop: 2 }}>
        <Icon name={ok ? 'check' : 'lock'} size={14} strokeWidth={2.6} color={ok ? 'money' : 'textMuted'} />
      </View>
      <Text size={14} leading={1.45} color="textSoft" style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

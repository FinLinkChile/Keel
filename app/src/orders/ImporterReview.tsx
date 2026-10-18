import type { Hex, Incoterm } from '@keel/schemas';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { config } from '@/config';
import { proposals, useData } from '@/data';
import { agentNotes } from '@/data/agentNotes';
import { tokenToCents } from '@/data/amounts';
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
      <Frame label="Order">
        <Text color="textMuted">This order is not on this phone.</Text>
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
    } catch {
      setProblem('The wallet could not sign. Try again.');
    }
    setBusy(false);
  }

  const help = !setup
    ? SIGNING_NOT_SET_UP
    : !setup.safe
      ? SAFE_NOT_SET_UP
      : !review
        ? 'Checking the order on this phone.'
        : checks.length > 0
          ? 'Do not sign this order. Reject it, or ask for a new one.'
          : !ticked
            ? 'Tick the box above to sign with your wallet.'
            : 'Signs with your wallet. The agent deposits after this.';

  const history_ =
    history.different > 0
      ? { text: `Different from ${history.different === 1 ? 'an earlier order' : `${history.different} earlier orders`} with ${supplier.short}. Check it before you sign.`, tone: 'bad' as const }
      : history.same > 0
        ? { text: `Same account as your last ${history.same === 1 ? 'order' : `${history.same} orders`} with ${supplier.short}`, tone: 'ok' as const }
        : { text: `First order with ${supplier.short}. Check the account with them.`, tone: 'neutral' as const };

  return (
    <Frame label={proposal.label}>
      <Text size={28} weight={800} accessibilityRole="header" style={{ marginTop: -8 }}>
        Review before you sign
      </Text>

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: 22, paddingHorizontal: 20, gap: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text mono size={12} weight={600} color="textFaint" tracking={1}>
            PURCHASE ORDER
          </Text>
          <Text mono size={13} color="textMuted">
            {proposal.label}
          </Text>
        </View>
        <View style={{ gap: 4 }}>
          <Text size={22} weight={800} leading={1.2}>
            {proposal.goods || `Order ${proposal.label}`}
          </Text>
          <Text size={14} color="textMuted">
            From {supplier.name}, {supplier.place}. {incotermText(po.incoterm)}.
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
          {po.advanceBps > 0 ? <Row label="When both sign" value={formatMinor(advance)} mono /> : null}
          <Row label="When shipment is proven" value={formatMinor(balance)} mono />
          <Row label="On board by" value={`${deadline}, ${new Date(Number(po.shipmentDeadline) * 1000).getUTCFullYear()}`} />
          <Row label="Proof of shipment from" value={carrier.name} />
          <Row label="Disputes settled by" value={arbiter.name} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.dividerOnSurface }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text size={15} weight={700}>
              {supplier.short}
            </Text>
            <Text size={13} color="textMuted">
              {proposal.exporterSignedAt ? `signed ${formatLocalDayTime(proposal.exporterSignedAt)}` : 'signed'}
              {review && !review.checks.includes('bad_exporter_signature') ? ' (checked)' : ''}
            </Text>
          </View>
          {review && !review.checks.includes('bad_exporter_signature') ? <Icon name="check" size={18} strokeWidth={3} color="money" /> : null}
          <View style={{ width: 80, height: 40, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.control, alignItems: 'center', justifyContent: 'center' }}>
            <Text size={14} weight={800} color="textMuted">
              You
            </Text>
          </View>
        </View>
      </View>

      <AgentNotes
        notes={view.notes}
        footer={`${supplier.short} already signed these terms. To change one, reject and send a new order.`}
      />

      <PayoutPanel
        heading="Paid only to this account"
        holder={supplier.name}
        address={po.payoutAddress}
        notes={[history_, { text: 'Locked once both sign.', tone: 'neutral' }]}
      />

      <View style={{ gap: 10 }}>
        <Text size={16} weight={800}>
          Once you sign
        </Text>
        <Bullet ok>You sign the terms, you don&apos;t send money. The agent deposits {formatMinor(total)} after both of you sign.</Bullet>
        <Bullet>The money can only go to the account above, or back to you if there is no proof of shipment by {deadline}.</Bullet>
        <Bullet>You can&apos;t pull it back on your own. To stop the order, open a dispute or cancel together.</Bullet>
      </View>

      {checks.length > 0 || failed ? (
        <View style={{ gap: 6 }}>
          {[...new Set([...checks, ...(failed?.checks ?? [])])].map((check) => (
            <Problem key={check}>{CHECK_WORDS[check]}</Problem>
          ))}
          {[...new Set([...differences, ...(failed?.differences ?? [])])].length > 0 ? (
            <Problem>Changed since it was sent: {differenceWords([...new Set([...differences, ...(failed?.differences ?? [])])]).join(', ')}</Problem>
          ) : null}
        </View>
      ) : review ? (
        <Text size={13} color="textMuted">
          Checked on this phone: {supplier.short}&apos;s signature, the terms, the order id and that nothing changed since it was sent.
        </Text>
      ) : null}
      {problem ? (
        <Text size={14} style={{ color: colors.danger }}>
          {problem}
        </Text>
      ) : null}

      <View style={{ gap: 14, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.divider }}>
        <Checkbox checked={ticked} onChange={setTicked} label={`These are the terms I agreed with ${supplier.short}.`} />
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
            Nothing is signed or paid, and {supplier.short} would need a new order from you.
          </Text>
          <Button
            label="Reject the order"
            onPress={async () => {
              setRejecting(false);
              await importerRejects(proposals, proposal);
            }}
          />
          <Button label="Keep reviewing" variant="secondary" onPress={() => setRejecting(false)} />
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

import type { Hex } from '@keel/schemas';
import { router } from 'expo-router';
import { View } from 'react-native';

import { proposals, useData } from '@/data';
import { importerTimeline, NOT_ON_THIS_PHONE, orderAmounts, proposalTimeline, type TimelineItem } from '@/data/orderTimeline';
import { payoutHistory } from '@/data/signOrder';
import { useSession } from '@/session';
import { Button } from '@/ui/Button';
import { formatMinor } from '@/ui/format';
import { PayoutPanel } from '@/ui/PayoutPanel';
import { Ring } from '@/ui/Ring';
import { Steps, type Step } from '@/ui/Steps';
import { Text } from '@/ui/Text';
import { colors } from '@/ui/theme';
import { tokenToCents } from '@/data/amounts';

import { Frame } from './parts';

// 05 Order in progress, for the importer: the same timeline for every order, whether it came from
// the demo data or was proposed on this phone. The step that needs the importer leads to the
// review, where the last signature is given.
export function ImporterOrder({ orderId }: { orderId: Hex }) {
  const { address } = useSession();
  const view = useData(async (d) => {
    const order = await d.order(orderId);
    if (!order) return null;
    const [supplier, carrier, orders] = await Promise.all([d.partyByAddress(order.po.exporter), d.partyByAddress(order.po.carrier), d.orders()]);
    if (!supplier || !carrier) return null;
    return { order, supplier, carrier, proposal: await proposals.get(orderId), history: payoutHistory(orders, order.po) };
  }, [orderId, address]);

  if (view === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (view === null) {
    return (
      <Frame label="Order">
        <Text color="textMuted">This order is not on this phone.</Text>
      </Frame>
    );
  }
  const { order, supplier, carrier, proposal, history } = view;
  const { po, terms } = order;

  const items: TimelineItem[] = proposal ? proposalTimeline(proposal, supplier) : importerTimeline(order, supplier, carrier, Date.now() / 1000);
  const amounts = orderAmounts(order);
  const total = tokenToCents(po.totalAmount);
  const demoOnly = !proposal && order.stage === 'awaiting_signature' && order.waitingOn === 'importer';

  const steps: Step[] = items.map((item) => ({
    key: item.key,
    title: item.title,
    detail: item.detail,
    state: item.state,
    trailing: item.trailing ? (
      <Text mono size={14} weight={item.trailing.tone === 'money' ? 600 : undefined} color={item.trailing.tone === 'money' ? 'money' : item.trailing.tone === 'muted' ? 'textMuted' : 'text'}>
        {item.trailing.text}
      </Text>
    ) : undefined,
    children: item.action === 'review' ? (
      <View style={{ paddingTop: 4 }}>
        <Button label="Review and sign" variant="small" onPress={() => router.push({ pathname: '/review/[orderId]', params: { orderId: po.orderId } })} />
      </View>
    ) : undefined,
  }));

  const note =
    history.different > 0
      ? { text: `Different from ${history.different === 1 ? 'an earlier order' : `${history.different} earlier orders`} with ${supplier.short}`, tone: 'bad' as const }
      : history.same > 0
        ? { text: `Same account as your last ${history.same === 1 ? 'order' : `${history.same} orders`} with ${supplier.short}`, tone: 'ok' as const }
        : { text: `First order with ${supplier.short}`, tone: 'neutral' as const };
  const signedBoth = order.stage !== 'awaiting_signature' && order.stage !== 'rejected';

  return (
    <Frame label={order.label}>
      <View style={{ alignItems: 'center', gap: 2, marginTop: -8 }}>
        <Text size={28} weight={800} accessibilityRole="header" style={{ textAlign: 'center' }}>
          {order.goods}
        </Text>
        <Text size={15} color="textMuted">
          {supplier.name}, {supplier.place}
        </Text>
      </View>

      <View style={{ alignItems: 'center', paddingVertical: 6 }}>
        <Ring
          paid={amounts && amounts.total > 0n ? Number((amounts.paid * 1000n) / amounts.total) / 1000 : undefined}
          accessibilityLabel={amounts ? `${formatMinor(amounts.paid)} paid to ${supplier.short}, ${formatMinor(amounts.locked)} locked in escrow` : `Order total ${formatMinor(total)}`}
        >
          <Text size={13} color="textMuted">
            Order total
          </Text>
          <Text mono size={24} weight={600}>
            {formatMinor(total)}
          </Text>
          <Text size={13} color="textMuted">
            {terms.currency}
          </Text>
        </Ring>
      </View>

      {amounts ? (
        <View>
          <AmountRow color={colors.money} label={`Paid to ${supplier.short}`} amount={amounts.paid} />
          {amounts.locked > 0n ? <AmountRow color={colors.locked} label="Locked in escrow" amount={amounts.locked} /> : null}
          {amounts.returned > 0n ? <AmountRow color={colors.accent} label="Back to you" amount={amounts.returned} /> : null}
        </View>
      ) : (
        <Text size={14} leading={1.45} color="textMuted" style={{ textAlign: 'center' }}>
          Nothing has been paid yet.
        </Text>
      )}

      {demoOnly ? (
        <Text size={14} leading={1.45} style={{ color: colors.yourTurn }}>
          {NOT_ON_THIS_PHONE}
        </Text>
      ) : null}

      <View style={{ gap: 6 }}>
        <Text size={22} weight={800} accessibilityRole="header">
          Steps
        </Text>
        <Steps steps={steps} />
      </View>

      <PayoutPanel
        heading={signedBoth ? 'Paid only to this account' : 'The account in this order'}
        holder={supplier.name}
        address={po.payoutAddress}
        notes={[note, { text: signedBoth ? 'Both of you signed this account.' : 'Locked once both sign.', tone: 'neutral' }]}
      />
    </Frame>
  );
}

function AmountRow({ color, label, amount }: { color: string; label: string; amount: bigint }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text size={16} color="textSoft" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text mono size={16} weight={600}>
        {formatMinor(amount)}
      </Text>
    </View>
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useData, type Order } from '@/data';
import { supplierScore } from '@/data/supplierScore';
import { Frame, Row } from '@/orders/parts';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';
import { Stars } from '@/ui/Stars';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

const STAGE_WORDS: Record<Order['stage'], string> = {
  awaiting_signature: 'Awaiting signature',
  signed: 'Signed',
  advance_paid: 'Advance paid',
  shipped: 'Shipped',
  settled: 'Completed',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

// Supplier profile for the importer: how this supplier delivered on the orders signed with it,
// and those orders, so the score can be traced back to each one.
export default function Supplier() {
  const { partyId } = useLocalSearchParams<{ partyId: string }>();
  const view = useData(
    async (d) => {
      const [suppliers, orders] = await Promise.all([d.verifiedSuppliers(), d.orders()]);
      const record = suppliers.find((s) => s.party.id === partyId);
      if (!record) return null;
      const address = record.party.address.toLowerCase();
      return {
        party: record.party,
        score: supplierScore(orders, record.party.address),
        orders: orders.filter((o) => o.po.exporter.toLowerCase() === address),
      };
    },
    [partyId],
  );

  if (view === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (view === null) {
    return (
      <Frame label="Supplier">
        <Text color="textMuted">This supplier is not among your verified suppliers.</Text>
      </Frame>
    );
  }
  const { party, score, orders } = view;

  return (
    <Frame label="Supplier">
      <View style={{ alignItems: 'center', gap: 10 }}>
        <Avatar name={party.name} tint={party.tint} />
        <Text size={24} weight={800} accessibilityRole="header" style={{ textAlign: 'center' }}>
          {party.name}
        </Text>
        <Text size={15} color="textMuted">
          {party.place}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="check" size={14} strokeWidth={2.6} color="money" />
          <Text size={14} color="textSoft">
            Supplier check passed
          </Text>
        </View>
      </View>

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 20, gap: 10, alignItems: 'center' }}>
        {score.stars === null ? (
          <>
            <Text size={18} weight={800}>
              No score yet
            </Text>
            <Text size={14} leading={1.5} color="textMuted" style={{ textAlign: 'center' }}>
              No order with this supplier has shipped or been refunded yet. For a first order, a smaller advance keeps less at risk.
            </Text>
          </>
        ) : (
          <>
            <Text size={40} weight={800}>
              {score.stars.toFixed(1)}
            </Text>
            <Stars value={score.stars} size={26} />
            <Text size={14} color="textMuted" style={{ textAlign: 'center' }}>
              Based on {score.rated} {score.rated === 1 ? 'order' : 'orders'} with your company
            </Text>
          </>
        )}
      </View>

      <View>
        <Row label="Orders signed" value={String(score.orders)} />
        <Row label="Shipped on time" value={`${score.shippedOnTime} of ${score.shipped}`} />
        <Row label="Balance released" value={String(score.completed)} />
        <Row label="Refunded, no shipment in time" value={String(score.refunded)} />
        <Row label="Cancelled by both" value={String(score.cancelled)} />
      </View>

      {orders.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text size={18} weight={800}>
            Orders
          </Text>
          {orders.map((o) => (
            <Pressable
              key={o.po.orderId}
              accessibilityRole="button"
              accessibilityLabel={`${o.label}, ${o.goods}, ${STAGE_WORDS[o.stage]}`}
              onPress={() => router.push({ pathname: '/order/[orderId]', params: { orderId: o.po.orderId } })}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                borderTopWidth: 1,
                borderTopColor: colors.divider,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View style={{ flex: 1 }}>
                <Text size={15} weight={700}>
                  {o.goods}
                </Text>
                <Text mono size={13} color="textFaint">
                  {o.label}
                </Text>
              </View>
              <Text size={14} color="textMuted">
                {STAGE_WORDS[o.stage]}
              </Text>
              <Icon name="chevron" size={16} color="textFaint" />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text size={13} leading={1.5} color="textFaint">
        Counts only what the flow records for your company&apos;s orders: shipments against the signed deadline, released balances and refunds. History shared by other Keel companies, without naming them, is future work. The score only informs: who is paid and how much come from the signed order.
      </Text>
    </Frame>
  );
}

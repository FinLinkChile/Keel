import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useData, type Order } from '@/data';
import { negotiation } from '@/data/negotiation';
import { supplierScore } from '@/data/supplierScore';
import { useT } from '@/i18n';
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
  const t = useT();
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
        deal: negotiation(orders, record.party.address),
        orders: orders.filter((o) => o.po.exporter.toLowerCase() === address),
      };
    },
    [partyId],
  );

  if (view === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (view === null) {
    return (
      <Frame label={t('Supplier')}>
        <Text color="textMuted">{t('This supplier is not among your verified suppliers.')}</Text>
      </Frame>
    );
  }
  const { party, score, deal, orders } = view;
  const days = (n: number) => t(Math.abs(n) === 1 ? '{n} day' : '{n} days', { n: Math.abs(n) });

  return (
    <Frame label={t('Supplier')}>
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
            {t('Supplier check passed')}
          </Text>
        </View>
      </View>

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 20, gap: 10, alignItems: 'center' }}>
        {score.stars === null ? (
          <>
            <Text size={18} weight={800}>
              {t('No score yet')}
            </Text>
            <Text size={14} leading={1.5} color="textMuted" style={{ textAlign: 'center' }}>
              {t('No order with this supplier has shipped or been refunded yet. For a first order, a smaller advance keeps less at risk.')}
            </Text>
          </>
        ) : (
          <>
            <Text size={40} weight={800}>
              {score.stars.toFixed(1)}
            </Text>
            <Stars value={score.stars} size={26} />
            <Text size={14} color="textMuted" style={{ textAlign: 'center' }}>
              {t(score.rated === 1 ? 'Based on {n} order with your company' : 'Based on {n} orders with your company', { n: score.rated })}
            </Text>
          </>
        )}
      </View>

      <View>
        <Row label={t('Orders signed')} value={String(score.orders)} />
        <Row label={t('Shipped on time')} value={t('{n} of {total}', { n: score.shippedOnTime, total: score.shipped })} />
        <Row label={t('Balance released')} value={String(score.completed)} />
        <Row label={t('Refunded, no shipment in time')} value={String(score.refunded)} />
        <Row label={t('Cancelled by both')} value={String(score.cancelled)} />
        {score.marginDays !== null ? (
          <Row label={t('Ships, on average')} value={score.marginDays >= 0 ? t('{days} before the deadline', { days: days(score.marginDays) }) : t('{days} late', { days: days(score.marginDays) })} />
        ) : null}
        {score.documents.uploaded > 0 ? <Row label={t('Documents accepted')} value={t('{n} of {total} orders', { n: score.documents.accepted, total: score.documents.uploaded })} /> : null}
        {score.signDays !== null ? <Row label={t('Signs your orders in')} value={score.signDays < 1 ? t('Under a day') : days(score.signDays)} /> : null}
      </View>

      {deal.orders.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text size={18} weight={800}>
            {t('What you negotiated')}
          </Text>
          {deal.withAdvance > 0 ? (
            <Row
              label={t('Advance vs. the proforma')}
              value={deal.advancePointsSaved === 0 ? t('As asked') : t(deal.advancePointsSaved! > 0 ? '{n} points lower' : '{n} points higher', { n: Math.abs(deal.advancePointsSaved!) })}
            />
          ) : null}
          {deal.amountChangePct !== null ? (
            <Row label={t('Total vs. the proforma')} value={deal.amountChangePct === 0 ? t('As quoted') : t(deal.amountChangePct < 0 ? '{n}% lower' : '{n}% higher', { n: Math.abs(deal.amountChangePct) })} />
          ) : null}
          <Text size={12} color="textFaint">
            {t(deal.orders.length === 1 ? 'From the {n} order whose proforma the agent read.' : 'From the {n} orders whose proforma the agent read.', { n: deal.orders.length })}
          </Text>
        </View>
      ) : null}

      {orders.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text size={18} weight={800}>
            {t('Orders')}
          </Text>
          {orders.map((o) => (
            <Pressable
              key={o.po.orderId}
              accessibilityRole="button"
              accessibilityLabel={`${o.label}, ${o.goods}, ${t(STAGE_WORDS[o.stage])}`}
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
                {t(STAGE_WORDS[o.stage])}
              </Text>
              <Icon name="chevron" size={16} color="textFaint" />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text size={13} leading={1.5} color="textFaint">
        {t('Counts only what the flow records for your company\'s orders: shipments against the signed deadline, released balances and refunds. History shared by other Keel companies, without naming them, is future work. The score only informs: who is paid and how much come from the signed order.')}
      </Text>
    </Frame>
  );
}

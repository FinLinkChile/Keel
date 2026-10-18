import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useData } from '@/data';
import { insights, type Period } from '@/data/insights';
import { negotiation } from '@/data/negotiation';
import { supplierScore } from '@/data/supplierScore';
import { AgentAnalysis } from '@/orders/AgentAnalysis';
import { useSession } from '@/session';
import { BarList } from '@/ui/BarList';
import { formatCompact, formatDay, formatMinor } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { KpiCard } from '@/ui/KpiCard';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { colors, gutter, radius } from '@/ui/theme';

const PERIODS: { value: Period; label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All' },
];

const usd = (cents: number) => `USD ${formatCompact(BigInt(cents))}`;
const percent = (part: number, whole: number) => (whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`);

// The agent panel: what the company bought or sold, what is at stake now and how the other side
// delivered. Every number is a sum over the orders and says how many it comes from; a bar opens
// its orders. What the agent did on the server (held deposits, decisions) is not in the app yet.
export default function Agent() {
  const insets = useSafeAreaInsets();
  const { role } = useSession();
  const [period, setPeriod] = useState<Period>('90d');
  const view = useData(async (d) => {
    const [orders, wallet] = await Promise.all([d.orders(), d.wallet(role)]);
    const names = new Map<string, string>();
    for (const o of orders) {
      for (const a of [o.po.importer, o.po.exporter]) {
        if (!names.has(a.toLowerCase())) names.set(a.toLowerCase(), (await d.partyByAddress(a))?.name ?? 'Unknown company');
      }
    }
    const now = Date.now() / 1000;
    const data = insights({
      orders,
      role,
      period,
      now,
      counterparty: (a) => ({ label: names.get(a.toLowerCase()) ?? 'Unknown company', stars: supplierScore(orders, a).stars }),
    });
    // Orders waiting for this person's signature
    const waiting = orders.filter((o) => o.stage === 'awaiting_signature' && o.waitingOn === role);
    const labels = new Map(orders.map((o) => [o.po.orderId, `${o.label}, ${o.goodsShort || o.goods}`]));
    return { data, wallet, waiting: waiting.length, labels, deal: negotiation(orders) };
  }, [role, period]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: Math.max(56, insets.top + 12), paddingHorizontal: gutter, paddingBottom: 48, gap: 22 }}
    >
      <View style={{ gap: 6 }}>
        <Text size={28} weight={800} accessibilityRole="header">
          Agent
        </Text>
        <Text size={15} leading={1.5} color="textMuted">
          {role === 'importer' ? 'Your purchasing analyst: how your buying changes, where you depend on one supplier, and the cash coming up.' : 'What your company sold, what you were paid and how you delivered.'}
        </Text>
      </View>
      {role === 'importer' ? <AgentAnalysis /> : null}

      <View style={{ gap: 4 }}>
        <Text size={18} weight={800}>
          The numbers behind it
        </Text>
        <Text size={14} color="textMuted">
          Sums over your orders, the same the agent reads.
        </Text>
      </View>
      <Segmented options={PERIODS} value={period} onChange={setPeriod} accessibilityLabel="Period" />

      {!view ? null : view.data.signed.length === 0 && view.data.lockedCents === 0 ? (
        <Text size={15} color="textMuted">
          No orders yet. The panel fills in as your orders are signed, paid and shipped.
        </Text>
      ) : (
        <>
          <Section title="Summary">
            <Row>
              <KpiCard label={role === 'importer' ? 'Bought' : 'Sold'} value={usd(view.data.totalCents)} context={`${view.data.signed.length} orders signed`} />
              <KpiCard label="Average order" value={view.data.averageCents === null ? '–' : usd(view.data.averageCents)} />
            </Row>
            <Row>
              <KpiCard label={role === 'importer' ? 'Locked in escrow' : 'Locked for you'} value={usd(view.data.lockedCents)} context="Balances of funded orders, now" />
              {role === 'importer' ? (
                <KpiCard label="Average advance" value={view.data.averageAdvanceBps === null ? '–' : `${view.data.averageAdvanceBps / 100}%`} />
              ) : (
                <KpiCard label="Balances released" value={usd(view.data.releasedCents)} tone="money" />
              )}
            </Row>
          </Section>

          <Section title={role === 'importer' ? 'Risk' : 'Payments and delivery'}>
            <Row>
              {role === 'importer' ? (
                <KpiCard label="Advance before shipment" value={usd(view.data.advanceAtRiskCents)} context="Paid, not shipped yet" />
              ) : (
                <KpiCard label="Advances received" value={usd(view.data.advancesCents)} tone="money" />
              )}
              <KpiCard
                label="Shipped on time"
                value={percent(view.data.shipments.onTime, view.data.shipments.shipped)}
                context={`${view.data.shipments.onTime} of ${view.data.shipments.shipped} shipments`}
              />
            </Row>
            <Row>
              <KpiCard
                label="Refunds"
                value={String(view.data.refunds.count)}
                context={view.data.refunds.count ? `${usd(view.data.refunds.cents)} returned` : 'No shipment missed'}
                tone={view.data.refunds.count ? 'danger' : 'text'}
              />
              {role === 'exporter' ? (
                <KpiCard label="Documents accepted" value={percent(view.data.documents.accepted, view.data.documents.uploaded)} context={`${view.data.documents.accepted} of ${view.data.documents.uploaded} orders`} />
              ) : (
                <View style={{ flex: 1, minWidth: 150 }} />
              )}
            </Row>
          </Section>

          {role === 'importer' && view.deal.orders.length > 0 ? (
            <Section title="Negotiation">
              <Row>
                <KpiCard
                  label="Advance vs. proformas"
                  value={view.deal.advancePointsSaved === null ? '–' : `${view.deal.advancePointsSaved > 0 ? '−' : view.deal.advancePointsSaved < 0 ? '+' : ''}${Math.abs(view.deal.advancePointsSaved)} pts`}
                  context={`Lower in ${view.deal.lowerAdvance} of ${view.deal.withAdvance} orders`}
                  tone={view.deal.advancePointsSaved !== null && view.deal.advancePointsSaved > 0 ? 'money' : 'text'}
                />
                <KpiCard
                  label="Total vs. proformas"
                  value={view.deal.amountChangePct === null ? '–' : `${view.deal.amountChangePct > 0 ? '+' : ''}${view.deal.amountChangePct}%`}
                  context={`${view.deal.orders.length} orders with a proforma read`}
                  tone={view.deal.amountChangePct !== null && view.deal.amountChangePct < 0 ? 'money' : 'text'}
                />
              </Row>
            </Section>
          ) : null}

          {view.data.byCounterparty.length > 0 ? (
            <Section title={role === 'importer' ? 'By supplier' : 'By buyer'}>
              <BarList bars={view.data.byCounterparty} labelOf={(id) => view.labels.get(id) ?? id} />
            </Section>
          ) : null}

          {view.data.byProduct.length > 0 ? (
            <Section title="By product">
              <BarList bars={view.data.byProduct} labelOf={(id) => view.labels.get(id) ?? id} />
            </Section>
          ) : null}

          <Section title="Next 14 days">
            {view.data.upcoming.length === 0 ? (
              <Text size={14} color="textMuted">
                No ship-by dates coming up.
              </Text>
            ) : (
              view.data.upcoming.map((u) => (
                <Pressable
                  key={u.orderId}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/order/[orderId]', params: { orderId: u.orderId } })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.6 : 1 })}
                >
                  <Text size={15} weight={700} style={{ flex: 1 }}>
                    {u.goods}
                  </Text>
                  <Text size={14} color="textMuted">
                    Ship by {formatDay(u.deadline)}
                  </Text>
                  <Icon name="chevron" size={14} color="textFaint" />
                </Pressable>
              ))
            )}
          </Section>
        </>
      )}

      {view ? (
        <Section title="The agent">
          {view.wallet.agent ? (
            <KpiCard
              label="Monthly limit used"
              value={`${formatMinor(view.wallet.agent.usedMinor)} of ${formatMinor(view.wallet.agent.monthlyLimitMinor)}`}
              context={view.wallet.agent.on ? 'The agent funds orders within this limit' : 'The agent is off'}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/notifications')}
            style={({ pressed }) => ({ backgroundColor: colors.surface, borderRadius: radius.row, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.7 : 1 })}
          >
            <Text size={14} leading={1.45} color="textSoft" style={{ flex: 1 }}>
              {view.waiting === 0
                ? 'No order is waiting for your signature.'
                : `${view.waiting} ${view.waiting === 1 ? 'order waits' : 'orders wait'} for your signature.`}
            </Text>
            <Icon name="chevron" size={16} color="textFaint" />
          </Pressable>
          <Text size={12} leading={1.4} color="textFaint">
            Sums over your company&apos;s orders on this phone. The agent reads and suggests; the rules decide and you sign. What the agent did on the server, such as deposits it held for your approval, is not shown here yet.
          </Text>
        </Section>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <Text size={18} weight={800}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{children}</View>;
}

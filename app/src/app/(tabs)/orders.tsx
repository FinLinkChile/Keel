import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useData, type KeelData, type Order, type Party, type Role } from '@/data';
import { isClosed, orderLine } from '@/data/orderLine';
import { useT } from '@/i18n';
import { useSession } from '@/session';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';
import { Segmented } from '@/ui/Segmented';
import { StatusWord } from '@/ui/StatusWord';
import { Text } from '@/ui/Text';
import { colors, gutter } from '@/ui/theme';

type Tab = 'open' | 'closed';
type Row = { order: Order; counterparty: Party };

const RECENT = 30 * 24 * 3600;

// 14 Orders: every order of your company, in progress first, with one status word each.
export default function Orders() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { role } = useSession();
  const [tab, setTab] = useState<Tab>('open');
  const rows = useData((d) => loadRows(d, role), [role]);
  const now = Date.now() / 1000;

  const open = rows?.filter((r) => !isClosed(r.order)) ?? [];
  const closed = (rows?.filter((r) => isClosed(r.order)) ?? []).sort((a, b) => (b.order.closedAt ?? 0) - (a.order.closedAt ?? 0));
  const recent = closed.filter((r) => now - (r.order.closedAt ?? 0) <= RECENT);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: Math.max(56, insets.top + 12), paddingHorizontal: gutter, paddingBottom: 48, gap: 20 }}
    >
      <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text size={28} weight={800} accessibilityRole="header">
          {t('Orders')}
        </Text>
        {/* Only the importer opens orders */}
        {role === 'importer' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('New order')}
            onPress={() => router.push('/new-order')}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Icon name="plus" size={20} strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>

      <Segmented
        accessibilityLabel={t('Orders')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'open', label: t('In progress'), count: open.length },
          { value: 'closed', label: t('Closed'), count: closed.length },
        ]}
      />

      {tab === 'open' ? (
        <>
          <List rows={open} role={role} now={now} avatars empty={t('No orders in progress.')} />
          {recent.length > 0 ? (
            <View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <Text size={18} weight={700} color="textMuted" accessibilityRole="header">
                  {t('Recently closed')}
                </Text>
                <Text size={13} color="textFaint">
                  {t('last 30 days')}
                </Text>
              </View>
              <List rows={recent} role={role} now={now} />
            </View>
          ) : null}
        </>
      ) : (
        <List rows={closed} role={role} now={now} empty={t('No closed orders yet.')} />
      )}
    </ScrollView>
  );
}

async function loadRows(d: KeelData, role: Role): Promise<Row[]> {
  const account = await d.account(role);
  const me = await d.party(account.party);
  const orders = (await d.orders()).filter((o) => (role === 'importer' ? o.po.importer : o.po.exporter) === me?.address);
  const rows = await Promise.all(
    orders.map(async (order) => ({
      order,
      counterparty: await d.partyByAddress(role === 'importer' ? order.po.exporter : order.po.importer),
    })),
  );
  return rows.filter((r): r is Row => !!r.counterparty);
}

function List({ rows, role, now, avatars = false, empty }: { rows: Row[]; role: Role; now: number; avatars?: boolean; empty?: string }) {
  if (rows.length === 0)
    return empty ? (
      <Text size={15} color="textMuted">
        {empty}
      </Text>
    ) : null;
  return (
    <View>
      {rows.map(({ order, counterparty }, i) => {
        const line = orderLine(order, role, counterparty, now);
        return (
          <Pressable
            key={order.label}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/order/[orderId]', params: { orderId: order.po.orderId } })}
            accessibilityLabel={`${order.goodsShort} ${order.label}, ${line.detail.map((s) => s.text).join('')}, ${line.status}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingVertical: 12,
              borderBottomWidth: i < rows.length - 1 ? 1 : 0,
              borderBottomColor: colors.divider,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            {avatars ? <Avatar name={counterparty.name} tint={counterparty.tint} /> : null}
            <View style={{ flex: 1 }}>
              <Text size={16} weight={700}>
                {order.goodsShort}{' '}
                <Text mono size={12} color="textFaint">
                  {order.label}
                </Text>
              </Text>
              <Text size={13} color="textFaint">
                {line.detail.map((s) =>
                  s.money ? (
                    <Text key={s.text} size={13} color="money">
                      {s.text}
                    </Text>
                  ) : (
                    s.text
                  ),
                )}
              </Text>
            </View>
            <StatusWord tone={line.yourTurn ? 'yourTurn' : 'plain'}>{line.status}</StatusWord>
          </Pressable>
        );
      })}
    </View>
  );
}

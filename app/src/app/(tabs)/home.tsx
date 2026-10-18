import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { proposals, useData, type KeelData, type Party, type Role } from '@/data';
import { tokenToCents } from '@/data/amounts';
import { loadNeedsItems, needsItemHref, type NeedsItem } from '@/data/needsItems';
import { useT } from '@/i18n';
import { ActivityList } from '@/orders/ActivityList';
import { useSession } from '@/session';
import { Amount } from '@/ui/Amount';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { formatDay } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Sheet, SheetStack } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { colors, gutter } from '@/ui/theme';
import { WalletCard } from '@/ui/WalletCard';

// 02 Home, wallet first: who you are, the money panel, then what needs you.
export default function Home() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { role } = useSession();
  const home = useData((d) => loadHome(d, role), [role]);

  if (!home) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  const { me, account, wallet, items } = home;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: Math.max(56, insets.top + 12), paddingHorizontal: gutter, paddingBottom: 48, gap: 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {/* The company opens the profile: basic data and the way back to Connect */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Profile, {name}', { name: me.name })}
          onPress={() => router.push('/profile')}
          style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}
        >
          <Avatar name={me.name} />
          <View style={{ flex: 1 }}>
            <Text size={18} weight={700}>
              {me.name}
            </Text>
            <Text size={14} color="textMuted">
              {role === 'importer' ? t('Importer') : t('Exporter')}, {t(account.title)}
            </Text>
          </View>
        </Pressable>
        {/* The bell opens the notifications: what needs you, signatures first */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={items.length > 0 ? t('Notifications, {n} need you', { n: items.length }) : t('Notifications')}
          onPress={() => router.push('/notifications')}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="bell" size={24} strokeWidth={1.8} />
          {items.length > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: 4,
                right: 2,
                minWidth: 18,
                height: 18,
                paddingHorizontal: 5,
                borderRadius: 9,
                backgroundColor: colors.yourTurn,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text size={11} weight={800} color="onAccent">
                {items.length > 9 ? '9+' : String(items.length)}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <WalletCard
        wallet={wallet}
        lockedLabel={role === 'importer' ? t('Locked in orders') : t('Locked for you')}
        onLocked={() => router.navigate('/orders')}
        onAgent={() => router.navigate('/agent')}
      />

      {items.length > 0 ? (
        <SheetStack title={t('Needs you')} items={items} keyOf={(i) => i.key} render={(i) => <NeedsYouSheet item={i} role={role} />} />
      ) : (
        <View style={{ gap: 6 }}>
          <Text size={22} weight={800} accessibilityRole="header">
            {t('Needs you')}
          </Text>
          <Text size={15} color="textMuted">
            {t('Nothing right now.')}
          </Text>
        </View>
      )}

      <View style={{ gap: 6 }}>
        <Text size={22} weight={800} accessibilityRole="header">
          {t('Activity')}
        </Text>
        <ActivityList limit={5} />
      </View>
    </ScrollView>
  );
}

type Item = NeedsItem;

async function loadHome(d: KeelData, role: Role) {
  const account = await d.account(role);
  const [me, wallet, items] = await Promise.all([
    d.party(account.party),
    d.wallet(role),
    loadNeedsItems(d, role, async (id) => !!(await proposals.get(id))),
  ]);
  return { me: me!, account, wallet, items };
}

const shortName = (p: Party) => p.short;

function NeedsYouSheet({ item, role }: { item: Item; role: Role }) {
  const t = useT();
  if (item.kind === 'verify_supplier') {
    const { supplier } = item;
    return (
      <Sheet>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={supplier.name} tint={supplier.tint} size={36} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text size={16} weight={700}>
              {t('Verify {name}\'s account', { name: shortName(supplier) })}
            </Text>
            <Text size={14} color="textMuted">
              {t('New supplier, test transfer')}
            </Text>
          </View>
          <Button label={t('Verify {name}\'s account', { name: shortName(supplier) })} variant="ring" onPress={() => router.navigate('/suppliers')} />
        </View>
      </Sheet>
    );
  }

  const { order, counterparty } = item;
  const lead =
    item.kind === 'sign_order'
      ? t('{name} signed. ', { name: shortName(counterparty) })
      : item.kind === 'approve_balance'
        ? t('{name} shipped. ', { name: shortName(counterparty) })
        : item.kind === 'sign_cancel'
          ? t('{name} asked to cancel. ', { name: shortName(counterparty) })
          : t('Ship and upload. ');
  const action = item.kind === 'upload_documents' ? 'Upload' : 'Review';
  return (
    <Sheet>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flexDirection: 'row' }}>
          <Avatar name={counterparty.name} tint={counterparty.tint} size={36} ringColor="surface" />
          <View style={{ marginLeft: -10 }}>
            <Avatar name={t('You')} you size={36} />
          </View>
        </View>
        <Text size={14} color="textMuted" leading={1.35} style={{ flex: 1 }}>
          {lead}
          <Text size={14} weight={700}>
            {t('Your turn.')}
          </Text>
        </Text>
        <Text mono size={12} color="textFaint">
          {order.label}
        </Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text size={20} weight={800}>
          {[order.goods, order.quantity].filter(Boolean).join(', ')}
        </Text>
        <Text size={14} color="textMuted">
          {t('{name}, ship by {date}', { name: counterparty.name, date: formatDay(order.po.shipmentDeadline) })}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Amount
          minor={tokenToCents(order.po.totalAmount)}
          currency={order.terms.currency}
          size={18}
          weight={500}
          color="textSoft"
          currencyColor="textFaint"
        />
        {/* Review opens the signature (04, 10a); Upload opens the order (10) */}
        <Button label={t(action)} variant="go" onPress={() => router.push(needsItemHref(item, role))} />
      </View>
    </Sheet>
  );
}

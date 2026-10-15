import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useData, type KeelData, type NeedsYou, type Order, type Party, type Role } from '@/data';
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
        <Avatar name={me.name} />
        <View style={{ flex: 1 }}>
          <Text size={18} weight={700}>
            {me.name}
          </Text>
          <Text size={14} color="textMuted">
            {role === 'importer' ? 'Importer' : 'Exporter'}, {account.title}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={items.length > 0 ? 'Activity, something needs you' : 'Activity'}
          onPress={() => router.navigate('/activity')}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="bell" size={24} strokeWidth={1.8} />
          {items.length > 0 ? (
            <View style={{ position: 'absolute', top: 10, right: 11, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.yourTurn }} />
          ) : null}
        </Pressable>
      </View>

      <WalletCard
        wallet={wallet}
        lockedLabel={role === 'importer' ? 'Locked in orders' : 'Locked for you'}
        onLocked={() => router.navigate('/orders')}
      />

      {items.length > 0 ? (
        <SheetStack title="Needs you" items={items} keyOf={(i) => i.key} render={(i) => <NeedsYouSheet item={i} />} />
      ) : (
        <View style={{ gap: 6 }}>
          <Text size={22} weight={800} accessibilityRole="header">
            Needs you
          </Text>
          <Text size={15} color="textMuted">
            Nothing right now.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// What a pending item shows, already resolved from ids to names.
type Item =
  | { key: string; kind: 'sign_order'; order: Order; counterparty: Party }
  | { key: string; kind: 'upload_documents'; order: Order; counterparty: Party }
  | { key: string; kind: 'verify_supplier'; supplier: Party };

async function loadHome(d: KeelData, role: Role) {
  const account = await d.account(role);
  const [me, wallet, needs] = await Promise.all([d.party(account.party), d.wallet(role), d.needsYou(role)]);
  const items = (await Promise.all(needs.map((n) => resolve(d, role, n)))).filter((i): i is Item => !!i);
  return { me: me!, account, wallet, items };
}

async function resolve(d: KeelData, role: Role, n: NeedsYou): Promise<Item | undefined> {
  if (n.kind === 'verify_supplier') {
    const supplier = await d.party(n.party);
    return supplier && { key: `${n.kind}:${n.party}`, kind: n.kind, supplier };
  }
  const order = await d.order(n.orderId);
  if (!order) return undefined;
  const counterparty = await d.partyByAddress(role === 'importer' ? order.po.exporter : order.po.importer);
  return counterparty && { key: `${n.kind}:${n.orderId}`, kind: n.kind, order, counterparty };
}

const shortName = (p: Party) => p.name.split(' ')[0];

function NeedsYouSheet({ item }: { item: Item }) {
  if (item.kind === 'verify_supplier') {
    const { supplier } = item;
    return (
      <Sheet>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={supplier.name} tint={supplier.tint} size={36} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text size={16} weight={700}>
              Verify {shortName(supplier)}&apos;s account
            </Text>
            <Text size={14} color="textMuted">
              New supplier, test transfer
            </Text>
          </View>
          <Button label={`Verify ${shortName(supplier)}'s account`} variant="ring" onPress={() => router.navigate('/suppliers')} />
        </View>
      </Sheet>
    );
  }

  const { order, counterparty } = item;
  const signing = item.kind === 'sign_order';
  return (
    <Sheet>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flexDirection: 'row' }}>
          <Avatar name={counterparty.name} tint={counterparty.tint} size={36} ringColor="surface" />
          <View style={{ marginLeft: -10 }}>
            <Avatar name="You" you size={36} />
          </View>
        </View>
        <Text size={14} color="textMuted" leading={1.35} style={{ flex: 1 }}>
          {signing ? `${shortName(counterparty)} signed. ` : 'Ship and upload. '}
          <Text size={14} weight={700}>
            Your turn.
          </Text>
        </Text>
        <Text mono size={12} color="textFaint">
          {order.label}
        </Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text size={20} weight={800}>
          {order.goods}, {order.quantity}
        </Text>
        <Text size={14} color="textMuted">
          {counterparty.name}, ship by {formatDay(order.po.shipmentDeadline)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Amount
          minor={order.po.totalAmount}
          currency={order.terms.currency}
          size={18}
          weight={500}
          color="textSoft"
          currencyColor="textFaint"
        />
        {/* Review (04) and the exporter order (10) come later; until then both open Orders */}
        <Button label={signing ? 'Review' : 'Upload'} variant="go" onPress={() => router.navigate('/orders')} />
      </View>
    </Sheet>
  );
}

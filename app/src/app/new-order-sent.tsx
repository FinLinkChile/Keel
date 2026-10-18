import type { Hex } from '@keel/schemas';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useData } from '@/data';
import { tokenToCents } from '@/data/amounts';
import { useT } from '@/i18n';
import { useSession } from '@/session';
import { Button } from '@/ui/Button';
import { formatMinor, initials } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, gutter, radius } from '@/ui/theme';

// 03c Sent to <supplier>. The order is saved on this phone and waits for the supplier's
// signature; nothing is signed or paid yet. Only the importer sends orders.
export default function NewOrderSent() {
  const t = useT();
  const { role } = useSession();
  const { orderId } = useLocalSearchParams<{ orderId: Hex }>();
  const insets = useSafeAreaInsets();
  const view = useData(async (d) => {
    const order = await d.order(orderId);
    const supplier = order && (await d.partyByAddress(order.po.exporter));
    return order && supplier ? { order, supplier } : null;
  }, [orderId]);

  if (role !== 'importer') return <Redirect href="/home" />;
  if (view === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (view === null) return <Redirect href="/home" />;
  const { order, supplier } = view;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: Math.max(52, insets.top + 8),
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: gutter,
        gap: 26,
      }}
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 40 }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="send" size={36} color="accent" />
        </View>
        <Text size={28} weight={800} accessibilityRole="header" style={{ marginTop: 8, textAlign: 'center' }}>
          {t('Sent to {name}', { name: supplier.short })}
        </Text>
        <Text size={15} leading={1.5} color="textMuted" style={{ textAlign: 'center', maxWidth: 300 }}>
          {t('They check the terms and sign. Then it comes back to you for the last signature. Nothing is signed or paid yet.')}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'stretch', marginTop: 24 }}>
          <Step label={t('Order sent')} done>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.moneyMuted, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={18} strokeWidth={3} color="money" />
            </View>
          </Step>
          <Link />
          <Step label={t('{name} signs', { name: supplier.short })} strong>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: colors.avatar[(supplier.tint ?? 0) % colors.avatar.length],
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text size={15} weight={800} color="onAvatar">
                {initials(supplier.name)}
              </Text>
            </View>
          </Step>
          <Link />
          <Step label={t('You sign, money moves')}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: colors.control,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text size={14} weight={800} color="textMuted">
                {t('You')}
              </Text>
            </View>
          </Step>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          backgroundColor: colors.surface,
          borderRadius: radius.row,
          paddingVertical: 14,
          paddingHorizontal: 16,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text size={15} weight={700} numberOfLines={2}>
            {order.goods}
          </Text>
          <Text mono size={13} color="textMuted">
            {order.label}
          </Text>
        </View>
        <Text mono size={16} weight={600}>
          {formatMinor(tokenToCents(order.po.totalAmount))}
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        <Button label={t('Done')} onPress={() => router.replace('/home')} />
        <Text size={13} color="textFaint" style={{ textAlign: 'center' }}>
          {t('We\'ll tell you in Needs you when it\'s your turn.')}
        </Text>
      </View>
    </View>
  );
}

function Step({ label, done = false, strong = false, children }: { label: string; done?: boolean; strong?: boolean; children: React.ReactNode }) {
  const t = useT();
  return (
    <View
      accessible
      accessibilityLabel={done ? t('{label}, done', { label }) : label}
      style={{ width: 96, alignItems: 'center', gap: 8 }}
    >
      {children}
      <Text size={13} weight={strong ? 700 : undefined} color={strong ? 'text' : 'textMuted'} style={{ textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  );
}

// The dashed line between two steps
function Link() {
  return <View style={{ flex: 1, marginTop: 24, borderTopWidth: 1.5, borderTopColor: colors.line, borderStyle: 'dashed' }} />;
}

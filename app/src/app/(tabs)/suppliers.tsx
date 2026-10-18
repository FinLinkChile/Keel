import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useData } from '@/data';
import { supplierScore } from '@/data/supplierScore';
import { useT } from '@/i18n';
import { useSession } from '@/session';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';
import { Stars } from '@/ui/Stars';
import { StatusWord } from '@/ui/StatusWord';
import { Text } from '@/ui/Text';
import { colors, gutter } from '@/ui/theme';

// 08 Suppliers: the companies the importer can open an order with. Each one passed the supplier
// check and has its payout account registered. Each one opens its profile, with the score of
// how it delivered on the orders signed with it. Adding one is not built yet.
export default function Suppliers() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { role } = useSession();
  const suppliers = useData(async (d) => {
    const [records, orders] = await Promise.all([d.verifiedSuppliers(), d.orders()]);
    return records.map((r) => ({ ...r, score: supplierScore(orders, r.party.address) }));
  }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: Math.max(56, insets.top + 12), paddingHorizontal: gutter, paddingBottom: 48, gap: 20 }}
    >
      <Text size={28} weight={800} accessibilityRole="header">
        {t('Suppliers')}
      </Text>

      {role !== 'importer' ? (
        <Text size={15} color="textMuted">
          {t('Suppliers are managed by the importer.')}
        </Text>
      ) : (
        <>
          <Text size={15} leading={1.5} color="textMuted">
            {t('Companies you can open an order with. Each one passed the supplier check.')}
          </Text>
          {suppliers === undefined ? null : suppliers.length === 0 ? (
            <Text size={15} color="textMuted">
              {t('No suppliers yet.')}
            </Text>
          ) : (
            <View>
              {suppliers.map(({ party, score }, i) => (
                <Pressable
                  key={party.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${party.name}, ${score.stars === null ? t('no score yet') : t('{n} out of 5 stars', { n: score.stars })}`}
                  onPress={() => router.push({ pathname: '/supplier/[partyId]', params: { partyId: party.id } })}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 12,
                    borderBottomWidth: i < suppliers.length - 1 ? 1 : 0,
                    borderBottomColor: colors.divider,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Avatar name={party.name} tint={party.tint} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text size={16} weight={700}>
                      {party.name}
                    </Text>
                    <Text size={13} color="textFaint">
                      {party.place}
                    </Text>
                  </View>
                  {score.stars === null ? (
                    <StatusWord tone="plain">{t('New')}</StatusWord>
                  ) : (
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <Stars value={score.stars} size={13} />
                      <Text size={12} color="textFaint">
                        {score.rated} {score.rated === 1 ? t('order') : t('orders')}
                      </Text>
                    </View>
                  )}
                  <Icon name="chevron" size={16} color="textFaint" />
                </Pressable>
              ))}
            </View>
          )}
          <Text size={13} leading={1.5} color="textFaint">
            {t('Adding a supplier and the test transfer that verifies it are not available in this version.')}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

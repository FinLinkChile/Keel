import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useData } from '@/data';
import { useSession } from '@/session';
import { Avatar } from '@/ui/Avatar';
import { StatusWord } from '@/ui/StatusWord';
import { Text } from '@/ui/Text';
import { colors, gutter } from '@/ui/theme';

// 08 Suppliers: the companies the importer can open an order with. Each one passed the supplier
// check and has its payout account registered. Adding one is not built yet.
export default function Suppliers() {
  const insets = useSafeAreaInsets();
  const { role } = useSession();
  const suppliers = useData((d) => d.verifiedSuppliers(), []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: Math.max(56, insets.top + 12), paddingHorizontal: gutter, paddingBottom: 48, gap: 20 }}
    >
      <Text size={28} weight={800} accessibilityRole="header">
        Suppliers
      </Text>

      {role !== 'importer' ? (
        <Text size={15} color="textMuted">
          Suppliers are managed by the importer.
        </Text>
      ) : (
        <>
          <Text size={15} leading={1.5} color="textMuted">
            Companies you can open an order with. Each one passed the supplier check.
          </Text>
          {suppliers === undefined ? null : suppliers.length === 0 ? (
            <Text size={15} color="textMuted">
              No suppliers yet.
            </Text>
          ) : (
            <View>
              {suppliers.map(({ party }, i) => (
                <View
                  key={party.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 12,
                    borderBottomWidth: i < suppliers.length - 1 ? 1 : 0,
                    borderBottomColor: colors.divider,
                  }}
                >
                  <Avatar name={party.name} tint={party.tint} />
                  <View style={{ flex: 1 }}>
                    <Text size={16} weight={700}>
                      {party.name}
                    </Text>
                    <Text size={13} color="textFaint">
                      {party.place}
                    </Text>
                  </View>
                  <StatusWord tone="plain">Known</StatusWord>
                </View>
              ))}
            </View>
          )}
          <Text size={13} leading={1.5} color="textFaint">
            Adding a supplier and the test transfer that verifies it are not available in this version.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

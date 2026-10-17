import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { proposals, useData } from '@/data';
import { activityFrom } from '@/data/activity';
import { useSession } from '@/session';
import { formatLocalDay } from '@/ui/format';
import { Text } from '@/ui/Text';
import { colors, gutter } from '@/ui/theme';

// 12 Activity: what this phone did, newest first. Each line comes from a saved order, so the
// trail is real. Stopped attempts and the agent's work come later.
export default function Activity() {
  const insets = useSafeAreaInsets();
  const { role } = useSession();
  const items = useData(async (d) => {
    const list = await proposals.list();
    const addresses = new Set(list.flatMap((p) => [p.po.importer, p.po.exporter]));
    const names: Record<string, string> = {};
    for (const a of addresses) names[a.toLowerCase()] = (await d.partyByAddress(a))?.short ?? '';
    return activityFrom(list, names, role);
  }, [role]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: Math.max(56, insets.top + 12), paddingHorizontal: gutter, paddingBottom: 48, gap: 20 }}
    >
      <Text size={28} weight={800} accessibilityRole="header">
        Activity
      </Text>
      {items === undefined ? null : items.length === 0 ? (
        <Text size={15} leading={1.5} color="textMuted">
          Nothing yet. Orders you send and sign appear here.
        </Text>
      ) : (
        <View>
          {items.map((item, i) => (
            <View
              key={item.key}
              style={{
                gap: 2,
                paddingVertical: 12,
                borderBottomWidth: i < items.length - 1 ? 1 : 0,
                borderBottomColor: colors.divider,
              }}
            >
              <Text size={16} weight={700}>
                {item.title}
              </Text>
              <Text size={13} color="textFaint">
                {item.detail}, {formatLocalDay(item.at)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

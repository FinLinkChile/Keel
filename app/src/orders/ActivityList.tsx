import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { proposals, useData } from '@/data';
import { activityFrom } from '@/data/activity';
import { useSession } from '@/session';
import { formatLocalDay } from '@/ui/format';
import { Text } from '@/ui/Text';
import { colors } from '@/ui/theme';

// What this phone did, newest first. Each line comes from a saved order, so the trail is real.
// With `limit`, the latest lines and a way to the full list.
export function ActivityList({ limit }: { limit?: number }) {
  const { role } = useSession();
  const items = useData(async (d) => {
    const list = await proposals.list();
    const addresses = new Set(list.flatMap((p) => [p.po.importer, p.po.exporter]));
    const names: Record<string, string> = {};
    for (const a of addresses) names[a.toLowerCase()] = (await d.partyByAddress(a))?.short ?? '';
    return activityFrom(list, names, role);
  }, [role]);

  if (items === undefined) return null;
  if (items.length === 0) {
    return (
      <Text size={15} leading={1.5} color="textMuted">
        Nothing yet. Orders you send and sign appear here.
      </Text>
    );
  }
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <View>
      {shown.map((item, i) => (
        <View
          key={item.key}
          style={{ gap: 2, paddingVertical: 12, borderBottomWidth: i < shown.length - 1 ? 1 : 0, borderBottomColor: colors.divider }}
        >
          <Text size={16} weight={700}>
            {item.title}
          </Text>
          <Text size={13} color="textFaint">
            {item.detail}, {formatLocalDay(item.at)}
          </Text>
        </View>
      ))}
      {limit && items.length > limit ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/activity')} style={{ paddingTop: 12 }}>
          <Text size={14} weight={700} style={{ textDecorationLine: 'underline' }}>
            See all {items.length}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

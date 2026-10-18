import { Frame } from '@/orders/parts';
import { ActivityList } from '@/orders/ActivityList';
import { Text } from '@/ui/Text';

// 12 Activity: everything this phone did, newest first. Home shows the latest lines.
export default function Activity() {
  return (
    <Frame label="Activity">
      <Text size={28} weight={800} accessibilityRole="header">
        Activity
      </Text>
      <ActivityList />
    </Frame>
  );
}

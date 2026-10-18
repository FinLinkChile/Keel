import { useT } from '@/i18n';
import { Frame } from '@/orders/parts';
import { ActivityList } from '@/orders/ActivityList';
import { Text } from '@/ui/Text';

// 12 Activity: everything this phone did, newest first. Home shows the latest lines.
export default function Activity() {
  const t = useT();
  return (
    <Frame label={t('Activity')}>
      <Text size={28} weight={800} accessibilityRole="header">
        {t('Activity')}
      </Text>
      <ActivityList />
    </Frame>
  );
}

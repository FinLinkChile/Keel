import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/session';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, gutter } from '@/ui/theme';

// "Sent to <supplier>", not built yet (dev placeholder). New order opens it once the order is
// built and valid. Nothing is sent or stored here.
export default function NewOrderSent() {
  const { role } = useSession();
  const { supplier } = useLocalSearchParams<{ supplier?: string }>();
  const insets = useSafeAreaInsets();
  if (role !== 'importer') return <Redirect href="/home" />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: Math.max(56, insets.top + 12), paddingHorizontal: gutter, gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
        style={{ width: 44, height: 44, marginLeft: -12, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="back" size={22} />
      </Pressable>
      <Text size={28} weight={800} accessibilityRole="header">
        {supplier ? `Sent to ${supplier}` : 'Sent'}
      </Text>
      <Text size={15} color="textMuted">
        Nothing was sent. Sending comes next.
      </Text>
    </View>
  );
}

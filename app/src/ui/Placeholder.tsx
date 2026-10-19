import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { Icon } from './Icon';
import { Text } from './Text';
import { colors, gutter } from './theme';

// A screen that exists in the navigation but is not built yet.
export function Placeholder({ title, back = false }: { title: string; back?: boolean }) {
  const insets = useSafeAreaInsets();
  const t = useT();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: Math.max(56, insets.top + 12), paddingHorizontal: gutter, gap: 12 }}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
          style={{ width: 44, height: 44, marginLeft: -12, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="back" size={22} />
        </Pressable>
      ) : null}
      <Text size={28} weight={800} accessibilityRole="header">
        {title}
      </Text>
      <Text size={15} color="textMuted">
        {t('Nothing here yet.')}
      </Text>
    </View>
  );
}

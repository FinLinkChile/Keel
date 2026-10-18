import { Pressable, View } from 'react-native';

import { LANGUAGES, useLanguage } from '@/i18n';

import { Text } from './Text';

// EN | ES, for the screens before Profile (sign-up, Connect). Profile has the full selector.
export function LanguageSwitch() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('Language')} style={{ flexDirection: 'row', alignItems: 'center' }}>
      {LANGUAGES.map((l, i) => {
        const selected = l.code === language;
        return (
          <Pressable
            key={l.code}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={l.label}
            hitSlop={6}
            onPress={() => setLanguage(l.code)}
            style={{ paddingHorizontal: 8, paddingVertical: 10, marginLeft: i > 0 ? 2 : 0 }}
          >
            <Text size={13} weight={700} color={selected ? 'text' : 'textFaint'}>
              {l.code.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

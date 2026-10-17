import { Pressable, View } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { colors } from './theme';

// A box with a sentence next to it, for "These are the terms I agreed with ..."
export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: checked ? colors.accent : colors.control,
          backgroundColor: checked ? colors.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Icon name="check" size={14} strokeWidth={3.4} color="onAccent" /> : null}
      </View>
      <Text size={15} leading={1.45} style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

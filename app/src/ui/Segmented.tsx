import { Pressable, View } from 'react-native';

import { Text } from './Text';
import { colors, radius } from './theme';

type Option<T extends string> = { value: T; label: string; count?: number };

type Props<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  // On a surface (Connect) the track is raised; on the ground (Orders) it is the surface
  on?: 'bg' | 'surface';
  role?: 'radiogroup' | 'tablist';
};

// Two or more options in a pill track, the selected one filled with the accent.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  on = 'bg',
  role = 'tablist',
}: Props<T>) {
  const large = on === 'bg';
  return (
    <View
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        gap: 6,
        padding: 4,
        borderRadius: radius.pill,
        backgroundColor: on === 'bg' ? colors.surface : colors.surfaceRaised,
      }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole={role === 'tablist' ? 'tab' : 'radio'}
            accessibilityState={role === 'tablist' ? { selected } : { checked: selected }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              height: large ? 40 : 38,
              borderRadius: radius.pill,
              backgroundColor: selected ? colors.accent : 'transparent',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Text size={large ? 15 : 14} weight={700} color={selected ? 'onAccent' : 'text'}>
              {o.label}
            </Text>
            {o.count !== undefined ? (
              <Text mono size={13} color={selected ? 'onAccent' : 'textMuted'}>
                {o.count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

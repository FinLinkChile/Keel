import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { colors, radius } from './theme';

// One pending item: the surface of "Needs you" on the home screen.
export function Sheet({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.sheet,
        paddingVertical: 18,
        paddingLeft: 20,
        paddingRight: 18,
        gap: 18,
      }}
    >
      {children}
    </View>
  );
}

type StackProps<T> = {
  title: string;
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
};

// Pending items shown one at a time, paged with the arrows next to "1/2".
export function SheetStack<T>({ title, items, keyOf, render }: StackProps<T>) {
  const [index, setIndex] = useState(0);
  const current = Math.min(index, Math.max(items.length - 1, 0));
  const item = items[current];

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text size={22} weight={800} accessibilityRole="header" style={{ flex: 1 }}>
          {title}
        </Text>
        {items.length > 1 ? (
          <>
            <Text mono size={13} weight={600} color="textMuted" accessibilityLabel={`${current + 1} of ${items.length}`}>
              {current + 1}/{items.length}
            </Text>
            <Arrow label="Previous" icon="back" disabled={current === 0} onPress={() => setIndex(current - 1)} />
            <Arrow
              label="Next"
              icon="chevron"
              disabled={current === items.length - 1}
              onPress={() => setIndex(current + 1)}
            />
          </>
        ) : null}
      </View>
      {item !== undefined ? <View key={keyOf(item)}>{render(item)}</View> : null}
    </View>
  );
}

function Arrow({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: 'back' | 'chevron';
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={16} strokeWidth={2.4} color={disabled ? 'line' : 'text'} />
    </Pressable>
  );
}

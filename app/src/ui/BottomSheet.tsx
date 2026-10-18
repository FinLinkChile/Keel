import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';
import { colors, gutter, radius } from './theme';

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

// A panel that slides up over the screen to pick one thing. Tapping outside closes it.
export function BottomSheet({ visible, title, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}
      >
        {/* Swallows the tap so touching the panel does not close it */}
        <Pressable
          accessible={false}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            paddingTop: 22,
            paddingHorizontal: gutter,
            paddingBottom: Math.max(insets.bottom, 12) + 12,
          }}
        >
          <Text size={20} weight={800} accessibilityRole="header" style={{ marginBottom: 6 }}>
            {title}
          </Text>
          <View>{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type RowProps = {
  label: string;
  hint?: string;
  leading?: ReactNode;
  onPress: () => void;
};

// One choice in a BottomSheet, separated from the next by a hairline.
export function SheetOption({ label, hint, leading, onPress }: RowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 60,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: colors.dividerOnSurface,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <Text size={16} weight={700}>
          {label}
        </Text>
        {hint ? (
          <Text size={13} color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

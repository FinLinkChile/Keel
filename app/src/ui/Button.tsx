import { Pressable, View, type PressableProps } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { colors } from './theme';

// primary: the one main action of a screen (Continue)
// secondary: outline, for actions that are not the next step (Open a dispute)
// small: inline action in a row (Upload)
// go: action of a pending item, with the arrow (Review)
// ring: icon-only version of go
type Variant = 'primary' | 'secondary' | 'small' | 'go' | 'ring';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: Variant;
  // Stretch to the width of the parent. Primary and secondary default to true.
  block?: boolean;
};

const SIZE = {
  primary: { height: 56, font: 17, padX: 24 },
  secondary: { height: 52, font: 15, padX: 20 },
  small: { height: 40, font: 14, padX: 16 },
  go: { height: 48, font: 15, padX: 18 },
  ring: { height: 44, font: 0, padX: 0 },
} as const;

export function Button({ label, variant = 'primary', block, disabled, ...rest }: Props) {
  const size = SIZE[variant];
  const filled = variant !== 'secondary' && variant !== 'ring';
  const stretch = block ?? (variant === 'primary' || variant === 'secondary');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={variant === 'small' ? 4 : undefined}
      style={({ pressed }) => ({
        height: size.height,
        width: variant === 'ring' ? size.height : undefined,
        alignSelf: stretch ? 'stretch' : 'flex-start',
        borderRadius: size.height / 2,
        paddingLeft: size.padX,
        paddingRight: variant === 'go' ? 8 : size.padX,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: disabled ? colors.surfaceRaised : filled ? colors.accent : 'transparent',
        borderWidth: variant === 'secondary' ? 1 : variant === 'ring' ? 1.5 : 0,
        borderColor: variant === 'ring' ? colors.accent : colors.line,
        opacity: pressed ? 0.8 : 1,
      })}
      {...rest}
    >
      {variant === 'ring' ? (
        <Icon name="arrowUpRight" size={14} strokeWidth={3} color="accent" />
      ) : (
        <Text size={size.font} weight={700} color={disabled ? 'textFaint' : filled ? 'onAccent' : 'text'}>
          {label}
        </Text>
      )}
      {variant === 'go' && (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: colors.onAccent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="arrowUpRight" size={14} strokeWidth={3} color="accent" />
        </View>
      )}
    </Pressable>
  );
}

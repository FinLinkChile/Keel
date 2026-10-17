import { View } from 'react-native';

import { initials } from './format';
import { Text } from './Text';
import { colors } from './theme';

type Props = {
  name: string;
  // Index into the avatar palette, fixed per party. Omitted for your own company.
  tint?: number;
  size?: 36 | 44;
  // Dashed yellow circle that stands for you in a pair still waiting for your signature
  you?: boolean;
  // Ring in the colour behind it, so stacked avatars read as separate
  ringColor?: 'surface' | 'bg';
};

export function Avatar({ name, tint, size = 44, you = false, ringColor }: Props) {
  if (you) {
    return (
      <View
        accessibilityLabel="You"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: colors.yourTurn,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text size={11} weight={800}>
          You
        </Text>
      </View>
    );
  }
  const own = tint === undefined;
  return (
    <View
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: own ? colors.surfaceRaised : colors.avatar[tint % colors.avatar.length],
        borderWidth: ringColor ? 3 : 0,
        borderColor: ringColor ? colors[ringColor] : undefined,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text size={size === 44 ? 15 : 13} weight={800} color={own ? 'text' : 'onAvatar'}>
        {initials(name)}
      </Text>
    </View>
  );
}

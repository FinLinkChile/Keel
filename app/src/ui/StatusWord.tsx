import { View } from 'react-native';

import { Text } from './Text';
import { colors } from './theme';

// The word is always in ink. A dot is the only accent, and only for two meanings:
// yellow when it is your turn, red when an attack was stopped.
type Tone = 'plain' | 'yourTurn' | 'stopped';

type Props = {
  children: string;
  tone?: Tone;
  size?: number;
};

export function StatusWord({ children, tone = 'plain', size = 14 }: Props) {
  if (tone === 'plain') {
    return (
      <Text size={size} weight={600}>
        {children}
      </Text>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: tone === 'yourTurn' ? colors.yourTurn : colors.danger,
        }}
      />
      <Text size={size} weight={700}>
        {children}
      </Text>
    </View>
  );
}

import { View } from 'react-native';

import { formatMinor } from './format';
import { Text } from './Text';
import type { Colors, MonoWeight } from './theme';

type Ink = Exclude<keyof Colors, 'avatar'>;

type Props = {
  minor: bigint;
  currency?: string;
  decimals?: number;
  size?: number;
  weight?: MonoWeight;
  color?: Ink;
  currencyColor?: Ink;
  // Large figures in the design are tightened
  tracking?: number;
};

// A figure in mono with its currency in Figtree, sharing the baseline: "48,000.00 USD".
export function Amount({
  minor,
  currency,
  decimals = 2,
  size = 16,
  weight = 600,
  color = 'text',
  currencyColor = 'textMuted',
  tracking,
}: Props) {
  const figure = formatMinor(minor, decimals);
  if (!currency) {
    return (
      <Text mono size={size} weight={weight} color={color} tracking={tracking}>
        {figure}
      </Text>
    );
  }
  // The currency is ~40% of a large figure and ~75% of a small one in the design.
  const currencySize = size >= 30 ? Math.round(size * 0.42) : Math.max(12, Math.round(size * 0.74));
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'baseline', gap: size >= 30 ? 8 : 6 }}
      accessible
      accessibilityLabel={`${figure} ${currency}`}
    >
      <Text mono size={size} weight={weight} color={color} tracking={tracking}>
        {figure}
      </Text>
      <Text size={currencySize} weight={size >= 30 ? 700 : 400} color={currencyColor}>
        {currency}
      </Text>
    </View>
  );
}

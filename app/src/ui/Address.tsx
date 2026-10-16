import { formatAddress } from './format';
import { Text } from './Text';
import type { Colors } from './theme';

type Props = {
  address: string;
  // Only where the payee is decided: review before signing, account change, supplier check
  full?: boolean;
  // Inside a sentence: first and last group only
  inline?: boolean;
  size?: number;
  color?: Exclude<keyof Colors, 'avatar'>;
};

// An address in groups of 4 separated by spaces: "0x7A3f 91C2 … 55D8".
export function Address({ address, full = false, inline = false, size = 13, color = 'textMuted' }: Props) {
  return (
    <Text mono size={size} color={color} selectable={full} accessibilityLabel={full ? address : undefined}>
      {formatAddress(address, full ? 'full' : inline ? 'inline' : 'short')}
    </Text>
  );
}

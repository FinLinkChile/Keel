import type { Hex } from '@keel/schemas';
import { View } from 'react-native';

import { Address } from './Address';
import { Icon } from './Icon';
import { Identicon } from './Identicon';
import { Text } from './Text';
import { colors, radius } from './theme';

type Note = { text: string; tone: 'ok' | 'bad' | 'neutral' };

// "You get paid only to" / "The money can only go to": the one account an order pays, in spaced
// groups with its picture, never abbreviated. The notes say whether it is the registered one.
export function PayoutPanel({ heading, holder, address, notes }: { heading: string; holder: string; address: Hex; notes: Note[] }) {
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 18, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="lock" size={14} strokeWidth={2.2} color="textMuted" />
        <Text size={13} weight={700} color="textMuted">
          {heading}
        </Text>
      </View>
      <View style={{ backgroundColor: colors.bg, borderRadius: 18, borderWidth: 1, borderColor: colors.dividerOnSurface }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          <Identicon address={address} size={40} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text size={12} weight={600} color="textMuted">
              Account holder
            </Text>
            <Text size={16} weight={700}>
              {holder}
            </Text>
          </View>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.dividerOnSurface, padding: 14, gap: 8 }}>
          <Text size={12} weight={600} color="textMuted">
            Account number
          </Text>
          <Address address={address} full size={15} color="text" />
        </View>
        {notes.map((note) => (
          <View
            key={note.text}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.dividerOnSurface, paddingVertical: 12, paddingHorizontal: 14 }}
          >
            <Icon name={note.tone === 'ok' ? 'check' : 'info'} size={14} strokeWidth={2.4} color={note.tone === 'ok' ? 'money' : note.tone === 'bad' ? 'danger' : 'textMuted'} />
            <Text size={13} weight={600} color={note.tone === 'bad' ? 'danger' : 'textMuted'} style={{ flex: 1 }}>
              {note.text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

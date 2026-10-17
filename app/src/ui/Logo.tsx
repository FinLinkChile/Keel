import { View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

import { Text } from './Text';
import { colors, fonts } from './theme';

// The Keel wordmark: a slanted K tab followed by "eel" in Figtree italic. The parts are exported
// so the opening animation can move them one by one; at scale 1 they draw the same logo.

export const LOGO_LETTERS = ['e', 'e', 'l'] as const;

// The tab and the K inside it. `part` draws only the tab or only the K.
export function LogoTile({ scale = 1, part = 'both' }: { scale?: number; part?: 'both' | 'shape' | 'glyph' }) {
  return (
    <Svg width={37 * scale} height={40 * scale} viewBox="0 0 28 30">
      {part !== 'glyph' ? <Path d="M7 0h21l-7 30H0z" fill={colors.accent} /> : null}
      {part !== 'shape' ? (
        <SvgText
          x={17.6}
          y={25}
          textAnchor="middle"
          fontFamily={fonts.sans[800]}
          fontSize={26}
          fill={colors.onAccent}
          stroke={colors.onAccent}
          strokeWidth={1.2}
          strokeLinejoin="round"
          transform="skewX(-13)"
        >
          K
        </SvgText>
      ) : null}
    </Svg>
  );
}

export function LogoLetter({ char, scale = 1 }: { char: string; scale?: number }) {
  return (
    <Text size={52 * scale} tracking={-2.1 * scale} style={{ fontFamily: fonts.sansItalic800, lineHeight: 40 * scale }}>
      {char}
    </Text>
  );
}

export function Logo({ scale = 1 }: { scale?: number }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Keel" style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <LogoTile scale={scale} />
      <View style={{ flexDirection: 'row', marginLeft: -5 * scale }}>
        {LOGO_LETTERS.map((char, i) => (
          <LogoLetter key={i} char={char} scale={scale} />
        ))}
      </View>
    </View>
  );
}

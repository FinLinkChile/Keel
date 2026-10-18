import { View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

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

// Figtree ExtraBold Italic in font units (of 1000), read from the font file
const ADVANCE = { e: 563, l: 258 } as const;
const ASCENT = 950;
const DESCENT = 250;
const SIZE = 52;
const TRACKING = -2.1;
const LINE = 40;
// Where a browser puts the baseline in a 40 line box: the half leading is negative
const BASELINE = (LINE - ((ASCENT + DESCENT) / 1000) * SIZE) / 2 + (ASCENT / 1000) * SIZE;
// The italic l leans past its advance
const SPILL = 6;

export type LogoChar = (typeof LOGO_LETTERS)[number];

// How much room a letter takes in the row
export function letterWidth(char: LogoChar, scale = 1) {
  return ((ADVANCE[char] / 1000) * SIZE + TRACKING) * scale;
}

// SVG like the K: a Text line box shorter than the font is laid out differently on iOS, which
// also clips the glyph to it
export function LogoLetter({ char, scale = 1 }: { char: LogoChar; scale?: number }) {
  const width = letterWidth(char, scale);
  return (
    <View style={{ width, height: LINE * scale }}>
      <Svg width={width + SPILL * scale} height={LINE * scale} style={{ position: 'absolute', left: 0, top: 0 }}>
        <SvgText x={0} y={BASELINE * scale} fontFamily={fonts.sansItalic800} fontSize={SIZE * scale} fill={colors.text}>
          {char}
        </SvgText>
      </Svg>
    </View>
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

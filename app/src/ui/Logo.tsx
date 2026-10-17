import { View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

import { Text } from './Text';
import { colors, fonts } from './theme';

// The Keel wordmark: a slanted K tab followed by "eel" in Figtree italic.
export function Logo() {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Keel" style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <Svg width={37} height={40} viewBox="0 0 28 30">
        <Path d="M7 0h21l-7 30H0z" fill={colors.accent} />
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
      </Svg>
      <Text
        size={52}
        tracking={-2.1}
        style={{ fontFamily: fonts.sansItalic800, lineHeight: 40, marginLeft: -5 }}
      >
        eel
      </Text>
    </View>
  );
}

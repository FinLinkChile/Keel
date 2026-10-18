import { useId } from 'react';
import { View } from 'react-native';
import Svg, { ClipPath, Defs, Path, Rect } from 'react-native-svg';

import { colors } from './theme';

const STAR = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.3 6.1 20.5l1.3-6.6L2.5 9.4l6.6-.8z';

// Five stars filled to `value` (0 to 5, in halves)
export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  // Clip ids are global on the web, so each row of stars gets its own
  const key = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View accessible accessibilityLabel={`${value} out of 5 stars`} style={{ flexDirection: 'row', gap: size * 0.15 }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        const id = `star-${key}-${i}`;
        return (
          <Svg key={i} width={size} height={size} viewBox="0 0 24 24">
            <Defs>
              <ClipPath id={id}>
                <Rect x={0} y={0} width={24 * fill} height={24} />
              </ClipPath>
            </Defs>
            <Path d={STAR} fill={colors.dividerOnSurface} />
            {fill > 0 ? <Path d={STAR} fill={colors.accent} clipPath={`url(#${id})`} /> : null}
          </Svg>
        );
      })}
    </View>
  );
}

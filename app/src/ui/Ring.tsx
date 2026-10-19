import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors } from './theme';

type Props = {
  // Share of the ring in the first colour, 0 to 1. undefined draws only the track.
  paid?: number;
  size?: number;
  accessibilityLabel: string;
  children: ReactNode;
};

// The ring of 05: green for what the supplier already has, the rest for what is still locked.
// It starts at the top-left like the design.
export function Ring({ paid, size = 220, accessibilityLabel, children }: Props) {
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // A circle is drawn from 3 o'clock; the arc starts START degrees later. Done with the dash offset
  // and a pattern as long as the circumference (so an arc that crosses the start wraps round)
  // instead of rotating the shape: on the web, react-native-svg turns `rotation` and `origin`
  // into a `transform-origin` attribute that React rejects.
  const START = 110 / 360;
  const arc = (from: number, to: number, color: string) => {
    const length = c * (to - from);
    return (
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={`${length} ${c - length}`}
        strokeDashoffset={-c * (from + START)}
      />
    );
  };
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={paid === undefined ? colors.surface : colors.locked} strokeWidth={stroke} />
        {paid !== undefined && paid > 0 ? arc(0, Math.min(paid, 1), colors.money) : null}
      </Svg>
      <View style={{ alignItems: 'center', gap: 2 }}>{children}</View>
    </View>
  );
}

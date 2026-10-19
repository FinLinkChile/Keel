import Svg, { Rect } from 'react-native-svg';

import { identiconCells, identiconTint } from './identiconCells';
import { colors } from './theme';

// The picture of an address, next to the groups that spell it. Hidden from screen readers with
// aria-hidden: react-native-svg hands its props to the DOM on the web, which rejects
// accessibilityElementsHidden.
export function Identicon({ address, size = 40 }: { address: string; size?: number }) {
  const ink = colors.avatar[identiconTint(address, colors.avatar.length)];
  return (
    <Svg width={size} height={size} viewBox="0 0 5 5" aria-hidden style={{ borderRadius: size * 0.3, backgroundColor: colors.surfaceRaised }}>
      {identiconCells(address).flatMap((row, y) => row.map((on, x) => (on ? <Rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={ink} /> : null)))}
    </Svg>
  );
}

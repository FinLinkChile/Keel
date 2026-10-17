import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors, type Colors } from './theme';

// Line icons drawn in the design, on a 24 x 24 grid.
const ICONS = {
  back: <Path d="M15 6l-6 6 6 6" />,
  chevron: <Path d="M9 6l6 6-6 6" />,
  arrowUpRight: <Path d="M7 17L17 7M9 7h8v8" />,
  check: <Path d="M5 12l5 5 9-10" />,
  plus: <Path d="M12 5v14M5 12h14" />,
  bell: (
    <>
      <Path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" />
      <Path d="M10 20a2 2 0 004 0" />
    </>
  ),
  lock: (
    <>
      <Rect x={5} y={11} width={14} height={9} rx={2} />
      <Path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  home: <Path d="M4 11l8-7 8 7v9H4z" />,
  orders: (
    <>
      <Path d="M6 3h9l4 4v14H6z" />
      <Path d="M9 11h7M9 15h7" />
    </>
  ),
  suppliers: (
    <>
      <Circle cx={9} cy={8} r={3.5} />
      <Path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 4.5a3.5 3.5 0 010 7M18 14c2 .8 3 3 3 6" />
    </>
  ),
  activity: <Path d="M3 12h4l3-7 4 14 3-7h4" />,
} as const;

export type IconName = keyof typeof ICONS;

type Props = {
  name: IconName;
  size?: number;
  color?: Exclude<keyof Colors, 'avatar'>;
  strokeWidth?: number;
  // Filled shape, used by the selected tab
  filled?: boolean;
};

export function Icon({ name, size = 24, color = 'text', strokeWidth = 2, filled = false }: Props) {
  const ink = colors[color];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? ink : 'none'}
      stroke={filled ? 'none' : ink}
      strokeWidth={strokeWidth}
      strokeLinecap="butt"
      aria-hidden
    >
      {ICONS[name]}
    </Svg>
  );
}

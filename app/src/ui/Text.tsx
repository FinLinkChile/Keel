import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, fonts, type Colors, type MonoWeight, type SansWeight } from './theme';

type ColorName = Exclude<keyof Colors, 'avatar'>;

type Props = RNTextProps & {
  size?: number;
  color?: ColorName;
  // Line height as a multiple of size
  leading?: number;
  tracking?: number;
} & ({ mono?: false; weight?: SansWeight } | { mono: true; weight?: MonoWeight });

// The only text primitive of the app: Figtree, or IBM Plex Mono for figures and ids.
export function Text({ size = 16, color = 'text', leading, tracking, mono, weight, style, ...rest }: Props) {
  const fontFamily = mono ? fonts.mono[(weight ?? 400) as MonoWeight] : fonts.sans[(weight ?? 400) as SansWeight];
  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily,
          fontSize: size,
          color: colors[color],
          lineHeight: leading ? Math.round(size * leading) : undefined,
          letterSpacing: tracking,
        },
        style,
      ]}
    />
  );
}

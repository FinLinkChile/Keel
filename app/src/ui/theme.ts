// Design tokens of "Keel Dark Screens" (claude.ai/design). Screens use these names,
// never a hex value, so the light theme only has to provide another `Colors`.

export const dark = {
  // Screen ground and the outer canvas of the web build
  bg: '#000000',
  canvas: '#111113',
  // Rows, cards and the tab bar
  surface: '#1C1C1E',
  // Segmented controls, own avatar, dividers inside a surface
  surfaceRaised: '#2C2C2E',
  // Outline buttons and the line of the steps
  line: '#3A3A3E',
  // Divider between rows drawn on the ground
  divider: '#1C1C1E',
  dividerOnSurface: '#2C2C2E',

  text: '#F5F5F7',
  // Amounts that are not the main figure
  textSoft: '#D4D4D8',
  textMuted: '#A1A1A8',
  textFaint: '#8D8D93',
  // Unselected radio ring
  control: '#5A5A60',

  // Main action
  accent: '#A8B4FF',
  accentHalo: 'rgba(168,180,255,0.18)',
  onAccent: '#000000',

  // One accent per meaning
  yourTurn: '#FFD60A',
  money: '#5DD3A6',
  moneyMuted: '#13302A',
  danger: '#FF6A5C',
  dangerMuted: '#2A1513',

  // Navy panel for money and the agent
  moneyPanel: '#1B1F3A',
  moneyPanelTop: '#2A3160',
  moneyPanelLine: '#353D70',
  // Main figures on the panel, which is dark in both themes
  moneyPanelInk: '#F5F5F7',
  moneyPanelText: '#B4BBDD',
  moneyPanelIcon: '#8C94C2',
  // Funds still locked, in charts and legends
  locked: '#4A5070',

  // Counterparty avatars, picked per party
  avatar: ['#F4B183', '#8ECBF0', '#E3BDF0', '#C8D99A'] as const,
  onAvatar: '#000000',
} as const;

export type Colors = { [K in keyof typeof dark]: K extends 'avatar' ? readonly string[] : string };

// Light counterpart of every token. The navy money panel keeps its own look in both themes.
export const light: Colors = {
  bg: '#F2F2F7',
  canvas: '#E5E5EA',
  surface: '#FFFFFF',
  surfaceRaised: '#E9E9EE',
  line: '#C7C7CC',
  divider: '#E1E1E6',
  dividerOnSurface: '#E9E9EE',

  text: '#111113',
  textSoft: '#3A3A3E',
  textMuted: '#55555C',
  textFaint: '#6E6E75',
  control: '#A8A8AE',

  accent: '#4A5BD4',
  accentHalo: 'rgba(74,91,212,0.16)',
  onAccent: '#FFFFFF',

  yourTurn: '#C78500',
  money: '#0E8F63',
  moneyMuted: '#DDF3EA',
  danger: '#D93025',
  dangerMuted: '#FBE4E1',

  moneyPanel: dark.moneyPanel,
  moneyPanelTop: dark.moneyPanelTop,
  moneyPanelLine: dark.moneyPanelLine,
  moneyPanelInk: dark.moneyPanelInk,
  moneyPanelText: dark.moneyPanelText,
  moneyPanelIcon: dark.moneyPanelIcon,
  locked: '#8A90B4',

  avatar: dark.avatar,
  onAvatar: '#000000',
};

export type ThemeMode = 'dark' | 'light';

// The palette in use. It is one object that applyTheme rewrites, so every screen that reads
// `colors` while rendering gets the new values; ThemeProvider remounts the screens when it changes.
export const colors: Colors = { ...dark };

export function applyTheme(mode: ThemeMode) {
  Object.assign(colors, mode === 'light' ? light : dark);
}

// Every weight is its own font face (expo-google-fonts), so text picks a family and
// never sets fontWeight.
export const fonts = {
  sans: {
    400: 'Figtree_400Regular',
    500: 'Figtree_500Medium',
    600: 'Figtree_600SemiBold',
    700: 'Figtree_700Bold',
    800: 'Figtree_800ExtraBold',
  },
  sansItalic800: 'Figtree_800ExtraBold_Italic',
  mono: {
    400: 'IBMPlexMono_400Regular',
    500: 'IBMPlexMono_500Medium',
    600: 'IBMPlexMono_600SemiBold',
  },
} as const;

export type SansWeight = keyof typeof fonts.sans;
export type MonoWeight = keyof typeof fonts.mono;

export const radius = {
  row: 20,
  card: 24,
  sheet: 28,
  pill: 999,
} as const;

// Side gutter of every screen
export const gutter = 20;

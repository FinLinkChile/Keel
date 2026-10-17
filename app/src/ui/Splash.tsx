import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';

import { letterWidth, Logo, LOGO_LETTERS, LogoLetter, LogoTile } from './Logo';
import { colors } from './theme';

// The opening of the app, over the first screen, once per launch:
//   1. the tab pops in and the letters "eel" appear one by one;
//   2. after a beat the letters slide back into the K and the tab is left alone, centered;
//   3. the tab grows until it fills the screen, and the screen dissolves into the sign-up
//      (or Connect, when the phone already signed up), which is running underneath.
// With "reduce motion" on it shows the logo still and fades out.

const S = 2;
const TILE_W = 37 * S;
const OVERLAP = 5 * S;
// Where each letter sits after the tab, from the font
const WIDTHS = LOGO_LETTERS.map((c) => letterWidth(c, S));
const LEFTS = WIDTHS.map((_, i) => WIDTHS.slice(0, i).reduce((a, b) => a + b, 0));
const LETTERS_W = WIDTHS.reduce((a, b) => a + b, 0);
const { width: W, height: H } = Dimensions.get('window');
// Enough for the slanted tab to cover the whole screen from its center
const GROW = Math.ceil((Math.max(W, H) / (37 * S)) * 3);

export function Splash({ onDone }: { onDone: () => void }) {
  const [reduced, setReduced] = useState<boolean>();
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => setReduced(false));
  }, []);

  // Black like the native launch screen, so there is no jump between the two
  return (
    <View
      pointerEvents="auto"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }]}
    >
      {reduced === undefined ? null : reduced ? <StillLogo onDone={onDone} /> : <MovingLogo onDone={onDone} />}
    </View>
  );
}

function StillLogo({ onDone }: { onDone: () => void }) {
  const fade = useRef(new Animated.Value(1)).current;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    Animated.sequence([Animated.delay(900), Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true })]).start(
      ({ finished }) => finished && done.current(),
    );
  }, [fade]);
  return (
    <Animated.View style={{ opacity: fade }}>
      <Logo scale={S} />
    </Animated.View>
  );
}

function MovingLogo({ onDone }: { onDone: () => void }) {
  const tab = useRef(new Animated.Value(0)).current;
  const show = useRef(LOGO_LETTERS.map(() => new Animated.Value(0))).current;
  const hide = useRef(LOGO_LETTERS.map(() => new Animated.Value(0))).current;
  const center = useRef(new Animated.Value(0)).current;
  const bump = useRef(new Animated.Value(0)).current;
  const grow = useRef(new Animated.Value(0)).current;
  const glyph = useRef(new Animated.Value(1)).current;
  const dissolve = useRef(new Animated.Value(0)).current;
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const native = { useNativeDriver: true } as const;
    const animation = Animated.sequence([
      Animated.timing(tab, { toValue: 1, duration: 380, easing: Easing.out(Easing.back(1.6)), ...native }),
      Animated.stagger(110, show.map((v) => Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), ...native }))),
      Animated.delay(600),
      // The letters fold into the K, from the last one, while the K glides to the center
      Animated.parallel([
        Animated.stagger(80, [...hide].reverse().map((v) => Animated.timing(v, { toValue: 1, duration: 380, easing: Easing.in(Easing.cubic), ...native }))),
        Animated.timing(center, { toValue: 1, duration: 560, easing: Easing.inOut(Easing.cubic), ...native }),
      ]),
      Animated.timing(bump, { toValue: 1, duration: 170, easing: Easing.out(Easing.quad), ...native }),
      Animated.delay(100),
      Animated.parallel([
        Animated.timing(glyph, { toValue: 0, duration: 180, ...native }),
        Animated.timing(grow, { toValue: 1, duration: 640, easing: Easing.in(Easing.cubic), ...native }),
      ]),
      Animated.timing(dissolve, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), ...native }),
    ]);
    animation.start(({ finished }) => finished && done.current());
    return () => animation.stop();
  }, [tab, show, hide, center, bump, grow, glyph, dissolve]);

  // The tab grows around its own center, which by then is the center of the screen
  const scale = Animated.multiply(
    Animated.multiply(tab.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }), bump.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] })),
    grow.interpolate({ inputRange: [0, 1], outputRange: [1, GROW] }),
  );
  // The row is centered with its letters; without them the tab is off by half their width
  const shift = center.interpolate({ inputRange: [0, 1], outputRange: [0, (LETTERS_W - OVERLAP) / 2] });
  // Each letter ends with its center on the center of the tab, under it
  const under = (i: number) =>
    hide[i]!.interpolate({ inputRange: [0, 1], outputRange: [0, TILE_W / 2 - (TILE_W - OVERLAP + LEFTS[i]! + WIDTHS[i]! / 2)] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', opacity: Animated.subtract(1, dissolve) }]}>
      {/* The same row as Logo, with the tab drawn over the letters */}
      <Animated.View style={{ flexDirection: 'row', alignItems: 'flex-end', transform: [{ translateX: shift }] }}>
        <Animated.View style={{ zIndex: 2, opacity: tab, transform: [{ scale }] }}>
          <LogoTile scale={S} part="shape" />
          <Animated.View style={{ position: 'absolute', opacity: glyph }}>
            <LogoTile scale={S} part="glyph" />
          </Animated.View>
        </Animated.View>
        <View style={{ zIndex: 1, flexDirection: 'row', marginLeft: -OVERLAP }}>
          {LOGO_LETTERS.map((char, i) => (
            <Animated.View
              key={i}
              style={{
                opacity: Animated.multiply(show[i]!, Animated.subtract(1, hide[i]!)),
                transform: [{ translateY: show[i]!.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }, { translateX: under(i) }],
              }}
            >
              <LogoLetter char={char} scale={S} />
            </Animated.View>
          ))}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

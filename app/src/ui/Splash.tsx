import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';

import { Logo, LOGO_LETTERS, LogoLetter, LogoTile } from './Logo';
import { colors } from './theme';

// The opening of the app, over the first screen, once per launch:
//   1. the tab pops in and the letters "eel" appear one by one;
//   2. after a beat the letters slide back into the K and the tab is left alone, centered;
//   3. the tab grows until it fills the screen, and the screen dissolves into the sign-up
//      (or Connect, when the phone already signed up), which is running underneath.
// With "reduce motion" on it shows the logo still and fades out.

const S = 2;
// The letters are drawn in a line box shorter than the font, so they spill above and below it; the
// window that clips them has this much room, and a little more on the right for the slant of the l
const PAD = 16 * S;
const SLANT = 8 * S;
const TILE_W = 37 * S;
const OVERLAP = 5 * S;
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
  // Width of the letters, measured once so they can be folded away
  const [lettersWidth, setLettersWidth] = useState<number | null>(null);
  const tab = useRef(new Animated.Value(0)).current;
  const show = useRef(LOGO_LETTERS.map(() => new Animated.Value(0))).current;
  const hide = useRef(LOGO_LETTERS.map(() => new Animated.Value(0))).current;
  // Width of the window of the letters. Wide while they are measured, then exactly their width
  const width = useRef(new Animated.Value(W)).current;
  const bump = useRef(new Animated.Value(0)).current;
  const grow = useRef(new Animated.Value(0)).current;
  const glyph = useRef(new Animated.Value(1)).current;
  const dissolve = useRef(new Animated.Value(0)).current;
  // The latest callback, so a re-render of the parent never restarts the animation
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (lettersWidth === null) return;
    width.setValue(lettersWidth + SLANT);
    const native = { useNativeDriver: true } as const;
    const animation = Animated.sequence([
      Animated.timing(tab, { toValue: 1, duration: 380, easing: Easing.out(Easing.back(1.6)), ...native }),
      Animated.stagger(
        110,
        show.map((v) => Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), ...native })),
      ),
      Animated.delay(600),
      // The letters fold into the K from the last one, while the width closes and the tab glides to the center
      Animated.parallel([
        Animated.stagger(
          80,
          [...hide].reverse().map((v) => Animated.timing(v, { toValue: 1, duration: 380, easing: Easing.in(Easing.cubic), ...native })),
        ),
        Animated.timing(width, { toValue: 0, duration: 560, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      ]),
      Animated.timing(bump, { toValue: 1, duration: 170, easing: Easing.out(Easing.quad), ...native }),
      Animated.delay(100),
      // The K fades and the tab grows over the screen
      Animated.parallel([
        Animated.timing(glyph, { toValue: 0, duration: 180, ...native }),
        Animated.timing(grow, { toValue: 1, duration: 640, easing: Easing.in(Easing.cubic), ...native }),
      ]),
      Animated.timing(dissolve, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), ...native }),
    ]);
    animation.start(({ finished }) => finished && done.current());
    return () => animation.stop();
  }, [lettersWidth, tab, show, hide, width, bump, grow, glyph, dissolve]);

  const scale = Animated.multiply(
    Animated.multiply(tab.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }), bump.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] })),
    grow.interpolate({ inputRange: [0, 1], outputRange: [1, GROW] }),
  );

  return (
    // The whole screen dissolves at the end, revealing the app underneath
    <Animated.View
      style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', opacity: Animated.subtract(1, dissolve) }]}
    >
      {/* Same geometry as Logo: the tab and the letters share the top and the height of the tab.
          Everything is placed, not aligned, so the letters cannot drift. The box is as wide as
          what is showing, so the tab stays centered while the letters fold away. */}
      <Animated.View style={{ width: Animated.add(width, TILE_W - OVERLAP), height: 40 * S }}>
        <Animated.View style={{ position: 'absolute', left: 0, top: 0, opacity: tab, transform: [{ scale }] }}>
          <LogoTile scale={S} part="shape" />
          <Animated.View style={{ position: 'absolute', opacity: glyph }}>
            <LogoTile scale={S} part="glyph" />
          </Animated.View>
        </Animated.View>

        {/* Clips the letters at the edge of the tab, so they seem to go into it */}
        <Animated.View style={{ position: 'absolute', left: TILE_W - OVERLAP, top: -PAD, height: 40 * S + 2 * PAD, width, overflow: 'hidden' }}>
          <View
            style={{ position: 'absolute', left: 0, top: PAD, flexDirection: 'row' }}
            onLayout={(e) => lettersWidth === null && setLettersWidth(e.nativeEvent.layout.width)}
          >
            {LOGO_LETTERS.map((char, i) => (
              <Animated.View
                key={i}
                style={{
                  opacity: Animated.multiply(show[i]!, Animated.subtract(1, hide[i]!)),
                  transform: [
                    { translateY: show[i]!.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                    { translateX: hide[i]!.interpolate({ inputRange: [0, 1], outputRange: [0, -(lettersWidth ?? 0)] }) },
                  ],
                }}
              >
                <LogoLetter char={char} scale={S} />
              </Animated.View>
            ))}
          </View>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

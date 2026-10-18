import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { colors } from './theme';

export type StepState = 'done' | 'current' | 'todo' | 'stopped';

export type Step = {
  key: string;
  title: string;
  detail?: string;
  state: StepState;
  // Right side: a date, a countdown or an amount
  trailing?: ReactNode;
  // Below the text, for instance the record and transaction links
  children?: ReactNode;
};

type Props = {
  steps: Step[];
  // large: order screen (05). compact: exporter screen (10).
  size?: 'large' | 'compact';
};

const SIZES = {
  large: { dot: 32, check: 14, checkStroke: 3.4, inner: 10, title: 16, padY: 10, gap: 14 },
  compact: { dot: 28, check: 12, checkStroke: 3.6, inner: 8, title: 15, padY: 8, gap: 14 },
} as const;

// Vertical line of steps. The line joins the first dot to the last one; each row draws
// the half above and below its dot, so rows can be of any height.
export function Steps({ steps, size = 'large' }: Props) {
  const s = SIZES[size];
  return (
    <View>
      {steps.map((step, i) => {
        // A row with a body or children reads from the top; a one line row is centered.
        const top = step.state === 'current' || !!step.children;
        return (
          <View key={step.key} style={{ flexDirection: 'row', gap: s.gap }}>
            <View style={{ width: s.dot, alignItems: 'center' }}>
              <Segment visible={i > 0} grow={!top} fixed={top ? s.padY : undefined} />
              <Dot state={step.state} s={s} />
              <Segment visible={i < steps.length - 1} grow />
            </View>
            {/* At least as tall as the dot with its padding, as in the design */}
            <View style={{ flex: 1, minHeight: s.dot + 2 * s.padY, paddingVertical: s.padY, gap: 10, justifyContent: 'center' }}>
              {step.state === 'current' ? (
                // Countdown beside the title, the explanation full width below it
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text size={s.title + 1} weight={700} style={{ flex: 1 }}>
                      {step.title}
                    </Text>
                    {step.trailing}
                  </View>
                  {step.detail ? (
                    <Text size={14} leading={1.45} color="textMuted">
                      {step.detail}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text size={s.title} weight={600} color={step.state === 'todo' ? 'textFaint' : 'text'}>
                      {step.title}
                    </Text>
                    {step.detail ? (
                      <Text size={13} color="textFaint">
                        {step.detail}
                      </Text>
                    ) : null}
                  </View>
                  {step.trailing}
                </View>
              )}
              {step.children}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Segment({ visible, grow, fixed }: { visible: boolean; grow?: boolean; fixed?: number }) {
  return (
    <View
      style={{
        width: 2,
        flexGrow: fixed === undefined && grow ? 1 : 0,
        height: fixed,
        backgroundColor: visible ? colors.line : 'transparent',
      }}
    />
  );
}

function Dot({ state, s }: { state: StepState; s: (typeof SIZES)[keyof typeof SIZES] }) {
  const base = { width: s.dot, height: s.dot, borderRadius: s.dot / 2, alignItems: 'center', justifyContent: 'center' } as const;
  if (state === 'done') {
    return (
      <View style={[base, { backgroundColor: colors.moneyMuted }]}>
        <Icon name="check" size={s.check} strokeWidth={s.checkStroke} color="money" />
      </View>
    );
  }
  if (state === 'current') {
    return (
      <View style={base}>
        <View
          style={{
            position: 'absolute',
            top: -5,
            left: -5,
            width: s.dot + 10,
            height: s.dot + 10,
            borderRadius: (s.dot + 10) / 2,
            backgroundColor: colors.accentHalo,
          }}
        />
        <View style={[base, { backgroundColor: colors.accent }]}>
          <View style={{ width: s.inner, height: s.inner, borderRadius: s.inner / 2, backgroundColor: colors.onAccent }} />
        </View>
      </View>
    );
  }
  if (state === 'stopped') {
    return (
      <View style={[base, { backgroundColor: colors.dangerMuted }]}>
        <Icon name="info" size={s.check + 2} strokeWidth={2.6} color="danger" />
      </View>
    );
  }
  return <View style={[base, { borderWidth: 2, borderColor: colors.line, backgroundColor: colors.bg }]} />;
}

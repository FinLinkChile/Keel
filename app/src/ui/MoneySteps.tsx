import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { colors, radius } from './theme';

export type MoneyStep = { title: string; amount?: string; text: string };

// "How the money moves" / "When you get paid": numbered steps joined by a line, with a note at
// the end. The first step is filled, because it is the one that happens at signing.
export function MoneySteps({ title, steps, note }: { title: string; steps: MoneyStep[]; note?: ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.sheet, paddingVertical: 22, paddingHorizontal: 20 }}>
      <Text size={18} weight={800} accessibilityRole="header" style={{ marginBottom: 18 }}>
        {title}
      </Text>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <View key={step.title} style={{ flexDirection: 'row', gap: 14 }}>
            <View style={{ alignItems: 'center', width: 28 }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: i === 0 ? colors.accent : 'transparent',
                  borderWidth: i === 0 ? 0 : 2,
                  borderColor: colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text mono size={13} weight={600} color={i === 0 ? 'onAccent' : 'text'}>
                  {i + 1}
                </Text>
              </View>
              {!last ? <View style={{ flex: 1, width: 2, backgroundColor: colors.line, marginVertical: 4 }} /> : null}
            </View>
            <View style={{ flex: 1, gap: 4, paddingBottom: last ? 0 : 18 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <Text size={16} weight={700} style={{ flex: 1 }}>
                  {step.title}
                </Text>
                {step.amount ? (
                  <Text mono size={16} weight={600}>
                    {step.amount}
                  </Text>
                ) : null}
              </View>
              <Text size={14} leading={1.45} color="textMuted">
                {step.text}
              </Text>
            </View>
          </View>
        );
      })}
      {note ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.dividerOnSurface }}>
          <View style={{ marginTop: 1 }}>
            <Icon name="info" size={18} />
          </View>
          <Text size={14} leading={1.45} color="textMuted" style={{ flex: 1 }}>
            {note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

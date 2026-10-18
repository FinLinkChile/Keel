import type { Hex } from '@keel/schemas';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Bar } from '@/data/insights';

import { formatCompact } from './format';
import { Icon } from './Icon';
import { Stars } from './Stars';
import { Text } from './Text';
import { colors } from './theme';

// Horizontal bars of the agent panel. A bar opens the orders it adds up, so each number can be
// traced to its orders.
export function BarList({ bars, labelOf }: { bars: Bar[]; labelOf: (orderId: Hex) => string }) {
  const [open, setOpen] = useState<string>();
  const top = bars[0]?.cents ?? 0;
  return (
    <View style={{ gap: 14 }}>
      {bars.map((bar) => (
        <View key={bar.key} style={{ gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${bar.label}, USD ${formatCompact(BigInt(bar.cents))}, ${bar.orderIds.length} orders`}
            onPress={() => setOpen(open === bar.key ? undefined : bar.key)}
            style={({ pressed }) => ({ gap: 6, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text size={15} weight={700} style={{ flex: 1 }} numberOfLines={1}>
                {bar.label}
              </Text>
              {bar.stars !== undefined && bar.stars !== null ? <Stars value={bar.stars} size={11} /> : null}
              <Text mono size={13} color="textSoft">
                USD {formatCompact(BigInt(bar.cents))}
              </Text>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceRaised, overflow: 'hidden' }}>
              <View style={{ width: `${top > 0 ? Math.max(4, (bar.cents / top) * 100) : 0}%`, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />
            </View>
            <Text size={12} color="textFaint">
              {bar.orderIds.length} {bar.orderIds.length === 1 ? 'order' : 'orders'}
            </Text>
          </Pressable>
          {open === bar.key
            ? bar.orderIds.map((orderId) => (
                <Pressable
                  key={orderId}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/order/[orderId]', params: { orderId } })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, opacity: pressed ? 0.6 : 1 })}
                >
                  <Text size={14} color="textMuted" style={{ flex: 1 }}>
                    {labelOf(orderId)}
                  </Text>
                  <Icon name="chevron" size={14} color="textFaint" />
                </Pressable>
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

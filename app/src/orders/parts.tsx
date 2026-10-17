import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, gutter } from '@/ui/theme';

// Pieces shared by the screens that review an order before it is signed.

export const goBack = () => (router.canGoBack() ? router.back() : router.replace('/home'));

// The screen shell: back, the order label in the middle, content, scroll
export function Frame({ label, children }: { label: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: Math.max(52, insets.top + 8), paddingBottom: insets.bottom + 32, paddingHorizontal: gutter, gap: 26 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: -8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="back" size={22} />
        </Pressable>
        <Text mono size={14} color="textMuted" style={{ flex: 1, textAlign: 'center' }}>
          {label}
        </Text>
        <View style={{ width: 44 }} />
      </View>
      {children}
    </ScrollView>
  );
}

export function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.divider }}>
      <Text size={15} color="textMuted" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text mono={mono} size={mono ? 14 : 15} weight={mono ? undefined : 600} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

// A thing the contract does (ok) or cannot do
export function Bullet({ ok = false, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ marginTop: 2 }}>
        <Icon name={ok ? 'check' : 'lock'} size={14} strokeWidth={2.6} color={ok ? 'money' : 'textMuted'} />
      </View>
      <Text size={14} leading={1.45} color="textSoft" style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

// Where an order stands once this person has nothing to sign: signed, waiting, or rejected
export function StatusView({ label, title, text, goods, tone, onDone }: { label: string; title: string; text: string; goods: string; tone: 'done' | 'wait' | 'no'; onDone: () => void }) {
  return (
    <Frame label={label}>
      <View style={{ alignItems: 'center', gap: 12, paddingVertical: 32 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: tone === 'done' ? colors.moneyMuted : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={tone === 'done' ? 'check' : 'info'} size={28} strokeWidth={3} color={tone === 'done' ? 'money' : 'textMuted'} />
        </View>
        <Text size={24} weight={800} accessibilityRole="header" style={{ textAlign: 'center' }}>
          {title}
        </Text>
        <Text size={15} leading={1.5} color="textMuted" style={{ textAlign: 'center', maxWidth: 300 }}>
          {text}
        </Text>
        <Text size={15} weight={700}>
          {goods}
        </Text>
      </View>
      <Button label="Done" onPress={onDone} />
    </Frame>
  );
}

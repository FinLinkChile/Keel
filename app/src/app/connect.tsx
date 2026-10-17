import { Redirect, router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/session';
import { Address } from '@/ui/Address';
import { Button } from '@/ui/Button';
import { Logo } from '@/ui/Logo';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { colors, gutter, radius } from '@/ui/theme';

// 01 Connect: the wallet on this device and the account type. Keel Personal is shown
// but disabled until open decision 14 sets its depth.
export default function Connect() {
  const insets = useSafeAreaInsets();
  const { signer, address, role, setRole, createWallet, disconnect, onboarding } = useSession();
  const connected = !!signer && !!address;
  // The screen is meant to fit without scrolling; it scrolls only on a phone too small for it,
  // so the button is never cut off
  const [boxHeight, setBoxHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  // Nobody gets past Connect before signing up
  if (onboarding === null) return <Redirect href="/onboarding" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      bounces={false}
      showsVerticalScrollIndicator={false}
      scrollEnabled={contentHeight > boxHeight}
      onLayout={(e) => setBoxHeight(e.nativeEvent.layout.height)}
      onContentSizeChange={(_, h) => setContentHeight(h)}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: Math.max(24, insets.top),
        paddingBottom: insets.bottom + 8,
        paddingHorizontal: gutter,
        gap: 16,
      }}
    >
      <Logo />

      <Text size={28} weight={800} leading={1.1} tracking={-1} accessibilityRole="header">
        Payments that wait for proof.
      </Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: colors.surface,
          borderRadius: radius.row,
          paddingVertical: 14,
          paddingHorizontal: 16,
        }}
      >
        <View style={{ width: 16, alignItems: 'center' }}>
          {connected ? (
            <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accentHalo, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />
            </View>
          ) : (
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.control }} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text size={15} weight={700}>
            {connected ? 'Wallet connected' : 'No wallet on this phone'}
          </Text>
          {connected ? (
            <Address address={address} />
          ) : (
            <Text size={13} color="textMuted">
              Set up a test wallet to sign with
            </Text>
          )}
        </View>
        {connected ? (
          <Pressable accessibilityRole="button" onPress={disconnect} hitSlop={10}>
            <Text size={14} weight={700} style={{ textDecorationLine: 'underline' }}>
              Change
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Development builds, or a test build made with EXPO_PUBLIC_WALLET_CHECK=1: reach the wallet
          check, where the full address can be copied for ingest's registry */}
      {(__DEV__ || process.env.EXPO_PUBLIC_WALLET_CHECK === '1') && connected ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push('/dev/signature')}
          hitSlop={10}
          style={{ alignSelf: 'flex-start', marginTop: -16, marginLeft: 16 }}
        >
          <Text size={13} weight={700} color="textMuted" style={{ textDecorationLine: 'underline' }}>
            Wallet check
          </Text>
        </Pressable>
      ) : null}

      <View style={{ gap: 12 }}>
        <Text size={20} weight={800} accessibilityRole="header">
          Use Keel as
        </Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Account type" style={{ gap: 10 }}>
          <Option
            selected
            title="Company"
            body="Purchase orders paid through escrow: advance on signing, balance on proven shipment."
          >
            <View style={{ marginLeft: 34 }}>
              <Segmented options={ROLES} value={role} onChange={setRole} on="surface" role="radiogroup" accessibilityLabel="Role" />
            </View>
          </Option>
          <Option
            disabled
            title="Personal"
            body="Rent, power and internet bills, paid only to people you verified."
            note="Not available in this version."
          />
        </View>
      </View>

      <View style={{ marginTop: 'auto', gap: 12 }}>
        {connected ? (
          <Button label="Continue" onPress={() => router.replace('/home')} />
        ) : (
          <Button label="Set up test wallet" onPress={createWallet} disabled={signer === undefined} />
        )}
        <Text size={13} leading={1.5} color="textFaint" style={{ textAlign: 'center' }}>
          Keel never holds your key. You sign from this wallet, and the agent only acts inside the limits your
          company set.
        </Text>
      </View>
    </ScrollView>
  );
}

function Option({
  title,
  body,
  note,
  selected = false,
  disabled = false,
  children,
}: {
  title: string;
  body: string;
  note?: string;
  selected?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <View
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={title}
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1.5,
        borderColor: selected ? colors.accent : colors.surface,
        padding: 18,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View
          style={{
            width: 22,
            height: 22,
            marginTop: 1,
            borderRadius: 11,
            borderWidth: 2,
            borderColor: selected ? colors.accent : colors.control,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} /> : null}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text size={17} weight={700} color={disabled ? 'textMuted' : 'text'}>
            {title}
          </Text>
          <Text size={14} leading={1.45} color="textMuted">
            {body}
          </Text>
          {note ? (
            <Text size={13} color="textFaint">
              {note}
            </Text>
          ) : null}
        </View>
      </View>
      {children}
    </View>
  );
}

const ROLES = [
  { value: 'importer' as const, label: 'I import' },
  { value: 'exporter' as const, label: 'I export' },
];

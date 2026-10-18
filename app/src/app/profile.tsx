import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useData } from '@/data';
import { LANGUAGES, useLanguage } from '@/i18n';
import { WalletRegistrations } from '@/orders/WalletRegistrations';
import { useSession } from '@/session';
import { Address } from '@/ui/Address';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { formatRut } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { useTheme } from '@/ui/ThemeProvider';
import { colors, gutter, radius } from '@/ui/theme';

// Profile: the company and wallet behind this session, and the way back to Connect to choose
// again how to use Keel. Logging out keeps the test wallet on the phone: only the role is chosen
// again, so the same addresses stay registered with ingest.
export default function Profile() {
  const insets = useSafeAreaInsets();
  const { role, address, onboarding, resetOnboarding } = useSession();
  const { language, setLanguage, t } = useLanguage();
  const { mode, setMode } = useTheme();
  const profile = useData(async (d) => {
    const account = await d.account(role);
    const me = await d.party(account.party);
    return me ? { account, me } : null;
  }, [role]);

  if (!profile) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  const { account, me } = profile;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingTop: Math.max(52, insets.top + 8),
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: gutter,
        gap: 24,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: -8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="back" size={22} />
        </Pressable>
      </View>

      <View style={{ alignItems: 'center', gap: 10, marginTop: -8 }}>
        <Avatar name={me.name} size={44} />
        <Text size={26} weight={800} accessibilityRole="header" style={{ textAlign: 'center' }}>
          {me.name}
        </Text>
        <Text size={15} color="textMuted">
          {role === 'importer' ? t('Importer') : t('Exporter')}, {t(account.title)}
        </Text>
      </View>

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: 8 }}>
        <Row label={t('Account')} value={t('Company')} />
        <Row label={t('Role')} value={role === 'importer' ? t('Importer') : t('Exporter')} />
        <Row label={t('Based in')} value={me.place} />
        {me.taxId ? <Row label="RUT" value={formatRut(me.taxId)} mono /> : null}
      </View>

      {onboarding ? (
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: 8 }}>
          <Row label={t('Account holder')} value={onboarding.representative.name} />
          <Row label={t('Holder RUT')} value={formatRut(onboarding.representative.rut)} mono />
          <Row label={t('Email')} value={onboarding.company.email} />
          <Row label={t('Mobile')} value={onboarding.company.phone} mono />
          <Row label={t('Identity')} value={t('Validated with TOC (simulated)')} />
        </View>
      ) : null}

      {address ? (
        <View style={{ gap: 8 }}>
          <Text size={15} weight={700}>
            {t('Test wallet')}
          </Text>
          <Address address={address} full />
          <Text size={13} leading={1.5} color="textFaint">
            {t('The key was made on this phone and stays here. Keel never holds it.')}
          </Text>
        </View>
      ) : null}

      {/* With the Keel API: whether the server knows these wallets, and the address to register */}
      <WalletRegistrations />

      <View style={{ gap: 8 }}>
        <Text size={15} weight={700}>
          {t('Language')}
        </Text>
        <Segmented
          options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          value={language}
          onChange={setLanguage}
          accessibilityLabel={t('Language')}
          on="surface"
          role="radiogroup"
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text size={15} weight={700}>
          {t('Appearance')}
        </Text>
        <Segmented
          options={[
            { value: 'dark' as const, label: t('Dark') },
            { value: 'light' as const, label: t('Light') },
          ]}
          value={mode}
          onChange={setMode}
          accessibilityLabel={t('Appearance')}
          on="surface"
          role="radiogroup"
        />
      </View>

      <View style={{ gap: 10, marginTop: 8 }}>
        <Button label={t('Log out')} variant="secondary" onPress={() => router.replace('/connect')} />
        <Text size={13} leading={1.5} color="textFaint" style={{ textAlign: 'center' }}>
          {t('You go back to choose how you use Keel. Your test wallet stays on this phone.')}
        </Text>
        {/* Test builds only: do the sign-up again */}
        {__DEV__ || process.env.EXPO_PUBLIC_WALLET_CHECK === '1' ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={async () => {
              await resetOnboarding();
              router.replace('/onboarding');
            }}
            style={{ alignSelf: 'center', marginTop: 6 }}
          >
            <Text size={13} weight={700} color="textMuted" style={{ textDecorationLine: 'underline' }}>
              {t('Sign up again')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 10, paddingHorizontal: 20 }}>
      <Text size={15} color="textMuted">
        {label}
      </Text>
      <Text size={15} mono={mono} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

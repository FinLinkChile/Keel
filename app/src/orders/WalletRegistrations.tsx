import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { config } from '@/config';
import { api, currentSigners } from '@/data';
import { apiProblemFor } from '@/data/apiProblem';
import { checkRegistrations, type WalletRegistration } from '@/data/registration';
import { useT } from '@/i18n';
import { Address } from '@/ui/Address';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

// The wallets of this phone as the Keel server sees them (registration.ts). The importer's wallet
// must be registered by the operator as a representative of the company's Safe before any buyer
// action works; this shows the exact address to register, so nobody has to guess it. Only with
// the Keel API configured.
export function WalletRegistrations() {
  const t = useT();
  const [rows, setRows] = useState<WalletRegistration[] | undefined>();
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    if (!api) return;
    setChecking(true);
    try {
      setRows(await checkRegistrations(api, currentSigners(), config.importerSafe));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (!api) return null;

  return (
    <View style={{ gap: 8 }}>
      <Text size={15} weight={700}>
        {t('On the Keel server')}
      </Text>
      {rows === undefined ? (
        <Text size={14} color="textMuted">
          {t('Checking…')}
        </Text>
      ) : rows.length === 0 ? (
        <Text size={14} color="textMuted">
          {t('No wallet on this phone yet.')}
        </Text>
      ) : (
        rows.map((r) => (
          <View key={r.role} style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: 12, paddingHorizontal: 16, gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text size={15} weight={700}>
                {r.role === 'importer' ? t('Buyer wallet') : t('Supplier wallet')}
              </Text>
              <Text size={14} weight={700} color={r.status === 'registered' || r.status === 'not_needed' ? 'money' : r.status === 'not_registered' ? 'danger' : 'textMuted'}>
                {statusWord(r, t)}
              </Text>
            </View>
            <Address address={r.address} full />
            <Text size={13} leading={1.5} color="textFaint">
              {explanation(r, t)}
            </Text>
          </View>
        ))
      )}
      <Pressable accessibilityRole="button" hitSlop={10} disabled={checking} onPress={check} style={{ alignSelf: 'flex-start' }}>
        <Text size={13} weight={700} color="textMuted" style={{ textDecorationLine: 'underline' }}>
          {checking ? t('Checking…') : t('Check again')}
        </Text>
      </Pressable>
    </View>
  );
}

type T = ReturnType<typeof useT>;

export function statusWord(r: WalletRegistration, t: T): string {
  switch (r.status) {
    case 'registered':
      return t('Registered');
    case 'not_registered':
      return t('Not registered');
    case 'not_needed':
      return t('Ready');
    case 'no_safe':
      return t('No Safe set');
    case 'unknown':
      return t('Could not check');
  }
}

export function explanation(r: WalletRegistration, t: T): string {
  switch (r.status) {
    case 'registered':
      return t('This wallet signs for the company’s Safe.');
    case 'not_registered':
      return t('Ask your Keel operator to register this address for the company’s Safe. Until then, buyer actions are refused.');
    case 'not_needed':
      return t('The supplier signs for itself: give this address to the buyer for the order.');
    case 'no_safe':
      return t('This build has no company Safe set, so the registration cannot be checked.');
    case 'unknown':
      return apiProblemFor(r.code ?? 'network');
  }
}

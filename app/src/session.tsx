import type { Hex } from '@keel/schemas';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { config } from '@/config';
import { api, bindApiSigners, bindCompany, bindWallets, refreshData, type Role } from '@/data';
import { toOnboarding, type Draft, type Onboarding } from '@/data/onboarding';
import { onboardingStore } from '@/data/onboardingStore';
import { wallets, type Signer, type Signers } from '@/wallet';

type Session = {
  // The signer of the role chosen at Connect: null while this device has no wallet for it;
  // undefined while loading
  signer: Signer | null | undefined;
  address: Hex | undefined;
  // The addresses of both test wallets of this device
  addresses: Partial<Record<Role, Hex>>;
  role: Role;
  setRole: (role: Role) => void;
  // The sign-up of this phone: null until it is done, undefined while loading
  onboarding: Onboarding | null | undefined;
  completeOnboarding: (draft: Draft) => Promise<void>;
  // Test builds: forgets the sign-up so it can be done again
  resetOnboarding: () => Promise<void>;
  createWallet: () => Promise<void>;
  // Forgets the wallet for this session. The key itself stays on the device.
  disconnect: () => void;
  // Development only (/dev/signature): loads a demo key as the wallet of a role
  importKey: (role: Role, privateKey: string) => Promise<void>;
  // Development only (/dev/signature): deletes the key and disconnects
  resetWallet: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  // null once forgotten for this session; undefined while loading
  const [signers, setSigners] = useState<Signers | null>();
  const [addresses, setAddresses] = useState<Partial<Record<Role, Hex>>>({});
  const [role, setRole] = useState<Role>('importer');
  const [onboarding, setOnboarding] = useState<Onboarding | null>();

  // During render, not in an effect: screens below load their data in their own effects,
  // which run before this provider's, and must already see the wallets.
  bindWallets(addresses, config.importerSafe);
  bindCompany(onboarding?.company);
  // The Keel API signs each request with these wallets (when EXPO_PUBLIC_API_URL is set)
  bindApiSigners(signers);

  // Screens that loaded before the wallets were known read again with them
  useEffect(() => {
    if (api && signers !== undefined) refreshData();
  }, [signers]);

  const use = useCallback(async (s: Signers | null) => {
    const found: Partial<Record<Role, Hex>> = {};
    for (const r of ['importer', 'exporter'] as const) {
      const signer = s?.[r];
      if (signer) found[r] = await signer.address();
    }
    setSigners(s);
    setAddresses(found);
  }, []);

  useEffect(() => {
    wallets.load().then(use);
  }, [use]);

  useEffect(() => {
    onboardingStore.get().then(setOnboarding, () => setOnboarding(null));
  }, []);

  const signer = signers === undefined ? undefined : (signers?.[role] ?? null);

  const value = useMemo<Session>(
    () => ({
      signer,
      address: addresses[role],
      addresses,
      role,
      setRole,
      onboarding,
      completeOnboarding: async (draft) => {
        const done = toOnboarding(draft, Date.now() / 1000);
        await onboardingStore.save(done);
        setOnboarding(done);
      },
      resetOnboarding: async () => {
        await onboardingStore.clear();
        setOnboarding(null);
      },
      createWallet: async () => use(await wallets.create()),
      disconnect: () => use(null),
      importKey: async (r, privateKey) => use(await wallets.importKey(r, privateKey)),
      resetWallet: async () => {
        await wallets.reset();
        await use(null);
      },
    }),
    [signer, addresses, role, onboarding, use],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}

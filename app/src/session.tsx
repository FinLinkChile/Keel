import type { Hex } from '@keel/schemas';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { config } from '@/config';
import { bindWallets, type Role } from '@/data';
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

  // During render, not in an effect: screens below load their data in their own effects,
  // which run before this provider's, and must already see the wallets.
  bindWallets(addresses, config.importerSafe);

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

  const signer = signers === undefined ? undefined : (signers?.[role] ?? null);

  const value = useMemo<Session>(
    () => ({
      signer,
      address: addresses[role],
      addresses,
      role,
      setRole,
      createWallet: async () => use(await wallets.create()),
      disconnect: () => use(null),
      importKey: async (r, privateKey) => use(await wallets.importKey(r, privateKey)),
      resetWallet: async () => {
        await wallets.reset();
        await use(null);
      },
    }),
    [signer, addresses, role, use],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}

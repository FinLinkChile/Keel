import type { Hex } from '@keel/schemas';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { Role } from '@/data';
import { wallet, type Signer } from '@/wallet';

type Session = {
  // null while there is no wallet on this device; undefined while loading
  signer: Signer | null | undefined;
  address: Hex | undefined;
  role: Role;
  setRole: (role: Role) => void;
  createWallet: () => Promise<void>;
  // Forgets the wallet for this session. The key itself stays on the device.
  disconnect: () => void;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [signer, setSigner] = useState<Signer | null>();
  const [address, setAddress] = useState<Hex>();
  const [role, setRole] = useState<Role>('importer');

  const use = useCallback(async (s: Signer | null) => {
    setSigner(s);
    setAddress(s ? await s.address() : undefined);
  }, []);

  useEffect(() => {
    wallet.load().then(use);
  }, [use]);

  const value = useMemo<Session>(
    () => ({
      signer,
      address,
      role,
      setRole,
      createWallet: async () => use(await wallet.create()),
      disconnect: () => use(null),
    }),
    [signer, address, role, use],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}

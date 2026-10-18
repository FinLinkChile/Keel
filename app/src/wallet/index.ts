import type { Hex } from '@keel/schemas';

import type { Role } from '../data/types';

import { keyStore } from './keyStore';
import { ensureKeys, importKey, loadKeys, removeKeys, type Keys } from './keys';
import { localSigner } from './localSigner';
import type { Signers, WalletProvider } from './signer';

export * from './signer';

const signersOf = (keys: Keys): Signers =>
  Object.fromEntries(Object.entries(keys).map(([role, key]) => [role, localSigner(key as Hex)])) as Signers;

// Test wallets of this device, one per role. The keys are generated here and stored by keyStore
// (SecureStore on the phone); they are never sent anywhere and never enter the repository.
export const wallets: WalletProvider = {
  load: async () => signersOf(await loadKeys(keyStore)),
  create: async () => signersOf(await ensureKeys(keyStore)) as Required<Signers>,
  reset: () => removeKeys(keyStore),
  importKey: async (role, privateKey) => {
    await importKey(keyStore, role, privateKey);
    return signersOf(await loadKeys(keyStore));
  },
};

export const ROLES_WITH_KEY: readonly Role[] = ['importer', 'exporter'];

export const keyStorage = keyStore.where;

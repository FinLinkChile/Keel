import type { Hex } from '@keel/schemas';

import { keyStore } from './keyStore';
import { localSigner, newPrivateKey } from './localSigner';
import type { WalletProvider } from './signer';

export * from './signer';

// Test wallet of this device. The key is generated here and stored by keyStore (SecureStore on
// the phone); it is never sent anywhere and never enters the repository.
export const wallet: WalletProvider = {
  load: async () => {
    const key = await keyStore.read();
    return key ? localSigner(key as Hex) : null;
  },
  create: async () => {
    const existing = await keyStore.read();
    if (existing) return localSigner(existing as Hex);
    const key = newPrivateKey();
    await keyStore.write(key);
    return localSigner(key);
  },
  reset: () => keyStore.remove(),
};

export const keyStorage = keyStore.where;

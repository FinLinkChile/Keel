import type { KeyStore } from './keyStore.types';

const key = (name: string) => `keel.testWallet.${name}`;

// Web build only, for development: expo-secure-store does not run in the browser, so the test
// keys sit in this browser's localStorage. The web app will sign with the browser wallet
// (eth_signTypedData_v4) instead, and this file goes away then.
function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const keyStore: KeyStore = {
  where: 'browser-storage',
  read: async (name) => storage()?.getItem(key(name)) ?? null,
  write: async (name, value) => {
    const s = storage();
    if (!s) throw new Error('This browser does not allow storing the test wallet');
    s.setItem(key(name), value);
  },
  remove: async (name) => storage()?.removeItem(key(name)),
};

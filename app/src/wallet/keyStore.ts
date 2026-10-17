import type { KeyStore } from './keyStore.types';

const KEY = 'keel.testWallet.privateKey';

// Web build only, for development: expo-secure-store does not run in the browser, so the test
// key sits in this browser's localStorage. The web app will sign with the browser wallet
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
  read: async () => storage()?.getItem(KEY) ?? null,
  write: async (value) => {
    const s = storage();
    if (!s) throw new Error('This browser does not allow storing the test wallet');
    s.setItem(KEY, value);
  },
  remove: async () => storage()?.removeItem(KEY),
};

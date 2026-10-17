import * as SecureStore from 'expo-secure-store';

import type { KeyStore } from './keyStore.types';

const KEY = 'keel.testWallet.privateKey';

// The test wallet key lives in the iOS Keychain or the Android Keystore of this phone. It is
// not backed up and is lost when the app is uninstalled; it never leaves the device.
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const keyStore: KeyStore = {
  where: 'secure-store',
  read: () => SecureStore.getItemAsync(KEY, options),
  write: (value) => SecureStore.setItemAsync(KEY, value, options),
  remove: () => SecureStore.deleteItemAsync(KEY, options),
};

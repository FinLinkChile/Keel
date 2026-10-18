import * as SecureStore from 'expo-secure-store';

import type { KeyStore } from './keyStore.types';

const key = (name: string) => `keel.testWallet.${name}`;

// The test wallet keys live in the iOS Keychain or the Android Keystore of this phone. They are
// not backed up and are lost when the app is uninstalled; they never leave the device.
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const keyStore: KeyStore = {
  where: 'secure-store',
  read: (name) => SecureStore.getItemAsync(key(name), options),
  write: (name, value) => SecureStore.setItemAsync(key(name), value, options),
  remove: (name) => SecureStore.deleteItemAsync(key(name), options),
};

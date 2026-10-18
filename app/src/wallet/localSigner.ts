import type { Hex } from '@keel/schemas';
import { getRandomValues } from 'expo-crypto';
import { bytesToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { Signer } from './signer';

// A new private key from the platform's secure random source (expo-crypto), so key
// generation does not depend on a global crypto polyfill.
export function newPrivateKey(): Hex {
  for (;;) {
    const key = bytesToHex(getRandomValues(new Uint8Array(32)));
    try {
      privateKeyToAccount(key); // rejects 0 and values outside the curve order
      return key;
    } catch {
      // Astronomically unlikely; draw again
    }
  }
}

// Signs EIP-712 data locally with a key held on this device.
export function localSigner(privateKey: Hex): Signer {
  const account = privateKeyToAccount(privateKey);
  return {
    address: async () => account.address,
    signTypedData: (domain, types, primaryType, message) =>
      account.signTypedData({ domain, types, primaryType, message } as Parameters<typeof account.signTypedData>[0]),
  };
}

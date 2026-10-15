import type { Hex } from '@keel/schemas';

import type { Signer, WalletProvider } from './signer';

export * from './signer';

// Placeholder until the device wallet exists (expo-secure-store key, viem signing). It
// shows the importer address of the mock data and refuses to sign, so no screen can
// pretend a signature happened.
const PLACEHOLDER: Hex = '0x7A3f91C2b04E6d1A8c3F5e2D9b7A0c4E1f6B55D8';

const placeholderSigner: Signer = {
  address: async () => PLACEHOLDER,
  signTypedData: async () => {
    throw new Error('Signing is not available yet: the device wallet is not built');
  },
};

let created = false;

export const wallet: WalletProvider = {
  load: async () => (created ? placeholderSigner : null),
  create: async () => {
    created = true;
    return placeholderSigner;
  },
};

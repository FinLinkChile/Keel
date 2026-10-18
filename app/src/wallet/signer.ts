import type { Hex } from '@keel/schemas';

import type { Role } from '../data/types';

// EIP-712 pieces, shaped like viem's signTypedData arguments.
export type TypedDataDomain = {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: Hex;
};
export type TypedDataField = { name: string; type: string };
export type TypedDataTypes = Record<string, readonly TypedDataField[]>;

// The only thing that signs in the app. Native keeps a test key in secure storage on the
// phone, web asks the browser wallet. No key ever lives on a server.
export interface Signer {
  address(): Promise<Hex>;
  signTypedData(
    domain: TypedDataDomain,
    types: TypedDataTypes,
    primaryType: string,
    message: Record<string, unknown>,
  ): Promise<Hex>;
}

// One signer per role: the device holds a test key for the importer and one for the exporter
export type Signers = Partial<Record<Role, Signer>>;

// Where the app gets its signers from.
export interface WalletProvider {
  // The wallets already set up on this device; a role without a key is missing
  load(): Promise<Signers>;
  // Sets up the test wallets this device lacks and returns both
  create(): Promise<Required<Signers>>;
  // Development only: deletes the test wallet keys from this device
  reset(): Promise<void>;
  // Development only: loads a key made elsewhere as the wallet of a role and returns the wallets
  importKey(role: Role, privateKey: string): Promise<Signers>;
}

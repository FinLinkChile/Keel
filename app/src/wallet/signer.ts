import type { Hex } from '@keel/schemas';

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

// Where the app gets its signer from.
export interface WalletProvider {
  // The wallet already set up on this device, if any
  load(): Promise<Signer | null>;
  // Sets up a test wallet on this device
  create(): Promise<Signer>;
}

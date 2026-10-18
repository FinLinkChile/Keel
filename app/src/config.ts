// Settings that change per environment. They come from the Expo config (EXPO_PUBLIC_*,
// see app/.env.example), never from the code.

import { escrowFrom } from './data/signOrder';

const chainId = Number(process.env.EXPO_PUBLIC_CHAIN_ID);

export const config = {
  // Base URL of ingest, for example http://192.168.1.20:8788. Undefined when not set.
  ingestUrl: process.env.EXPO_PUBLIC_INGEST_URL || undefined,
  // Base URL of the Keel API on AWS (API Gateway), for example https://abc.execute-api.../prod.
  // When set, proposals, orders, what needs you, the wallet and document uploads go through it;
  // unset, the app keeps its proposals on this phone and uploads to ingest directly.
  apiUrl: process.env.EXPO_PUBLIC_API_URL || undefined,
  // Must equal INGEST_CHAIN_ID of ingest: another chain id recovers another address and the
  // upload is rejected as not_a_party. Undefined when not set.
  chainId: Number.isInteger(chainId) && chainId > 0 ? chainId : undefined,
  // TradeEscrow, the contract that checks the signatures of an order. Orders cannot be signed
  // without it, and the app never signs with a placeholder. Undefined when not set.
  escrowAddress: escrowFrom(process.env.EXPO_PUBLIC_ESCROW_ADDRESS),
  // EXPO_PUBLIC_DEMO_SEED=1 shows the example orders and balances of data/mock.ts. Off, the app
  // starts empty and shows only what this phone does.
  demoSeed: process.env.EXPO_PUBLIC_DEMO_SEED === '1',
  // The importer's Safe (contracts/deployments/<chain>.json). It is po.importer: the gate only
  // funds orders whose importer is the Safe. Undefined when not set.
  importerSafe: escrowFrom(process.env.EXPO_PUBLIC_IMPORTER_SAFE),
};

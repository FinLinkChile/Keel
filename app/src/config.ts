// Settings that change per environment. They come from the Expo config (EXPO_PUBLIC_*,
// see app/.env.example), never from the code.

const chainId = Number(process.env.EXPO_PUBLIC_CHAIN_ID);

export const config = {
  // Base URL of ingest, for example http://192.168.1.20:8788. Undefined when not set.
  ingestUrl: process.env.EXPO_PUBLIC_INGEST_URL || undefined,
  // Must equal INGEST_CHAIN_ID of ingest: another chain id recovers another address and the
  // upload is rejected as not_a_party. Undefined when not set.
  chainId: Number.isInteger(chainId) && chainId > 0 ? chainId : undefined,
};

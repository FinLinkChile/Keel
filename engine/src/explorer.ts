// Public block explorers by chain id, so `keel verify` output is one click away from the chain.
export const EXPLORERS: Record<number, string> = {
  84532: "https://sepolia.basescan.org",
  8453: "https://basescan.org",
};

export const explorerTxUrl = (chainId: number, hash: string): string | undefined => {
  const base = EXPLORERS[chainId];
  return base ? `${base}/tx/${hash}` : undefined;
};

export const explorerAddressUrl = (chainId: number, address: string): string | undefined => {
  const base = EXPLORERS[chainId];
  return base ? `${base}/address/${address}` : undefined;
};

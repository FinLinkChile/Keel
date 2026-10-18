import type { KeelData, Wallet } from './types';

// The app without the example orders, balances and pending items of data/mock.ts. The parties
// (companies, suppliers, carrier, arbiter) stay: an order needs someone to be sent to. What is
// shown from here on is what this phone did: orders proposed, signed and uploaded.

const NO_MONEY: Wallet = { currency: 'USD', availableMinor: 0n, lockedMinor: 0n };

export function withoutExamples(base: KeelData): KeelData {
  return {
    ...base,
    orders: async () => [],
    order: async () => undefined,
    needsYou: async () => [],
    wallet: async () => NO_MONEY,
  };
}

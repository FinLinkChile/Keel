import { getRandomValues } from 'expo-crypto';

// viem's dependencies (@noble) read globalThis.crypto.getRandomValues. Hermes may not provide
// it, so fill it from expo-crypto when it is missing. Browsers already have it.
const g = globalThis as { crypto?: { getRandomValues?: unknown } };
if (typeof g.crypto?.getRandomValues !== 'function') {
  g.crypto = { ...(g.crypto ?? {}), getRandomValues };
}

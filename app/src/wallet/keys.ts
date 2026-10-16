import type { Hex } from '@keel/schemas';

import type { Role } from '../data/types';

import type { KeyStore } from './keyStore.types';
import { newPrivateKey } from './localSigner';

// The test keys of this device: one for the importer and one for the exporter, so an order can
// travel from one to the other on the same phone. DEMO SIMPLIFICATION: both keys live on one
// device, so the two signatures of an order do not come from independent parties. The contract
// and the app's checks behave the same; what a demo shows is that they hold, not that two
// separate companies agreed. The keys never leave the device.

const SLOT: Record<Role, string> = {
  importer: 'privateKey.importer',
  exporter: 'privateKey.exporter',
};
// The single key the app kept before there were two. It did not record the role it was made
// for, and the test wallet that already exists was made as the exporter's (the upload test
// registered it in ingest as the exporter), so it becomes the exporter key.
const LEGACY = 'privateKey';

export type Keys = Partial<Record<Role, Hex>>;

// Moves the single key of the old app to the exporter slot, or to the importer slot when that
// one is taken, and never overwrites a key.
export async function migrateLegacyKey(store: KeyStore): Promise<void> {
  const legacy = await store.read(LEGACY);
  if (!legacy) return;
  for (const role of ['exporter', 'importer'] as const) {
    if (!(await store.read(SLOT[role]))) {
      await store.write(SLOT[role], legacy);
      await store.remove(LEGACY);
      return;
    }
  }
}

// The keys already on the device
export async function loadKeys(store: KeyStore): Promise<Keys> {
  await migrateLegacyKey(store);
  const keys: Keys = {};
  for (const role of ['importer', 'exporter'] as const) {
    const key = await store.read(SLOT[role]);
    if (key) keys[role] = key as Hex;
  }
  return keys;
}

// Creates the slots that are empty and keeps the ones that are not
export async function ensureKeys(store: KeyStore, make: () => Hex = newPrivateKey): Promise<Required<Keys>> {
  const keys = await loadKeys(store);
  for (const role of ['importer', 'exporter'] as const) {
    if (!keys[role]) {
      keys[role] = make();
      await store.write(SLOT[role], keys[role]);
    }
  }
  return keys as Required<Keys>;
}

// Development only: forgets both keys
export async function removeKeys(store: KeyStore): Promise<void> {
  for (const name of [...Object.values(SLOT), LEGACY]) await store.remove(name);
}

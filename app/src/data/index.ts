import { useEffect, useState, useSyncExternalStore } from 'react';

import { config } from '@/config';

import { withoutExamples } from './cleanStart';
import { bindWallets as bindMockWallets, mockData } from './mock';
import { observedStore } from './proposals';
import { proposalStore } from './proposalStore';
import type { KeelData } from './types';
import { withCompany } from './withCompany';
import { withProposals } from './withProposals';

export * from './types';

// Orders proposed on this device, saved on the phone. Screens reload when one changes.
let version = 0;
const listeners = new Set<() => void>();
export const proposals = observedStore(proposalStore, () => {
  version += 1;
  listeners.forEach((l) => l());
});
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

// The single data source of the app. Swapped for a real implementation later. Without
// EXPO_PUBLIC_DEMO_SEED the example orders of the mock are left out.
export const data: KeelData = withProposals(withCompany(config.demoSeed ? mockData : withoutExamples(mockData)), proposals);

// Tells the data source which wallets are on this device, one per role.
export const bindWallets = bindMockWallets;

// Tells it which company the person signed up, to show instead of the example importer.
export { bindCompany } from './withCompany';

// Loads a value from `data` once per change of `deps`. Undefined while loading.
export function useData<T>(load: (d: KeelData) => Promise<T>, deps: unknown[] = []): T | undefined {
  const changes = useSyncExternalStore(subscribe, () => version);
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let live = true;
    load(data).then((v) => live && setValue(v));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, changes]);
  return value;
}

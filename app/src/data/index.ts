import { useEffect, useState, useSyncExternalStore } from 'react';

import { config } from '@/config';
import type { Signers } from '@/wallet/signer';

import { apiClient, type ApiClient } from './api';
import { withoutExamples } from './cleanStart';
import { httpProposalStore } from './httpProposals';
import { bindWallets as bindMockWallets, mockData } from './mock';
import { observedStore } from './proposals';
import { proposalStore } from './proposalStore';
import type { KeelData } from './types';
import { withApi } from './withApi';
import { withCompany } from './withCompany';
import { withProposals } from './withProposals';

export * from './types';

// The Keel API on AWS, when EXPO_PUBLIC_API_URL is set. Undefined otherwise: the app then keeps
// its proposals on this phone, as before.
export const api: ApiClient | undefined = config.apiUrl ? apiClient({ baseUrl: config.apiUrl, chainId: config.chainId }) : undefined;

// The wallets of this phone, bound by the session during render like bindWallets. Every API
// request is signed by one of them; no key leaves the phone.
let apiSigners: Signers = {};
export function bindApiSigners(signers: Signers | null | undefined) {
  apiSigners = signers ?? {};
}
export const currentSigners = (): Signers => apiSigners;

// Orders proposed on this device (or on the API), saved on the phone. Screens reload when one changes.
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version += 1;
  listeners.forEach((l) => l());
};
export const proposals = observedStore(api ? httpProposalStore(api, currentSigners) : proposalStore, changed);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

// Screens call it after an API move that is not a proposal (a closing signature, an upload), so
// what they show is read again
export const refreshData = changed;

// The single data source of the app. Without EXPO_PUBLIC_DEMO_SEED the example orders of the
// mock are left out. With the API, orders, what needs you and the locked amounts come from it.
const local: KeelData = withProposals(withCompany(config.demoSeed ? mockData : withoutExamples(mockData)), proposals);
export const data: KeelData = api ? withApi(local, api, currentSigners) : local;

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

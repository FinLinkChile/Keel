import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';

import { config } from '@/config';
import type { Signers } from '@/wallet/signer';

import { syncSignedOrders } from '../ingest/signedOrder';

import { apiClient, type ApiClient } from './api';
import { withoutExamples } from './cleanStart';
import { httpProposalStore } from './httpProposals';
import { bindWallets as bindMockWallets, mockData } from './mock';
import { observedStore } from './proposals';
import { sameData } from './sameData';
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
// With the Keel API, what the agent, the other company or the engine does to an order reaches the
// phone only if the phone asks again. While a screen is on display the data is read again every
// REFRESH_MS, and at once when the app comes back to the foreground. Without the API nothing outside
// the phone moves, so it stays off. A screen whose data did not change keeps what it has (useData).
const REFRESH_MS = 15_000;
let timer: ReturnType<typeof setInterval> | undefined;
let foreground: NativeEventSubscription | undefined;
const startRefreshing = () => {
  if (!api || timer) return;
  timer = setInterval(() => {
    if (AppState.currentState === 'active') changed();
  }, REFRESH_MS);
  foreground = AppState.addEventListener('change', (state) => {
    if (state === 'active') changed();
  });
};
const stopRefreshing = () => {
  if (timer) clearInterval(timer);
  timer = undefined;
  foreground?.remove();
  foreground = undefined;
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  startRefreshing();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) stopRefreshing();
  };
};

// Hands the orders signed on this phone to ingest (POST /trade/orders) until it takes them: after
// a signature and whenever the app opens. With the Keel API the orders already live on the
// server, so there is nothing to send. One run at a time.
let syncing: Promise<unknown> | undefined;
export function syncOrdersWithIngest(): Promise<unknown> {
  if (api || !config.ingestUrl) return Promise.resolve();
  syncing ??= syncSignedOrders({ store: proposals, ingestUrl: config.ingestUrl, now: Date.now() / 1000 }).finally(() => {
    syncing = undefined;
  });
  return syncing;
}

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
    // A read that finds the same data leaves the screen as it is: no redraw, and the effects that
    // watch the object do not run again
    load(data).then((v) => live && setValue((previous) => (previous !== undefined && sameData(previous, v) ? previous : v)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, changes]);
  return value;
}

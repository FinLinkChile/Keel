import { useSyncExternalStore } from 'react';

import { isApiError } from './api';

// Whether the Keel API answered the reads of the screens. A read that fails falls back to what
// this phone has (withApi.ts), so without this the person would see an empty "nothing needs you"
// and never know Keel was not reached. Each read reports here; the screens show a notice while
// any read is failing, with the reason as an error code (never the server's reply).

export interface ApiFailure {
  // Which read failed: orders, order, needs-you, wallet, registration
  what: string;
  // The server's error code, or `network` when it was not reached
  code: string;
  // Unix milliseconds of the last failure of this read
  at: number;
}

const failing = new Map<string, ApiFailure>();
const listeners = new Set<() => void>();
let snapshot: ApiFailure | undefined;

function publish() {
  // The most recent failure is the one shown
  snapshot = [...failing.values()].sort((a, b) => b.at - a.at)[0];
  listeners.forEach((l) => l());
}

export function reportApiFailure(what: string, e: unknown, now: number = Date.now()) {
  failing.set(what, { what, code: isApiError(e) ? e.code : 'network', at: now });
  publish();
}

// A read that worked again clears its own failure, not the others'
export function reportApiSuccess(what: string) {
  if (failing.delete(what)) publish();
}

export const apiFailure = (): ApiFailure | undefined => snapshot;

export function useApiFailure(): ApiFailure | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    apiFailure,
    apiFailure,
  );
}

// For tests
export function resetApiHealth() {
  failing.clear();
  publish();
}

import { useEffect, useState } from 'react';

import { mockData } from './mock';
import type { KeelData } from './types';

export * from './types';

// The single data source of the app. Swapped for a real implementation later.
export const data: KeelData = mockData;

// Loads a value from `data` once per change of `deps`. Undefined while loading.
export function useData<T>(load: (d: KeelData) => Promise<T>, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let live = true;
    load(data).then((v) => live && setValue(v));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

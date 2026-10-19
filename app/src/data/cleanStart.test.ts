import { describe, expect, it } from 'vitest';

import { withoutExamples } from './cleanStart';
import { mockData } from './mock';

describe('withoutExamples', () => {
  const data = withoutExamples(mockData);

  it('starts with no orders, nothing pending and no money', async () => {
    expect(await data.orders()).toEqual([]);
    expect(await data.needsYou('importer')).toEqual([]);
    expect(await data.needsYou('exporter')).toEqual([]);
    expect(await data.wallet('importer')).toEqual({ currency: 'USD', availableMinor: 0n, lockedMinor: 0n });
    const [first] = await mockData.orders();
    expect(await data.order(first!.po.orderId)).toBeUndefined();
  });

  it('keeps the companies and suppliers an order is sent to', async () => {
    expect((await data.verifiedSuppliers()).length).toBeGreaterThan(0);
    expect((await data.account('importer')).party).toBe('acme-imports');
    expect(await data.party('lingnan')).toBeDefined();
    expect((await data.tradeRegistry()).carrier).toBeDefined();
  });
});

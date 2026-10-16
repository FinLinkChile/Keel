/// <reference types="node" />
// Runs in Node (vitest). Checks the generated files against the shapes ingest and the agent read.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { EIP712_TYPES, OrderTerms, REQUIRED_DOC_TYPES } from '@keel/schemas';
import { requiredDocsHash, termsHash } from '@keel/schemas/hash';
import { describe, expect, it } from 'vitest';

import { checkWallet, demoData, toFileText } from './demoData';

const repo = resolve(__dirname, '../..');
const json = (path: string) => JSON.parse(readFileSync(join(repo, path), 'utf8'));
const botAccounts = Object.keys(json('bot/examples/recipients.json').accounts);
const botOrders: Record<string, { label: string }> = json('bot/examples/orders.json').orders;

const EXPORTER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const IMPORTER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const HEX = (bytes: number) => new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`);

// What the files contain once written and read back, as the services read them
const roundTrip = (value: unknown) => JSON.parse(toFileText(value));

describe('demo data for ingest', () => {
  it('lists the open orders a test wallet can upload to, in the TradeOrderEntry shape', async () => {
    const { ingestOrders } = await demoData({ exporter: EXPORTER }, botAccounts);
    const file = roundTrip(ingestOrders) as Record<string, unknown>[];
    expect(file.map((e) => (e.orderId as string).slice(-3))).toEqual(['157', '142', '150']);
    for (const e of file) {
      expect(Object.keys(e).sort()).toEqual(['carrier', 'orderId', 'payoutAddress', 'uploaders']);
      expect(e.orderId).toMatch(HEX(32));
      expect(e.payoutAddress).toMatch(HEX(20));
      expect(e.carrier).toMatch(HEX(20));
      expect(e.uploaders).toEqual([{ address: EXPORTER, party: 'exporter' }]);
    }
  });

  it('adds the importer wallet to every open order of the importer', async () => {
    const { ingestOrders } = await demoData({ exporter: EXPORTER, importer: IMPORTER }, botAccounts);
    expect(ingestOrders).toHaveLength(5);
    const po142 = ingestOrders.find((e) => e.orderId.endsWith('142'))!;
    expect(po142.uploaders).toEqual([
      { address: IMPORTER, party: 'importer' },
      { address: EXPORTER, party: 'exporter' },
    ]);
  });
});

describe('demo data for the agent', () => {
  it('writes order.json with the ids and labels of bot/examples and real hashes', async () => {
    const { agentOrders } = await demoData({ exporter: EXPORTER }, botAccounts);
    for (const stored of agentOrders) {
      const file = roundTrip(stored);
      expect(Object.keys(file)).toEqual(['label', 'order', 'terms']);
      const bot = botOrders[file.order.orderId];
      if (bot) expect(file.label).toBe(bot.label);
      expect(file.label).toBe(`PO-${file.order.orderId.slice(-4)}`);

      // As engine/src/agent/store.ts revives it
      const order = Object.fromEntries(
        EIP712_TYPES.PurchaseOrder.map(({ name, type }) => {
          const bits = /^u?int(\d+)$/.exec(type)?.[1];
          const v = file.order[name];
          // bigints (more than 32 bits) as decimal text; small integers such as advanceBps as numbers
          if (bits) expect(typeof v).toBe(Number(bits) <= 32 ? 'number' : 'string');
          return [name, bits ? (Number(bits) <= 32 ? Number(v) : BigInt(v)) : v];
        }),
      );
      const terms = OrderTerms.parse({ ...file.terms, invoiceAmountMinor: BigInt(file.terms.invoiceAmountMinor) });

      expect(order.termsHash).toBe(termsHash(terms));
      expect(order.requiredDocsHash).toBe(requiredDocsHash(['BILL_OF_LADING', 'COMMERCIAL_INVOICE']));
      expect(order.totalAmount).toBe(terms.invoiceAmountMinor);
      const others = [order.importer, order.exporter, order.carrier, order.arbiter];
      expect(others).not.toContain(order.documentVerifier);
    }
    expect(agentOrders.find((o) => o.label === 'PO-0142')!.order.exporter).toBe(EXPORTER);
    expect(REQUIRED_DOC_TYPES).toContain('BILL_OF_LADING');
  });

  it('writes the registry with bot accounts, the importer RUT and the settled history', async () => {
    const { registry } = await demoData({ exporter: EXPORTER }, botAccounts);
    const file = roundTrip(registry);
    expect(Object.keys(file)).toEqual(['history', 'parties']);
    const byAccount = Object.fromEntries(file.parties.filter((p: { account?: string }) => p.account).map((p: { account: string }) => [p.account, p]));
    expect(byAccount['acme-imports'].taxId).toBe('765432103');
    expect(byAccount.lingnan.address).toBe(EXPORTER);
    expect(byAccount['hk-arbitration']).toBeDefined();
    for (const p of file.parties) expect(p.address).toMatch(HEX(20));
    // PO-0131, settled, 48,000.00, as decimal text under the lowercase exporter address
    expect(file.history).toEqual({ [EXPORTER.toLowerCase()]: ['4800000'] });
  });
});

describe('inputs', () => {
  it('takes only public addresses, and at least one', async () => {
    expect(() => checkWallet('exporter', '0x1234')).toThrow(/not an address/);
    expect(checkWallet('exporter', EXPORTER.toLowerCase())).toBe(EXPORTER);
    await expect(demoData({}, botAccounts)).rejects.toThrow(/at least one/);
  });

  it('leaves the mock unbound afterwards, so the app is not affected', async () => {
    await demoData({ exporter: EXPORTER }, botAccounts);
    const { mockData } = await import('../src/data/mock');
    expect((await mockData.party('lingnan'))!.address).not.toBe(EXPORTER);
  });
});

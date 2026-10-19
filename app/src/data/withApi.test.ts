// Runs in Node (vitest), not in the app

import type { Hex } from '@keel/schemas';
import { describe, expect, it, vi } from 'vitest';

import { keccak256 } from 'viem';

import { uploadViaApi } from '../ingest/apiUpload';
import type { Signer } from '../wallet/signer';

import { ApiError, toWire, type ApiClient, type Need, type OrderView } from './api';
import { withoutExamples } from './cleanStart';
import { mockData } from './mock';
import { needFromApi, orderFromView, withApi } from './withApi';

const signer = (name: string): Signer => ({ address: async () => name as Hex, signTypedData: async () => '0x5151' });
const importer = signer('importer');
const exporter = signer('exporter');

async function viewFrom(state: string, over: Partial<OrderView> = {}): Promise<OrderView> {
  const [order] = await mockData.orders();
  return {
    orderId: order!.po.orderId,
    label: 'PO-0142',
    safe: order!.po.importer.toLowerCase(),
    exporter: order!.po.exporter.toLowerCase(),
    order: JSON.parse(toWire(order!.po)),
    terms: JSON.parse(toWire(order!.terms)),
    sigImporter: '0x',
    sigExporter: '0x',
    state,
    totalAmount: order!.po.totalAmount.toString(),
    advance: '0',
    locked: '35000000000',
    createdAt: 1_792_000_000,
    you: ['importer'],
    ...over,
  };
}

describe('orderFromView', () => {
  it('shows the documents the API accepted, so a reload does not ask for them again', async () => {
    const details = { transport: { document_number: 'HLIN26100142', port_of_loading: 'HKHKG' }, invoice: { order_number: 'PO0001' } };
    const v = await viewFrom('ADVANCE_PAID', { documents: { fileHashes: ['0x01', '0x02'], received: ['BILL_OF_LADING', 'COMMERCIAL_INVOICE'], details } });
    expect(orderFromView(v, 'harbor-line').documentDetails).toEqual(details);
    expect(orderFromView(v, 'harbor-line').documents).toEqual([
      { docType: 'BILL_OF_LADING', status: 'accepted' },
      { docType: 'COMMERCIAL_INVOICE', status: 'accepted' },
    ]);
    expect(orderFromView(await viewFrom('ADVANCE_PAID'), 'harbor-line').documents).toEqual([]);
  });

  it('shows the escrow state as the stage of the screens', async () => {
    const stages = await Promise.all(
      ['NONE', 'OPEN', 'ADVANCE_PAID', 'SHIPPED', 'DISPUTED', 'SETTLED', 'REFUNDED', 'RESOLVED', 'CANCELLED'].map(async (s) => orderFromView(await viewFrom(s), 'harbor-line').stage),
    );
    expect(stages).toEqual(['signed', 'signed', 'advance_paid', 'shipped', 'shipped', 'settled', 'refunded', 'settled', 'cancelled']);
    const o = orderFromView(await viewFrom('ADVANCE_PAID'), 'harbor-line', 'Agar powder');
    const [mock] = await mockData.orders();
    expect(o).toMatchObject({ label: 'PO-0142', goods: 'Agar powder', carrier: 'harbor-line', waitingOn: 'exporter', escrowState: 'ADVANCE_PAID', signedAt: 1_792_000_000 });
    expect(o.po).toEqual(mock!.po);
    expect(o.terms).toEqual(mock!.terms);
  });
});

describe('orderFromView shipment', () => {
  it('keeps the attested shipment of the view', async () => {
    const shipment = { attestation: { blNumberHash: `0x${'ab'.repeat(32)}`, onBoardDate: '1790000000' }, sigCarrier: '0x12' as Hex };
    expect(orderFromView(await viewFrom('SHIPPED', { shipment }), 'harbor-line').shipment).toEqual(shipment);
    expect(orderFromView(await viewFrom('ADVANCE_PAID'), 'harbor-line')).not.toHaveProperty('shipment');
  });
});

describe('needFromApi', () => {
  it('maps each action of GET /needs-you', () => {
    const id = `0x${'11'.repeat(32)}` as Hex;
    const n = (action: Need['action'], extra: Partial<Need> = {}): Need => ({ action, orderId: id, as: 'importer', ...extra });
    expect(needFromApi(n('sign_as_importer'))).toEqual({ kind: 'sign_order', orderId: id });
    expect(needFromApi(n('sign_as_exporter'))).toEqual({ kind: 'sign_order', orderId: id });
    expect(needFromApi(n('approve_balance', { attestationHash: id }))).toEqual({ kind: 'approve_balance', orderId: id });
    expect(needFromApi(n('sign_cancel', { cancelNonce: '515' }))).toEqual({ kind: 'sign_cancel', orderId: id, cancelNonce: '515' });
    expect(needFromApi(n('upload_documents'))).toEqual({ kind: 'upload_documents', orderId: id });
  });
});

describe('withApi', () => {
  const base = withoutExamples(mockData);

  it('reads what needs you with the wallet of the role, only for that side', async () => {
    const id = `0x${'11'.repeat(32)}` as Hex;
    const needsYou = vi.fn(async () => [
      { action: 'approve_balance', orderId: id, as: 'importer' },
      { action: 'sign_cancel', orderId: id, as: 'exporter', cancelNonce: '1' },
    ]);
    const d = withApi(base, { needsYou } as unknown as ApiClient, () => ({ importer, exporter }));
    expect(await d.needsYou('importer')).toEqual([{ kind: 'approve_balance', orderId: id }]);
    expect(needsYou).toHaveBeenCalledWith(importer);
    expect(await d.needsYou('exporter')).toEqual([{ kind: 'sign_cancel', orderId: id, cancelNonce: '1' }]);
    expect(await withApi(base, { needsYou } as unknown as ApiClient, () => ({})).needsYou('importer')).toEqual([]);
  });

  it('shows the locked amount of the API in cents, and the base on failure', async () => {
    const api = {
      wallet: vi.fn(async () => [{ safe: '0x', byState: {}, locked: '35000000000', pendingFunding: '0', orders: [] }]),
      listOrders: vi.fn(async () => [await viewFrom('SHIPPED', { you: ['exporter'], locked: '20000' })]),
      payouts: vi.fn(async () => []),
    };
    const d = withApi(base, api as unknown as ApiClient, () => ({ importer, exporter }));
    expect((await d.wallet('importer')).lockedMinor).toBe(3_500_000n);
    expect((await d.wallet('importer')).availableMinor).toBe((await base.wallet('importer')).availableMinor);
    expect((await d.wallet('exporter')).lockedMinor).toBe(2n);
    const down = withApi(base, { wallet: async () => Promise.reject(new ApiError(0, 'network')) } as unknown as ApiClient, () => ({ importer }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await down.wallet('importer')).lockedMinor).toBe(0n);
    warn.mockRestore();
  });

  it("shows the Safe's balance on chain as available, in cents", async () => {
    const api = { wallet: vi.fn(async () => [{ safe: '0x', byState: {}, locked: '0', pendingFunding: '0', available: '35000000', orders: [] }]) };
    const d = withApi(base, api as unknown as ApiClient, () => ({ importer }));
    expect((await d.wallet('importer')).availableMinor).toBe(3_500n);
  });

  it("shows the exporter's payout balance on chain as available, in cents", async () => {
    const api = {
      listOrders: vi.fn(async () => []),
      payouts: vi.fn(async () => [{ address: '0xa', available: '300000' }, { address: '0xb' }]),
    };
    const d = withApi(base, api as unknown as ApiClient, () => ({ exporter }));
    expect((await d.wallet('exporter')).availableMinor).toBe(30n);
  });

  it("offers only the suppliers registered for the importer's Safe, and their parties", async () => {
    const supplier = { exporter: '0xC419891eE6bdEfa7aE285961C743047E34E1320d' as const, name: 'Proveedor demo', payoutAddresses: ['0xc419891ee6bdefa7ae285961c743047e34e1320d'] };
    const api = { suppliers: vi.fn(async () => [{ safe: '0x366e', suppliers: [supplier, { exporter: '0x01', payoutAddresses: [] }] }]) };
    const d = withApi(base, api as unknown as ApiClient, () => ({ importer }));
    const list = await d.verifiedSuppliers();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ payoutAddress: supplier.exporter, party: { name: 'Proveedor demo', address: supplier.exporter } });
    expect(await d.partyByAddress(supplier.exporter)).toMatchObject({ name: 'Proveedor demo' });
    expect(await d.party(list[0]!.party.id)).toMatchObject({ name: 'Proveedor demo' });
    // No importer wallet, or the API down: no supplier rather than a demo one the gate would refuse
    expect(await withApi(base, api as unknown as ApiClient, () => ({ exporter })).verifiedSuppliers()).toEqual([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const down = { suppliers: async () => Promise.reject(new ApiError(0, 'network')) };
    expect(await withApi(base, down as unknown as ApiClient, () => ({ importer })).verifiedSuppliers()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    // The exporter's phone: its importer wallet represents no Safe, which is not an outage
    const notMine = { suppliers: async () => Promise.reject(new ApiError(403, 'not_representative')) };
    // ... and its list is its own company, so the exporter's review finds its registered payout
    const ownId = (await base.account('exporter')).party;
    const exporterPhone = await withApi(base, notMine as unknown as ApiClient, () => ({ importer })).verifiedSuppliers();
    expect(exporterPhone.map((r) => r.party.id)).toEqual([ownId]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('lists and opens the orders of the API', async () => {
    const v = await viewFrom('SHIPPED');
    const api = {
      listOrders: vi.fn(async () => [v]),
      getOrder: vi.fn(async (s: Signer) => {
        if (s === importer) return v;
        throw new ApiError(404, 'not_found');
      }),
    };
    const d = withApi(base, api as unknown as ApiClient, () => ({ exporter, importer }));
    expect((await d.orders()).map((o) => o.stage)).toEqual(['shipped']);
    expect((await d.order(v.orderId))?.escrowState).toBe('SHIPPED');
  });
});

describe('uploadViaApi', () => {
  const ORDER = `0x${'42'.repeat(32)}` as Hex;
  const file = new TextEncoder().encode('%PDF-1.7 test');

  it('asks for a presigned URL with the signed DocumentUpload and the size, then PUTs the bytes', async () => {
    const requestUpload = vi.fn(async () => ({ uploadUrl: 'https://s3/put', key: 'k', expiresIn: 300 }));
    const putFile = vi.fn(async () => undefined);
    const result = await uploadViaApi({ api: { requestUpload, putFile } as unknown as ApiClient, chainId: 84532, signer: exporter, orderId: ORDER, docType: 'BILL_OF_LADING', file, now: () => 1_790_000_000_000 });
    expect(result).toEqual({ kind: 'sent' });
    expect(requestUpload).toHaveBeenCalledWith({ orderId: ORDER, docType: 'BILL_OF_LADING', fileHash: keccak256(file), size: file.byteLength, issuedAt: 1_790_000_000, signature: '0x5151' });
    expect(putFile).toHaveBeenCalledWith({ uploadUrl: 'https://s3/put', key: 'k', expiresIn: 300 }, file);
  });

  it('reads the refusals of the upload route', async () => {
    const run = (e: ApiError) =>
      uploadViaApi({ api: { requestUpload: async () => Promise.reject(e) } as unknown as ApiClient, chainId: 1, signer: exporter, orderId: ORDER, docType: 'BILL_OF_LADING', file });
    expect(await run(new ApiError(403, 'not_a_party', { status: 'rejected' }))).toEqual({ kind: 'rejected', reason: 'not_a_party' });
    expect(await run(new ApiError(409, 'same_file', { status: 'duplicate' }))).toEqual({ kind: 'duplicate' });
    expect(await run(new ApiError(429, 'rate_limited', { status: 'quarantined' }))).toEqual({ kind: 'failed', reason: 'server' });
    expect(await run(new ApiError(400, 'bad_request'))).toEqual({ kind: 'rejected', reason: 'invalid_request' });
    expect(await run(new ApiError(0, 'network'))).toEqual({ kind: 'failed', reason: 'network' });
  });
});

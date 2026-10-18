// Runs in Node (vitest), not in the app

import type { Hex } from '@keel/schemas';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Signer } from '../wallet/signer';

import { ApiError, type ApiClient, type WalletView } from './api';
import { apiFailure, reportApiFailure, reportApiSuccess, resetApiHealth } from './apiHealth';
import { mockData } from './mock';
import { checkRegistration, checkRegistrations } from './registration';
import { withApi } from './withApi';

const SAFE = '0x366E72921895dBFD7688822418BE43E02551Ee82' as Hex;
const signer = (address: string): Signer => ({ address: async () => address as Hex, signTypedData: async () => '0x5151' });
const importer = signer('0x998207c916dcf1a0f14A24dDBF46332eeDcE6fd6');
const exporter = signer('0x00000000000000000000000000000000000e4904');

const wallet = (safe: string): WalletView => ({ safe, byState: {}, locked: '0', pendingFunding: '0', orders: [] });
const apiWith = (wallets: () => Promise<WalletView[]>): ApiClient => ({ wallet: wallets }) as unknown as ApiClient;

beforeEach(resetApiHealth);

describe('checkRegistration', () => {
  it('a buyer wallet the server lists for the Safe is registered, whatever the case of the address', async () => {
    const r = await checkRegistration(apiWith(async () => [wallet(SAFE.toLowerCase())]), 'importer', importer, SAFE);
    expect(r).toEqual({ role: 'importer', address: await importer.address(), status: 'registered' });
  });

  it('a buyer wallet with no Safe, or another Safe, is not registered', async () => {
    expect((await checkRegistration(apiWith(async () => []), 'importer', importer, SAFE)).status).toBe('not_registered');
    expect((await checkRegistration(apiWith(async () => [wallet('0x0000000000000000000000000000000000000bad')]), 'importer', importer, SAFE)).status).toBe('not_registered');
  });

  it('a refusal that means "not a representative" is a missing registration, not a failure', async () => {
    const api = apiWith(async () => {
      throw new ApiError(403, 'not_representative');
    });
    expect((await checkRegistration(api, 'importer', importer, SAFE)).status).toBe('not_registered');
    expect(apiFailure()).toBeUndefined();
  });

  it('a server that cannot be reached is unknown, with its code, and raises the notice', async () => {
    const api = apiWith(async () => {
      throw new ApiError(0, 'network');
    });
    expect(await checkRegistration(api, 'importer', importer, SAFE)).toMatchObject({ status: 'unknown', code: 'network' });
    expect(apiFailure()).toMatchObject({ what: 'registration', code: 'network' });
  });

  it('the supplier wallet needs no registration, and nothing is asked without a Safe', async () => {
    let asked = 0;
    const api = apiWith(async () => {
      asked++;
      return [];
    });
    expect((await checkRegistration(api, 'exporter', exporter, SAFE)).status).toBe('not_needed');
    expect((await checkRegistration(api, 'importer', importer, undefined)).status).toBe('no_safe');
    expect(asked).toBe(0);
  });

  it('checks every wallet of the phone, buyer first', async () => {
    const rows = await checkRegistrations(apiWith(async () => [wallet(SAFE)]), { exporter, importer }, SAFE);
    expect(rows.map((r) => [r.role, r.status])).toEqual([
      ['importer', 'registered'],
      ['exporter', 'not_needed'],
    ]);
  });
});

describe('API health', () => {
  it('shows the most recent failing read and clears each read on its own success', () => {
    reportApiFailure('orders', new ApiError(500, 'internal'), 1);
    reportApiFailure('wallet', new Error('offline'), 2);
    expect(apiFailure()).toMatchObject({ what: 'wallet', code: 'network' });
    reportApiSuccess('wallet');
    expect(apiFailure()).toMatchObject({ what: 'orders', code: 'internal' });
    reportApiSuccess('orders');
    expect(apiFailure()).toBeUndefined();
  });

  it('a failed read of the screens raises the notice instead of a silent empty list', async () => {
    const failing = {
      needsYou: async () => {
        throw new ApiError(0, 'network');
      },
      listOrders: async () => [],
    } as unknown as ApiClient;
    const data = withApi(mockData, failing, () => ({ importer }));
    expect(await data.needsYou('importer')).toEqual([]);
    expect(apiFailure()).toMatchObject({ what: 'needs-you', code: 'network' });

    const working = { ...failing, needsYou: async () => [] } as unknown as ApiClient;
    await withApi(mockData, working, () => ({ importer })).needsYou('importer');
    expect(apiFailure()).toBeUndefined();
  });
});

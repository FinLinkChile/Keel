// Runs in Node (vitest), not in the app

import type { Hex } from '@keel/schemas';
import { describe, expect, it, vi } from 'vitest';

import type { KeyStore } from './keyStore.types';
import { ensureKeys, importKey, loadKeys, migrateLegacyKey, removeKeys } from './keys';
import { localSigner, newPrivateKey } from './localSigner';

vi.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a) }));

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const store: KeyStore = {
    where: 'secure-store',
    read: async (name) => data.get(name) ?? null,
    write: async (name, value) => void data.set(name, value),
    remove: async (name) => void data.delete(name),
  };
  return { store, data };
};

const KEY_A = newPrivateKey();
const KEY_B = newPrivateKey();

describe('migration of the single key of the old app', () => {
  it('keeps it as the exporter key, the role the existing test wallet was made for', async () => {
    const { store, data } = memory({ privateKey: KEY_A });
    expect(await loadKeys(store)).toEqual({ exporter: KEY_A });
    expect(data.get('privateKey.exporter')).toBe(KEY_A);
    expect(data.has('privateKey')).toBe(false);
  });

  it('keeps the same address, so a wallet registered in ingest stays valid', async () => {
    const before = await localSigner(KEY_A).address();
    const { store } = memory({ privateKey: KEY_A });
    const keys = await ensureKeys(store);
    expect(await localSigner(keys.exporter).address()).toBe(before);
    expect(keys.importer).not.toBe(KEY_A);
  });

  it('never overwrites a key: it goes to the importer slot when the exporter one is taken', async () => {
    const { store, data } = memory({ privateKey: KEY_A, 'privateKey.exporter': KEY_B });
    await migrateLegacyKey(store);
    expect(data.get('privateKey.exporter')).toBe(KEY_B);
    expect(data.get('privateKey.importer')).toBe(KEY_A);
    const full = memory({ privateKey: KEY_A, 'privateKey.exporter': KEY_B, 'privateKey.importer': KEY_B });
    await migrateLegacyKey(full.store);
    expect(full.data.get('privateKey')).toBe(KEY_A);
  });

  it('does nothing on a clean device or after it already ran', async () => {
    const clean = memory();
    expect(await loadKeys(clean.store)).toEqual({});
    const once = memory({ privateKey: KEY_A });
    await loadKeys(once.store);
    expect(await loadKeys(once.store)).toEqual({ exporter: KEY_A });
  });
});

describe('the two slots', () => {
  it('creates both keys on a clean device, different from each other', async () => {
    const { store } = memory();
    const keys = await ensureKeys(store);
    expect(keys.importer).toMatch(/^0x[0-9a-f]{64}$/);
    expect(keys.exporter).toMatch(/^0x[0-9a-f]{64}$/);
    expect(keys.importer).not.toBe(keys.exporter);
    expect(await loadKeys(store)).toEqual(keys);
  });

  it('creates only the slot that is missing and keeps the other', async () => {
    const { store } = memory({ 'privateKey.importer': KEY_B });
    const make = vi.fn((): Hex => KEY_A);
    const keys = await ensureKeys(store, make);
    expect(keys).toEqual({ importer: KEY_B, exporter: KEY_A });
    expect(make).toHaveBeenCalledTimes(1);
    expect(await ensureKeys(store, make)).toEqual(keys);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('forgets both keys, and the old one too', async () => {
    const { store, data } = memory({ privateKey: KEY_A, 'privateKey.importer': KEY_B });
    await removeKeys(store);
    expect(data.size).toBe(0);
  });
});

describe('importing a demo key (development)', () => {
  it('puts the key in the slot of the role, with or without 0x, and replaces the one there', async () => {
    const { store, data } = memory({ 'privateKey.importer': KEY_A });
    await importKey(store, 'importer', `  ${KEY_B.slice(2)}
`);
    expect(data.get('privateKey.importer')).toBe(KEY_B);
    expect(await loadKeys(store)).toEqual({ importer: KEY_B });
  });

  it('refuses text that is not a private key and keeps what was there', async () => {
    const { store, data } = memory({ 'privateKey.exporter': KEY_A });
    for (const bad of ['', 'hello', '0x1234', `0x${'0'.repeat(64)}`, `${KEY_B}00`]) {
      await expect(importKey(store, 'exporter', bad)).rejects.toThrow('Not a private key');
    }
    expect(data.get('privateKey.exporter')).toBe(KEY_A);
  });
});

/// <reference types="node" />
// Runs in Node (vitest). Checks the attestation against what the engine and the escrow verify.
import { EIP712_TYPES, keelDomain, type Hex } from '@keel/schemas';
import { blNumberHash, bytes32Text, docsHash } from '@keel/schemas/hash';
import { recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { toFileText } from './demoData';
import { buildAttestation, fileHashOf, signShipment, type OrderFile } from './signShipment';

const carrier = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const ESCROW: Hex = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const CHAIN = { chainId: 84532, escrow: ESCROW };
const NOW = 1_800_000_000n;
const DEADLINE = 1_800_500_000n;
const FILES = [fileHashOf(new Uint8Array([1, 2, 3])), fileHashOf(new Uint8Array([4, 5, 6]))];

const file: OrderFile = {
  order: { orderId: `0x${'ab'.repeat(32)}`, carrier: carrier.address, shipmentDeadline: DEADLINE.toString() },
};
const opts = { blNumber: 'OLSU26104471', portOfLoading: 'CNNGB', fileHashes: FILES, onBoardDate: NOW - 100n, now: NOW };

describe('shipment attestation', () => {
  it('commits to the order, the carrier and number, the port and the document package', () => {
    const att = buildAttestation(file, opts);
    expect(att).toEqual({
      orderId: file.order.orderId,
      blNumberHash: blNumberHash(carrier.address, 'OLSU26104471'),
      onBoardDate: NOW - 100n,
      portOfLoading: bytes32Text('CNNGB'),
      docsHash: docsHash(FILES),
    });
  });

  it('does not depend on the order in which the files are given', () => {
    expect(buildAttestation(file, { ...opts, fileHashes: [...FILES].reverse() }).docsHash).toBe(buildAttestation(file, opts).docsHash);
  });

  it('refuses a date after the shipment deadline or in the future', () => {
    expect(() => buildAttestation(file, { ...opts, onBoardDate: DEADLINE + 1n, now: DEADLINE + 10n })).toThrow(/deadline/);
    expect(() => buildAttestation(file, { ...opts, onBoardDate: NOW + 1n })).toThrow(/future/);
  });

  it('refuses a document number the extractor would not return', () => {
    expect(() => buildAttestation(file, { ...opts, blNumber: 'olsu-2610' })).toThrow();
  });
});

describe('carrier signature', () => {
  it('is an EIP-712 signature of the carrier, as the escrow recovers it', async () => {
    const signed = await signShipment(carrier, file, buildAttestation(file, opts), CHAIN);
    const recovered = await recoverTypedDataAddress({
      domain: keelDomain(CHAIN.chainId, CHAIN.escrow),
      types: EIP712_TYPES,
      primaryType: 'ShipmentAttestation',
      message: signed.attestation,
      signature: signed.sigCarrier,
    });
    expect(recovered).toBe(carrier.address);
  });

  it('refuses a key that is not the carrier of the order', async () => {
    await expect(signShipment(stranger, file, buildAttestation(file, opts), CHAIN)).rejects.toThrow(/not the carrier/);
  });

  it('writes { attestation, sigCarrier } in canonical JSON', async () => {
    const signed = await signShipment(carrier, file, buildAttestation(file, opts), CHAIN);
    const back = JSON.parse(toFileText(signed));
    expect(Object.keys(back)).toEqual(['attestation', 'sigCarrier']);
    expect(back.attestation.onBoardDate).toBe((NOW - 100n).toString());
  });
});

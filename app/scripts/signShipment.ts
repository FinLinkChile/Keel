// The carrier's shipment attestation for the demo: build it from an order and sign it EIP-712
// with the carrier's key, as TradeEscrow.submitShipment checks it. Pure functions; the key is
// read by sign-shipment.ts, never here.
import { EIP712_TYPES, keelDomain, type Hex, type ShipmentAttestation } from '@keel/schemas';
import { blNumberHash, bytes32Text, docsHash } from '@keel/schemas/hash';
import { getAddress, keccak256, type LocalAccount } from 'viem';

// The part of the agent's order.json that the attestation needs
export type OrderFile = { order: { orderId: Hex; carrier: Hex; shipmentDeadline: string | number | bigint } };

export type ShipmentOptions = {
  // Exactly as the extractor returns it: uppercase, no separators
  blNumber: string;
  // UN/LOCODE, for example CNNGB
  portOfLoading: string;
  // keccak256 of the bytes of each file of the document package, as ingest hashes them
  fileHashes: readonly Hex[];
  onBoardDate: bigint;
  // Unix seconds, the clock of the check "not in the future"
  now: bigint;
};

// The escrow also rejects an onBoardDate before the order was funded (fund time is private
// there, read from the OrderFunded event). Not checked here: use a date after funding.
export function buildAttestation(file: OrderFile, o: ShipmentOptions): ShipmentAttestation {
  const { orderId, carrier, shipmentDeadline } = file.order;
  if (o.onBoardDate > BigInt(shipmentDeadline)) throw new Error('onBoardDate is after the shipment deadline of the order');
  if (o.onBoardDate > o.now) throw new Error('onBoardDate is in the future');
  return {
    orderId,
    blNumberHash: blNumberHash(getAddress(carrier), o.blNumber),
    onBoardDate: o.onBoardDate,
    portOfLoading: bytes32Text(o.portOfLoading),
    docsHash: docsHash(o.fileHashes),
  };
}

export const fileHashOf = (bytes: Uint8Array): Hex => keccak256(bytes);

// Refuses a key that is not the order's carrier: the escrow would revert with BadCarrierSignature
export async function signShipment(
  account: LocalAccount,
  file: OrderFile,
  attestation: ShipmentAttestation,
  chain: { chainId: number; escrow: Hex },
): Promise<{ attestation: ShipmentAttestation; sigCarrier: Hex }> {
  if (getAddress(account.address) !== getAddress(file.order.carrier))
    throw new Error(`the key is ${account.address}, not the carrier of the order (${file.order.carrier})`);
  const sigCarrier = await account.signTypedData({
    domain: keelDomain(chain.chainId, chain.escrow),
    types: EIP712_TYPES,
    primaryType: 'ShipmentAttestation',
    message: attestation,
  });
  return { attestation, sigCarrier };
}

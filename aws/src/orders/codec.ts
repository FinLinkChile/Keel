// Wire format of the orders API. Signed structs travel as JSON with every uint above 32 bits as a
// decimal string (the canonical JSON of engine/src/canonical.ts and of app/src/data/proposals.ts),
// small integers (advanceBps) as numbers, addresses and bytes32 as 0x hex. Each parser is strict:
// an unknown field is a 400, never silently dropped, so what is stored is exactly what was signed.
import { EIP712_TYPES, type Hex, OrderTerms, type PurchaseOrder, type ShipmentAttestation } from "@keel/schemas";
import { structHash } from "@keel/schemas/hash";
import { reviveStruct } from "@keel/engine";
import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/) as unknown as z.ZodType<Hex>;
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/) as unknown as z.ZodType<Hex>;
// Lowercase bytes32, the form ingest and the engine use for file and document hashes
export const word = z.string().regex(/^0x[0-9a-f]{64}$/) as unknown as z.ZodType<Hex>;
// uint as a decimal string, no sign, no leading zeros, at most 78 digits (uint256)
export const uintText = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const uint = (bits: number) => uintText.transform((s) => BigInt(s)).refine((v) => v < 2n ** BigInt(bits), "out of range");
export const signature = z.string().regex(/^0x([0-9a-fA-F]{2})+$/).max(20_000) as unknown as z.ZodType<Hex>;

export const PurchaseOrderWire = z.strictObject({
  orderId: bytes32,
  importer: address,
  exporter: address,
  payoutAddress: address,
  token: address,
  totalAmount: uint(256),
  advanceBps: z.number().int().min(0).max(65_535),
  shipmentDeadline: uint(64),
  disputeWindow: uint(64),
  carrier: address,
  arbiter: address,
  documentVerifier: address,
  incoterm: bytes32,
  termsHash: bytes32,
  requiredDocsHash: bytes32,
  nonce: uint(256),
});

// OrderTerms with invoiceAmountMinor as a decimal string, then the schemas' own strict check
export const OrderTermsWire = z
  .object({ invoiceAmountMinor: uintText })
  .passthrough()
  .transform((raw, ctx) => {
    const parsed = OrderTerms.safeParse({ ...raw, invoiceAmountMinor: BigInt(raw.invoiceAmountMinor) });
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: "bad terms" });
      return z.NEVER;
    }
    return parsed.data;
  });

export const ShipmentAttestationWire = z.strictObject({
  orderId: bytes32,
  blNumberHash: bytes32,
  onBoardDate: uint(64),
  portOfLoading: bytes32,
  docsHash: bytes32,
});

type Raw = Record<string, unknown>;

// Bigints as decimal strings: the stored and the returned form
export const toJson = <T>(value: T): Raw => JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

// From what a table holds back to the typed structs (engine revivers, so both read the same way)
export const poFrom = (raw: Raw): PurchaseOrder => reviveStruct<PurchaseOrder>(EIP712_TYPES.PurchaseOrder, raw);
export const termsFrom = (raw: Raw): OrderTerms => OrderTerms.parse({ ...raw, invoiceAmountMinor: BigInt(raw.invoiceAmountMinor as string) });
export const attestationFrom = (raw: Raw): ShipmentAttestation =>
  reviveStruct<ShipmentAttestation>(EIP712_TYPES.ShipmentAttestation, raw);

// The attestationHash a BalanceApproval and a DocumentDecision name: the EIP-712 struct hash of the
// stored attestation. It is the escrow's own attestationHash only if this is the attestation the
// agent submitted, which holds because a stored attestation is frozen once the order is SHIPPED.
export const attestationHashOf = (o: { shipment?: { attestation: Raw } }): Hex | undefined =>
  o.shipment ? structHash("ShipmentAttestation", attestationFrom(o.shipment.attestation)) : undefined;

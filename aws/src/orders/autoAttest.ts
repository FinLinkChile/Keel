// DEMO SHORTCUT [PROPUESTA], off unless KEEL_DEMO_AUTO_ATTEST=1 (Terraform demo_auto_attest).
//
// When an order has its bill of lading and its commercial invoice read, Keel signs the carrier's
// ShipmentAttestation itself, with the carrier's test key (secret carrier_private_key), and stores
// it through the same checks as POST /shipments (./closing.ts attest). It exists so the MVP demo
// runs without someone playing the carrier with aws/scripts/carrier-attest.ts.
//
// It breaks the separation of powers on purpose: the attestation is worth something because an
// independent carrier signs it, and here the server signs whatever bill of lading the exporter
// uploaded. With it on, a fabricated bill of lading proves a shipment (docs/flujo/amenazas.md,
// "BL falso"). Never on outside a test deployment with test keys.
//
// The attestation takes the BL number and the port of loading the extractor read, the docsHash of
// every file of the order, and the on-board date of the BL, or now when that date is in the future
// (the API refuses a future date; the document check then reports the mismatch). The extractor
// needs the secrets carrier_private_key and rpc_url (the signature check builds its RPC client).
import type { Hex, ShipmentAttestation } from "@keel/schemas";
import { EIP712_TYPES, keelDomain } from "@keel/schemas";
import { blNumberHash, bytes32Text, docsHash } from "@keel/schemas/hash";
import { isAddressEqual } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Env } from "../config";
import { secret } from "../secrets";
import { attest } from "./closing";
import { poFrom } from "./codec";
import { ctxOf } from "./context";
import { type Ctx } from "./proposals";
import { loadOrder, stateOf } from "./views";

export type AutoAttestResult =
  | "off"
  | "waiting_documents"
  | "not_funded"
  | "already_attested"
  | "carrier_mismatch"
  | "attested";

export const autoAttestOn = (env: Env = process.env) => env.KEEL_DEMO_AUTO_ATTEST === "1";

interface Transport {
  document_number: string;
  on_board_date: string | number;
  port_of_loading: string;
}

export interface AutoAttestDeps {
  env: Env;
  carrierKey(): Promise<string>;
  context(): Promise<Ctx>;
}

const defaultDeps = (env: Env): AutoAttestDeps => ({
  env,
  carrierKey: () => secret("carrier_private_key", env),
  context: () => ctxOf(env),
});

export async function autoAttest(orderId: string, deps: AutoAttestDeps = defaultDeps(process.env)): Promise<AutoAttestResult> {
  if (!autoAttestOn(deps.env)) return "off";
  const o = await loadOrder(orderId, deps.env);
  if (o.shipment) return "already_attested";
  const docs = o.documents as { extractions?: { transport?: Transport; invoice?: object }; fileHashes?: Hex[] } | undefined;
  const transport = docs?.extractions?.transport;
  if (!transport || !docs?.extractions?.invoice || !docs.fileHashes?.length) return "waiting_documents";
  // The escrow takes a shipment only after the deposit
  if (stateOf(o) !== "ADVANCE_PAID") return "not_funded";

  const po = poFrom(o.order);
  const raw = (await deps.carrierKey()).trim();
  const carrier = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
  if (!isAddressEqual(carrier.address, po.carrier)) return "carrier_mismatch";

  const ctx = await deps.context();
  const onBoard = BigInt(transport.on_board_date);
  const now = BigInt(ctx.now);
  const attestation: ShipmentAttestation = {
    orderId: o.orderId,
    blNumberHash: blNumberHash(po.carrier, transport.document_number),
    onBoardDate: onBoard > now ? now : onBoard,
    portOfLoading: bytes32Text(transport.port_of_loading),
    docsHash: docsHash(docs.fileHashes.map((h) => h.toLowerCase() as Hex)),
  };
  const sigCarrier = await carrier.signTypedData({
    domain: keelDomain(ctx.chainId, ctx.escrow),
    types: { ShipmentAttestation: EIP712_TYPES.ShipmentAttestation },
    primaryType: "ShipmentAttestation",
    message: attestation,
  });
  await attest(carrier.address, { attestation, sigCarrier }, ctx);
  return "attested";
}

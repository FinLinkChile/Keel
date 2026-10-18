// Carrier tool: signs the ShipmentAttestation of an order and sends it to the Keel API
// (POST /shipments), which checks it the way TradeEscrow.submitShipment will and stores it for the
// agent to submit (docs/flujo/paso-5-saldo.md). Storing it moves nothing.
//
// Usage (from the repository root):
//   CARRIER_PRIVATE_KEY=0x… npx tsx aws/scripts/carrier-attest.ts \
//     --api https://<api-id>.execute-api.<region>.amazonaws.com \
//     --order 0x<orderId> --bl-number HLCU1234567 --on-board 2026-10-18T09:30:00Z --port HKHKG \
//     (--docs-hash 0x<bytes32> | --file bl.pdf --file invoice.pdf) [--dry-run]
//
//   --api        base URL of the API, or KEEL_API_URL
//   --bl-number  bill of lading number as the extractor returns it: uppercase, no separators
//   --on-board   ISO 8601 instant or unix seconds. It must be after the deposit and not after the
//                order's shipment deadline: a date alone means 00:00 UTC, which the escrow refuses
//                when the deposit came later that day.
//   --port       port of loading, UN/LOCODE (HKHKG)
//   --docs-hash  docsHash of the document package, or --file for each file of the package
//   --dry-run    print the attestation and its hash; send nothing (it still reads the public
//                GET /trade-setup for the escrow's chain and address)
//
// The key comes only from CARRIER_PRIVATE_KEY and is never printed. Its address must be the carrier
// named in the signed PurchaseOrder, or the API answers 403 not_carrier.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { EIP712_TYPES, type Hex, keelDomain, type ShipmentAttestation } from "@keel/schemas";
import { blNumberHash, bytes32Text, docsHash, structHash } from "@keel/schemas/hash";
import { keccak256 } from "viem";
import { accountFromEnv, apiUrlFrom, CliError, orderIdArg, parseCli, run, signedRequest, tradeSetup } from "./cli";

export interface CarrierArgs {
  api?: string;
  orderId: Hex;
  blNumber: string;
  onBoardDate: bigint;
  // True when only a day was given (00:00 UTC)
  dateOnly: boolean;
  port: string;
  docs: { hash: Hex } | { files: string[] };
  dryRun: boolean;
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
// UN/LOCODE: country (2 letters) and place (3 letters or digits 2-9)
const LOCODE = /^[A-Z]{2}[A-Z2-9]{3}$/;

export function parseOnBoard(value: string | undefined): { seconds: bigint; dateOnly: boolean } {
  if (!value) throw new CliError("--on-board is required (ISO 8601 or unix seconds)");
  if (/^\d+$/.test(value)) return { seconds: BigInt(value), dateOnly: false };
  const ms = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(ms)) throw new CliError(`--on-board is not an ISO 8601 date or unix seconds: ${value}`);
  return { seconds: BigInt(Math.floor(ms / 1000)), dateOnly: /^\d{4}-\d{2}-\d{2}$/.test(value) };
}

export function parseCarrierArgs(argv: string[]): CarrierArgs {
  const { values } = parseCli({
    args: argv,
    options: {
      api: { type: "string" },
      order: { type: "string" },
      "bl-number": { type: "string" },
      "on-board": { type: "string" },
      port: { type: "string" },
      "docs-hash": { type: "string" },
      file: { type: "string", multiple: true },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });
  const blNumber = values["bl-number"];
  if (!blNumber || !/^[A-Z0-9]{6,20}$/.test(blNumber)) throw new CliError("--bl-number must be 6 to 20 uppercase letters or digits, no separators");
  const port = values.port;
  if (!port || !LOCODE.test(port)) throw new CliError("--port must be a UN/LOCODE such as HKHKG");
  const hash = values["docs-hash"];
  const files = values.file ?? [];
  if (!!hash === files.length > 0) throw new CliError("pass either --docs-hash or one --file per document");
  if (hash && !BYTES32.test(hash)) throw new CliError("--docs-hash must be a 0x-prefixed bytes32");
  const onBoard = parseOnBoard(values["on-board"]);
  return {
    ...(values.api && { api: values.api }),
    orderId: orderIdArg(values.order),
    blNumber,
    onBoardDate: onBoard.seconds,
    dateOnly: onBoard.dateOnly,
    port,
    docs: hash ? { hash: hash.toLowerCase() as Hex } : { files },
    dryRun: values["dry-run"] ?? false,
  };
}

// The attestation as TradeEscrow hashes it. `carrier` is the signer's address: a BL number is
// unique per carrier, so it is part of blNumberHash.
export function buildAttestation(args: CarrierArgs, carrier: Hex, read: (path: string) => Uint8Array = (p) => readFileSync(p)): ShipmentAttestation {
  const packageHash = "hash" in args.docs ? args.docs.hash : docsHash(args.docs.files.map((f) => keccak256(read(f)).toLowerCase() as Hex));
  return {
    orderId: args.orderId,
    blNumberHash: blNumberHash(carrier, args.blNumber),
    onBoardDate: args.onBoardDate,
    portOfLoading: bytes32Text(args.port),
    docsHash: packageHash,
  };
}

async function main() {
  const args = parseCarrierArgs(process.argv.slice(2));
  const account = accountFromEnv("CARRIER_PRIVATE_KEY");
  const api = apiUrlFrom(args.api);
  const setup = await tradeSetup(api);
  const attestation = buildAttestation(args, account.address);
  const signature = await account.signTypedData({
    domain: keelDomain(setup.chainId, setup.escrow),
    types: { ShipmentAttestation: EIP712_TYPES.ShipmentAttestation },
    primaryType: "ShipmentAttestation",
    message: attestation,
  });

  console.log(`carrier         ${account.address}`);
  console.log(`escrow          ${setup.escrow} (chain ${setup.chainId})`);
  console.log(`order           ${attestation.orderId}`);
  console.log(`on board        ${new Date(Number(attestation.onBoardDate) * 1000).toISOString()}`);
  console.log(`attestationHash ${structHash("ShipmentAttestation", attestation)}`);
  if (args.dateOnly) console.warn("note: --on-board is a date only (00:00 UTC); the escrow refuses it if the deposit came later that day");
  if (args.dryRun) {
    console.log("dry run: nothing sent");
    return;
  }
  const res = await signedRequest(api, account, setup.chainId, "POST", "/shipments", { attestation, sigCarrier: signature });
  console.log("stored for the agent:", JSON.stringify(res));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run(main);

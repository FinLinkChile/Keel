// Arbiter tool: signs the DisputeResolution of an order (how the remaining balance is split
// between the importer and the exporter's signed payout address) and sends it to the Keel API
// (POST /disputes/{orderId}/resolution), which checks it the way TradeEscrow.resolve will and stores
// it for the agent to submit (docs/flujo/disputa-y-cancelacion.md). Storing it moves nothing.
//
// Usage (from the repository root):
//   ARBITER_PRIVATE_KEY=0x… npx tsx aws/scripts/arbiter-resolve.ts \
//     --api https://<api-id>.execute-api.<region>.amazonaws.com \
//     --order 0x<orderId> --to-importer 3500000000 --to-exporter 3500000000 [--dry-run]
//
//   --api           base URL of the API, or KEEL_API_URL
//   --to-importer   token minor units (USDC: 6 decimals) back to the importer
//   --to-exporter   token minor units to the exporter's payoutAddress
//                   Both must add up to exactly the remaining balance (total minus the advance);
//                   the tool reads the order first and refuses any other split.
//   --dry-run       read the order, check and print the split; send no resolution
//
// The key comes only from ARBITER_PRIVATE_KEY and is never printed. Its address must be the arbiter
// named in the signed PurchaseOrder, or the API answers 404 (not a party) or 403 not_arbiter.
import { pathToFileURL } from "node:url";
import { type DisputeResolution, EIP712_TYPES, type Hex, keelDomain } from "@keel/schemas";
import { accountFromEnv, apiUrlFrom, CliError, orderIdArg, parseCli, run, signedRequest, tradeSetup } from "./cli";

export interface ArbiterArgs {
  api?: string;
  orderId: Hex;
  toImporter: bigint;
  toExporter: bigint;
  dryRun: boolean;
}

const amount = (name: string, value: string | undefined): bigint => {
  if (!value || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new CliError(`--${name} must be a non-negative integer in token minor units`);
  return BigInt(value);
};

export function parseArbiterArgs(argv: string[]): ArbiterArgs {
  const { values } = parseCli({
    args: argv,
    options: {
      api: { type: "string" },
      order: { type: "string" },
      "to-importer": { type: "string" },
      "to-exporter": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });
  return {
    ...(values.api && { api: values.api }),
    orderId: orderIdArg(values.order),
    toImporter: amount("to-importer", values["to-importer"]),
    toExporter: amount("to-exporter", values["to-exporter"]),
    dryRun: values["dry-run"] ?? false,
  };
}

// What resolve() splits: the total minus the advance paid at funding (aws/src/orders/rules.ts advanceOf)
export function remainingOf(order: { totalAmount: string | bigint; advanceBps: number }): bigint {
  const total = BigInt(order.totalAmount);
  return total - (total * BigInt(order.advanceBps)) / 10_000n;
}

export function checkSplit(args: Pick<ArbiterArgs, "toImporter" | "toExporter">, remaining: bigint) {
  if (args.toImporter + args.toExporter !== remaining) {
    throw new CliError(`the split must add up to the remaining balance ${remaining}, got ${args.toImporter + args.toExporter}`);
  }
}

async function main() {
  const args = parseArbiterArgs(process.argv.slice(2));
  const account = accountFromEnv("ARBITER_PRIVATE_KEY");
  const api = apiUrlFrom(args.api);
  const setup = await tradeSetup(api);

  const view = (await signedRequest(api, account, setup.chainId, "GET", `/orders/${args.orderId}`)) as {
    state: string;
    order: { totalAmount: string; advanceBps: number };
    you: string[];
  };
  if (!view.you.includes("arbiter")) throw new CliError("this key is not the arbiter of the order");
  const remaining = remainingOf(view.order);
  checkSplit(args, remaining);
  if (view.state !== "DISPUTED") console.warn(`note: the order is ${view.state}, not DISPUTED; the escrow only resolves an order in dispute`);

  const resolution: DisputeResolution = { orderId: args.orderId, toImporter: args.toImporter, toExporter: args.toExporter };
  const signature = await account.signTypedData({
    domain: keelDomain(setup.chainId, setup.escrow),
    types: { DisputeResolution: EIP712_TYPES.DisputeResolution },
    primaryType: "DisputeResolution",
    message: resolution,
  });

  console.log(`arbiter      ${account.address}`);
  console.log(`escrow       ${setup.escrow} (chain ${setup.chainId})`);
  console.log(`order        ${args.orderId} (${view.state})`);
  console.log(`to importer  ${args.toImporter}`);
  console.log(`to exporter  ${args.toExporter} (the order's payoutAddress)`);
  if (args.dryRun) {
    console.log("dry run: nothing sent");
    return;
  }
  const res = await signedRequest(api, account, setup.chainId, "POST", `/disputes/${args.orderId}/resolution`, {
    toImporter: args.toImporter,
    toExporter: args.toExporter,
    signature,
  });
  console.log("stored for the agent:", JSON.stringify(res));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run(main);

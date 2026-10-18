// The directory the app reads before proposing an order: the importer's known suppliers with the
// payout addresses registered for them, and the addresses of this deployment.
//
// This is a convenience view, not a control. The control is the FundingGate's trust registry
// (exporter and payoutAddress pairs, behind the Safe's timelock), which `fund` enforces on chain
// (UnknownSupplier) and the engine reads through engine/src/agent/gate.ts. A supplier listed here
// and not in the gate is held at funding; a supplier missing here can still be proposed.
// Writing it is an operator task (bearer token `directory_admin_token`), never a user's.
import { GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Hex } from "@keel/schemas";
import { z } from "zod";
import { type Deployment, type Env, table } from "../config";
import { ddb, lower } from "../db";
import { HttpError } from "../http";
import type { PartyItem } from "../tables";
import { representedSafes } from "./parties";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const SupplierBody = z.strictObject({
  // The importer Safe that knows this supplier; the deployment's Safe when absent
  safe: address.optional(),
  exporter: address,
  payoutAddress: address,
  // Shown to the importer's people only, never sent to the bot
  name: z.string().min(1).max(100).optional(),
  taxId: z.string().regex(/^[A-Za-z0-9.-]{1,40}$/).optional(),
  // Bot directory account (bot/src/domain/recipients.ts AccountId)
  account: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional(),
});

export interface SupplierView {
  exporter: string;
  name?: string;
  taxId?: string;
  account?: string;
  payoutAddresses: string[];
}

const supplierView = (p: PartyItem): SupplierView => ({
  exporter: p.address,
  ...(p.name && { name: p.name }),
  ...(p.taxId && { taxId: p.taxId }),
  ...(p.account && { account: p.account }),
  payoutAddresses: p.knownPayouts ?? [],
});

// The parties table is small (the parties of one demo deployment), so a filtered Scan is enough
async function suppliersOf(safe: string, env?: Env): Promise<SupplierView[]> {
  const out: SupplierView[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new ScanCommand({
        TableName: table("parties", env),
        FilterExpression: "#kind = :exporter AND contains(knownBy, :safe)",
        ExpressionAttributeNames: { "#kind": "kind" },
        ExpressionAttributeValues: { ":exporter": "exporter", ":safe": safe },
        ExclusiveStartKey,
      }),
    );
    out.push(...((r.Items ?? []) as PartyItem[]).map(supplierView));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out.sort((a, b) => a.exporter.localeCompare(b.exporter));
}

export async function listSuppliers(signer: Hex, deploymentSafe: Hex, env?: Env, only?: string): Promise<{ safe: string; suppliers: SupplierView[] }[]> {
  let safes = await representedSafes(signer, deploymentSafe, env);
  if (!safes.length) throw new HttpError(403, "not_representative");
  if (only) {
    if (!safes.includes(lower(only))) throw new HttpError(403, "not_representative");
    safes = [lower(only)];
  }
  const out = [];
  for (const safe of safes) out.push({ safe, suppliers: await suppliersOf(safe, env) });
  return out;
}

// Adds (or extends) a known supplier: the payout address is added to the ones already registered,
// never replaces them. Operator only; concurrent operator writes are last-writer-wins.
export async function addSupplier(body: z.infer<typeof SupplierBody>, deploymentSafe: Hex, env?: Env): Promise<SupplierView & { safe: string }> {
  const safe = lower(body.safe ?? deploymentSafe);
  const exporter = lower(body.exporter);
  if (exporter === safe) throw new HttpError(422, "same_parties");
  const r = await ddb().send(new GetCommand({ TableName: table("parties", env), Key: { address: exporter }, ConsistentRead: true }));
  const prev = r.Item as PartyItem | undefined;
  // An address registered as something else (a representative, a carrier) is not silently turned
  // into a supplier
  if (prev && prev.kind !== "exporter") throw new HttpError(409, "kind_conflict", { kind: prev.kind });
  const item: PartyItem = {
    ...prev,
    address: exporter,
    kind: "exporter",
    knownBy: [...new Set([...(prev?.knownBy ?? []), safe])],
    knownPayouts: [...new Set([...(prev?.knownPayouts ?? []), lower(body.payoutAddress)])],
    ...(body.name && { name: body.name }),
    ...(body.taxId && { taxId: body.taxId }),
    ...(body.account && { account: body.account }),
  };
  await ddb().send(new PutCommand({ TableName: table("parties", env), Item: item }));
  return { safe, ...supplierView(item) };
}

// Public addresses of this deployment: what the app needs to sign (chainId, escrow domain) and to
// build an order (token, Safe). Nothing secret.
export function tradeSetup(d: Deployment) {
  const token = d.extra["token"];
  return {
    chainId: d.chainId,
    escrow: d.escrow,
    safe: d.safe,
    fundingGate: d.fundingGate ?? null,
    token: token && /^0x[0-9a-fA-F]{40}$/.test(token) ? token : null,
    deployBlock: d.deployBlock.toString(),
  };
}

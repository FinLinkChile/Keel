// Who the signer of a request acts for. Authentication (../auth.ts) recovers an EOA; a Safe cannot
// sign an ApiRequest, so its representatives sign for it. The authority is the Safe's own item in
// the parties table (`representatives`): a representative's item only points at its Safe
// (`safe`) so the Safe can be found, and that pointer alone grants nothing.
//
// What this table proves is limited: it says who Keel lets act through the API for a Safe. Who can
// actually sign for the Safe is decided by the Safe itself (its owners and threshold), which the
// escrow asks through ERC-1271 at `open`, `approveBalance` and `cancel`.
import { BatchGetCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { Hex } from "@keel/schemas";
import { represents } from "../auth";
import { type Env, table } from "../config";
import { ddb, lower } from "../db";
import type { PartyItem } from "../tables";

export async function getParty(address: string, env: Env = process.env): Promise<PartyItem | undefined> {
  const r = await ddb().send(new GetCommand({ TableName: table("parties", env), Key: { address: lower(address) } }));
  return r.Item as PartyItem | undefined;
}

export async function getParties(addresses: readonly string[], env: Env = process.env): Promise<Map<string, PartyItem>> {
  const keys = [...new Set(addresses.map(lower))];
  const out = new Map<string, PartyItem>();
  // BatchGet takes at most 100 keys; unprocessed keys are retried until none are left
  for (let i = 0; i < keys.length; i += 100) {
    let request: Record<string, { Keys: Record<string, unknown>[] }> | undefined = {
      [table("parties", env)]: { Keys: keys.slice(i, i + 100).map((address) => ({ address })) },
    };
    while (request && Object.keys(request).length) {
      const r = await ddb().send(new BatchGetCommand({ RequestItems: request }));
      for (const item of r.Responses?.[table("parties", env)] ?? []) out.set((item as PartyItem).address, item as PartyItem);
      request = r.UnprocessedKeys as typeof request;
    }
  }
  return out;
}

// Whether `signer` may act for `party`: the party itself, or a representative its item lists
export async function actsFor(signer: Hex, party: string, env: Env = process.env): Promise<boolean> {
  if (represents(signer, party)) return true;
  const item = await getParty(party, env);
  return represents(signer, party, item?.representatives ?? []);
}

// The Safes (or other parties with representatives) this signer represents, lowercase. Candidates
// are the Safe its own item points at and the Safe of this deployment; each counts only if its own
// item lists the signer.
export async function representedSafes(signer: Hex, deploymentSafe: Hex, env: Env = process.env): Promise<string[]> {
  const own = await getParty(signer, env);
  const candidates = [...new Set([own?.safe, deploymentSafe].filter((a): a is string => !!a).map(lower))];
  const items = await getParties(candidates, env);
  return candidates.filter((safe) => (items.get(safe)?.representatives ?? []).some((r) => lower(r) === lower(signer)));
}

// Everyone the signer may act as: itself and the Safes it represents
export async function identities(signer: Hex, deploymentSafe: Hex, env: Env = process.env): Promise<string[]> {
  return [lower(signer), ...(await representedSafes(signer, deploymentSafe, env))];
}

// The EOAs that act for a party: its representatives, or the party itself when it has none
export function actors(party: string, item: PartyItem | undefined): string[] {
  const reps = (item?.representatives ?? []).map(lower);
  return reps.length ? [...new Set(reps)] : [lower(party)];
}

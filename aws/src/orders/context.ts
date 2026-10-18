// What every orders route needs from the deployment, read once per container (../config.ts).
import type { Hex } from "@keel/schemas";
import { deployment, type Env } from "../config";
import { nowSeconds } from "../db";
import type { Ctx } from "./proposals";

const isAddress = (v: string | undefined): v is Hex => !!v && /^0x[0-9a-fA-F]{40}$/.test(v);

// The token is published as /keel/<chainId>/token when the deployment knows it. Without it the
// API cannot pre-check po.token and leaves it to the escrow's TokenNotAllowed at `open`.
export async function ctxOf(env: Env = process.env): Promise<Ctx> {
  const d = await deployment(env);
  const token = d.extra["token"];
  return { chainId: d.chainId, escrow: d.escrow, safe: d.safe, ...(isAddress(token) && { token }), now: nowSeconds(), env };
}

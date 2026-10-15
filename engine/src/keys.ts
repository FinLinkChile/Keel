// Key custody (T2.7, issue #15). Loads the server-side keys from the environment and
// hands each component the narrowest signer it needs. The owner key never comes through
// here: owners sign from their own wallets. Error messages name the variable, never its value.
import type { Hex } from "@keel/schemas";
import { privateKeyToAccount } from "viem/accounts";
import type { PolicySigner } from "./pdr";

export const KEY_ENV = {
  relayer: "RELAYER_PRIVATE_KEY",
  policySigner: "POLICY_SIGNER_PRIVATE_KEY",
  cosigner: "COSIGNER_PRIVATE_KEY",
} as const;
export type KeyRole = keyof typeof KEY_ENV;

export type KeyEnv = Partial<Record<string, string | undefined>>;

export class KeyError extends Error {}

// The only typed data the policy key may sign
export const POLICY_SIGNED_TYPES = ["PolicyDecision", "DocumentDecision"] as const;

function accountFor(role: KeyRole, env: KeyEnv) {
  const name = KEY_ENV[role];
  const raw = env[name];
  if (!raw) throw new KeyError(`${name} is not set`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new KeyError(`${name} is not a 32-byte hex private key`);
  return privateKeyToAccount(raw as Hex);
}

// Each role must have its own key: one stolen key must never fill two roles.
// Only the keys present in the environment are compared.
export function assertSeparateKeys(env: KeyEnv): void {
  const seen = new Map<string, KeyRole>();
  for (const role of Object.keys(KEY_ENV) as KeyRole[]) {
    if (!env[KEY_ENV[role]]) continue;
    const address = accountFor(role, env).address.toLowerCase();
    const other = seen.get(address);
    if (other) throw new KeyError(`${KEY_ENV[role]} and ${KEY_ENV[other]} are the same key`);
    seen.set(address, role);
  }
}

// The policy signer signs PDRs and nothing else: no transactions, no plain messages and
// no other typed data (a purchase order, a token permit). When the address registered
// on chain is given, a key that does not match fails before any PDR is issued.
export function loadPolicySigner(env: KeyEnv, registeredAddress?: Hex): PolicySigner {
  assertSeparateKeys(env);
  const account = accountFor("policySigner", env);
  if (registeredAddress && account.address.toLowerCase() !== registeredAddress.toLowerCase()) {
    throw new KeyError(`${KEY_ENV.policySigner} is not the policy signer registered on chain (${registeredAddress})`);
  }
  const signTypedData = ((params: { primaryType: string }) => {
    if (!(POLICY_SIGNED_TYPES as readonly string[]).includes(params.primaryType)) {
      throw new KeyError(`the policy key only signs ${POLICY_SIGNED_TYPES.join(" and ")}, not ${params.primaryType}`);
    }
    return account.signTypedData(params as never);
  }) as PolicySigner["signTypedData"];
  return { address: account.address, signTypedData };
}

// The relayer only pays gas and sends: without a valid PDR or signature the gate and the
// escrow revert, so this key moves no funds by itself.
export function loadRelayer(env: KeyEnv) {
  assertSeparateKeys(env);
  return accountFor("relayer", env);
}

// Server-side keys on AWS. Each role takes its key from KMS or from an SSM SecureString:
//
//   KEY_SOURCE_RELAYER        kms | ssm   RELAYER_KEY_ID      or secret relayer_private_key
//   KEY_SOURCE_POLICY_SIGNER  kms | ssm   POLICY_KEY_ID       or secret policy_signer_private_key
//   KEY_SOURCE_PAUSER         kms | ssm   PAUSER_KEY_ID       or secret pauser_private_key
//
// The default is kms. With ssm the value goes through the same loaders as `keel agent`
// (engine/src/keys.ts), so the checks are the same; with kms the policy signer keeps the same
// restriction: it signs PolicyDecision and DocumentDecision and nothing else. The owner key
// never comes through here. Roles must have different addresses whatever their source.
import { KMSClient } from "@aws-sdk/client-kms";
import type { Hex } from "@keel/schemas";
import { KEY_ENV, KeyError, loadPauser, loadPolicySigner, loadRelayer, POLICY_SIGNED_TYPES, type PolicySigner } from "@keel/engine";
import type { LocalAccount } from "viem";
import type { Env } from "./config";
import { kmsAccount } from "./kms";
import { secret } from "./secrets";

export type ServerRole = "relayer" | "policySigner" | "pauser";

const SOURCE_ENV: Record<ServerRole, string> = {
  relayer: "KEY_SOURCE_RELAYER",
  policySigner: "KEY_SOURCE_POLICY_SIGNER",
  pauser: "KEY_SOURCE_PAUSER",
};
const KMS_ID_ENV: Record<ServerRole, string> = {
  relayer: "RELAYER_KEY_ID",
  policySigner: "POLICY_KEY_ID",
  pauser: "PAUSER_KEY_ID",
};
export const SSM_SECRET: Record<ServerRole, string> = {
  relayer: "relayer_private_key",
  policySigner: "policy_signer_private_key",
  pauser: "pauser_private_key",
};

export interface KeyDeps {
  env?: Env;
  kms?: Pick<KMSClient, "send">;
  // Reads a secret by name; ./secrets.ts by default
  readSecret?: (name: string) => Promise<string>;
}

function source(role: ServerRole, env: Env): "kms" | "ssm" {
  const value = env[SOURCE_ENV[role]] ?? "kms";
  if (value !== "kms" && value !== "ssm") throw new KeyError(`${SOURCE_ENV[role]} must be kms or ssm`);
  return value;
}

async function account(role: ServerRole, deps: KeyDeps): Promise<LocalAccount> {
  const env = deps.env ?? process.env;
  if (source(role, env) === "kms") {
    const keyId = env[KMS_ID_ENV[role]];
    if (!keyId) throw new KeyError(`${KMS_ID_ENV[role]} is not set`);
    return kmsAccount({ client: deps.kms ?? new KMSClient({}), keyId });
  }
  const read = deps.readSecret ?? ((n: string) => secret(n, env));
  const keyEnv = { [KEY_ENV[role]]: await read(SSM_SECRET[role]) };
  if (role === "relayer") return loadRelayer(keyEnv);
  if (role === "pauser") return loadPauser(keyEnv)!;
  // A LocalAccount wrapper is not needed: the policy signer is only used through PolicySigner
  return loadPolicySigner(keyEnv) as unknown as LocalAccount;
}

// The policy signer signs PDRs and nothing else, whatever holds its key
export function restrictToPdr(account: Pick<LocalAccount, "address" | "signTypedData">): PolicySigner {
  const signTypedData = ((params: { primaryType: string }) => {
    if (!(POLICY_SIGNED_TYPES as readonly string[]).includes(params.primaryType)) {
      throw new KeyError(`the policy key only signs ${POLICY_SIGNED_TYPES.join(" and ")}, not ${params.primaryType}`);
    }
    return account.signTypedData(params as never);
  }) as PolicySigner["signTypedData"];
  return { address: account.address, signTypedData };
}

export interface ServerKeys {
  relayer?: LocalAccount;
  policySigner?: PolicySigner;
  pauser?: LocalAccount;
}

// Loads the roles a handler needs. `registeredPolicySigner` is the address the gate and the
// escrow accept: a key that does not match fails before any PDR is issued.
export async function loadKeys(roles: readonly ServerRole[], deps: KeyDeps = {}, registeredPolicySigner?: Hex): Promise<ServerKeys> {
  const keys: ServerKeys = {};
  const seen = new Map<string, ServerRole>();
  for (const role of roles) {
    const acct = await account(role, deps);
    const address = acct.address.toLowerCase();
    const other = seen.get(address);
    // One stolen key must never fill two roles
    if (other) throw new KeyError(`the ${role} key and the ${other} key are the same key`);
    seen.set(address, role);
    if (role === "policySigner") {
      if (registeredPolicySigner && address !== registeredPolicySigner.toLowerCase()) {
        throw new KeyError(`the policy key is not the policy signer registered on chain (${registeredPolicySigner})`);
      }
      keys.policySigner = restrictToPdr(acct);
    } else keys[role] = acct;
  }
  return keys;
}

// Secrets live in SSM SecureString parameters under /keel-secrets/<chainId>/ (or in Secrets
// Manager, if the deployment chose it). Each Lambda's role can read only its own names, so a
// handler asking for a secret it should not have fails with AccessDenied, not with a value.
// Values are cached per container and never logged.
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { type Env, required } from "./config";

const cache = new Map<string, Promise<string>>();

export function secretName(name: string, env: Env = process.env): string {
  const prefix = env.KEEL_SECRETS_PREFIX ?? `/keel-secrets/${required(env, "KEEL_CHAIN_ID")}/`;
  return `${prefix}${name}`;
}

export function secret(name: string, env: Env = process.env, ssm: SSMClient = new SSMClient({})): Promise<string> {
  const full = secretName(name, env);
  let value = cache.get(full);
  if (!value) {
    value = ssm.send(new GetParameterCommand({ Name: full, WithDecryption: true })).then((r) => {
      const v = r.Parameter?.Value;
      if (!v || v === "CAMBIAR") throw new Error(`secret ${name} is not loaded`);
      return v;
    });
    // A failed read is retried on the next call instead of being cached
    value.catch(() => cache.delete(full));
    cache.set(full, value);
  }
  return value;
}

export function resetSecretCache() {
  cache.clear();
}

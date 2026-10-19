// Secrets live in SSM SecureString parameters under /keel-secrets/<chainId>/ (or in Secrets
// Manager, if the deployment chose it). Each Lambda's role can read only its own names, so a
// handler asking for a secret it should not have fails with AccessDenied, not with a value.
// Values are cached per container and never logged.
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { type Env, required } from "./config";

const cache = new Map<string, Promise<string>>();

// A secret that does not exist yet or still holds no value. The message names the parameter to
// create (infra/terraform/README.md, step 3).
export class SecretMissingError extends Error {
  override name = "SecretMissing";
  constructor(
    readonly secret: string,
    readonly parameter: string,
  ) {
    super(`secret ${secret} is not loaded: create the SecureString ${parameter}`);
  }
}

export function secretName(name: string, env: Env = process.env): string {
  const prefix = env.KEEL_SECRETS_PREFIX ?? `/keel-secrets/${required(env, "KEEL_CHAIN_ID")}/`;
  return `${prefix}${name}`;
}

export function secret(name: string, env: Env = process.env, ssm: SSMClient = new SSMClient({})): Promise<string> {
  const full = secretName(name, env);
  let value = cache.get(full);
  if (!value) {
    value = ssm.send(new GetParameterCommand({ Name: full, WithDecryption: true })).then(
      (r) => {
        const v = r.Parameter?.Value;
        if (!v || v === "CAMBIAR") throw new SecretMissingError(name, full);
        return v;
      },
      (e: { name?: string }) => {
        // SSM answers ParameterNotFound with no detail ("UnknownError"): say which secret it was,
        // so the log tells the operator what to create. The name is not a secret; the value is.
        if (e?.name === "ParameterNotFound") throw new SecretMissingError(name, full);
        throw e;
      },
    );
    // A failed read is retried on the next call instead of being cached
    value.catch(() => cache.delete(full));
    cache.set(full, value);
  }
  return value;
}

export function resetSecretCache() {
  cache.clear();
}

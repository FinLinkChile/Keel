// GET/PUT /admin/settings: which LLM reads documents and whether DMARC is mandatory, as on the
// local server. Bearer token: the secret ingest_admin_token; a PUT names its actor in
// x-admin-actor. The settings live in the ingest table, shared by every instance; each change
// is written with its audit entry (audit#<day>) in one transaction. API keys and base URLs are
// never accepted here: keys come from the secret llm_keys, base URLs from the environment.
import { ACTOR_RE, MAX_ADMIN_BODY_BYTES, MIN_TOKEN_LENGTH, SettingsError, type SettingsStore } from "@keel/ingest";
import { api, bearerMatches, HttpError, type Reply, type Request } from "../http";
import { defaultRuntime, type IngestRuntime } from "../ingest/runtime";
import { secret } from "../secrets";

// The base URL is shown so the admin knows where documents go; it cannot be changed here
const view = (settings: SettingsStore) => ({
  ...settings.get(),
  baseURL: settings.baseURL() ?? null,
  availableProviders: settings.availableProviders(),
});

export function createAdminHandler(
  runtime: () => IngestRuntime = () => defaultRuntime(),
  token: () => Promise<string> = () => secret("ingest_admin_token"),
) {
  const authorize = async (req: Request) => {
    const expected = await token();
    if (expected.length < MIN_TOKEN_LENGTH) throw new Error("ingest_admin_token is too short");
    if (!bearerMatches(req, expected)) throw new HttpError(401, "unauthorized");
  };

  const get = async (req: Request): Promise<Reply> => {
    await authorize(req);
    return { body: view(await runtime().settings()), headers: { "cache-control": "no-store" } };
  };

  const put = async (req: Request): Promise<Reply> => {
    await authorize(req);
    const actor = req.headers["x-admin-actor"];
    if (!actor || !ACTOR_RE.test(actor)) throw new HttpError(400, "missing_actor");
    if (req.rawBody.byteLength > MAX_ADMIN_BODY_BYTES) throw new HttpError(413, "too_large");
    let change: unknown;
    try {
      change = JSON.parse(req.body);
    } catch {
      throw new HttpError(400, "invalid_json");
    }
    const settings = await runtime().settings();
    try {
      const updated = await settings.update(change, actor);
      return { body: { ...updated, ...view(settings) }, headers: { "cache-control": "no-store" } };
    } catch (e) {
      if (e instanceof SettingsError) throw new HttpError(400, "invalid_settings", { message: e.message });
      throw e;
    }
  };

  return api(
    { "GET /admin/settings": get, "PUT /admin/settings": put },
    { "GET /admin/settings": { auth: false }, "PUT /admin/settings": { auth: false } },
  );
}

export const handler = createAdminHandler();

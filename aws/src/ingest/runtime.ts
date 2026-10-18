// What every ingest Lambda shares, built once per container and injectable for tests:
// the DynamoDB repo, the documents bucket, the settings (shared by all instances, read again on
// every invocation), the order and importer registries, notices and the orders table.
//
// Environment: INGEST_TABLE always; DOCS_BUCKET (upload, extractor, inbound); ORDERS_TABLE (extractor), PARTIES_TABLE
// (proforma), NOTICES_QUEUE_URL (extractor, inbound, digest); KEEL_CHAIN_ID or
// KEEL_CONFIG_PREFIX/KEEL_SECRETS_PREFIX (config.ts, secrets.ts); the initial settings
// LLM_PROVIDER, LLM_MODEL, INGEST_REQUIRE_DMARC; the base URLs ANTHROPIC_BASE_URL and
// LLM_COMPAT_BASE_URL; LLM_TIMEOUT_MS (optional, a positive integer of milliseconds, default 60000;
// anything else fails at startup). Secret llm_keys (JSON
// {anthropic?, openai?, gemini?, compat?}) for the handlers that call the model.
import {
  baseUrlsFromEnv,
  initialSettings,
  SettingsStore,
  transferLog,
  type ApiKeys,
  type ExtractorProvider,
  type ImporterRegistry,
  type OrderRegistry,
  type SettingsAudit,
} from "@keel/ingest";
import type { Hex, RequiredDocType } from "@keel/schemas";
import { type Env, required, table } from "../config";
import { enqueueNotice, type NoticeMessage } from "../notices";
import { secret } from "../secrets";
import { s3Objects, type DocumentObjects } from "./objects";
import { appendOrderDocument, partiesImporters, repoOrders, type DocumentsUpdate } from "./orders";
import { DynamoIngestRepo } from "./repo";
import { dynamoSettingsBackend } from "./settings";

export interface IngestRuntime {
  repo: DynamoIngestRepo;
  objects: DocumentObjects;
  // The settings as stored now: refreshed from the table on every call
  settings(): Promise<SettingsStore>;
  // The quarantined extractor for the current settings
  extractor(): Promise<ExtractorProvider>;
  orders: OrderRegistry;
  importers: ImporterRegistry;
  notify(message: NoticeMessage): Promise<boolean>;
  appendOrderDocument(doc: { orderId: Hex; docType: RequiredDocType; fileHash: Hex; extraction: object }): Promise<DocumentsUpdate>;
  now(): Date;
}

// The secret holds one key per vendor; the names are the ones the operators write
export function llmKeys(json: string): ApiKeys {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("secret llm_keys is not JSON");
  }
  const r = (raw ?? {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === "string" && v.length > 0 && v !== "CAMBIAR" ? v : undefined);
  const keys: ApiKeys = {};
  const anthropic = pick(r.anthropic);
  const openai = pick(r.openai);
  const gemini = pick(r.gemini);
  const compat = pick(r.compat);
  if (anthropic) keys.anthropic = anthropic;
  if (openai) keys.openai = openai;
  if (gemini) keys.gemini = gemini;
  if (compat) keys["openai-compatible"] = compat;
  return keys;
}

// Settings changes go to the logs too, next to the audit entries in the table
const logAudit = (entry: SettingsAudit) => console.log(JSON.stringify({ event: "ingest_settings_changed", ...entry }));

export const DEFAULT_LLM_TIMEOUT_MS = 60_000;

// An unset variable is the default; a set one must be a positive integer. A bad value used to
// become NaN, which silently turned the timeout off.
export function llmTimeoutMs(env: Env = process.env): number {
  const raw = env.LLM_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_LLM_TIMEOUT_MS;
  if (!/^[1-9][0-9]*$/.test(raw.trim()) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`LLM_TIMEOUT_MS must be a positive integer of milliseconds, got "${raw}"`);
  }
  return Number(raw);
}

export function settingsLoader(repo: DynamoIngestRepo, keys: () => Promise<ApiKeys>, env: Env = process.env) {
  // Read once, when the runtime is built, so a bad value stops the container at startup
  const timeoutMs = llmTimeoutMs(env);
  let store: Promise<SettingsStore> | undefined;
  return async (): Promise<SettingsStore> => {
    store ??= (async () =>
      SettingsStore.open({
        fallback: initialSettings(env),
        keys: await keys(),
        urls: baseUrlsFromEnv(env),
        backend: dynamoSettingsBackend(repo.table, repo.db()),
        audit: logAudit,
        timeoutMs,
      }))();
    // A failed open (a missing key, a throttled read) is retried on the next invocation
    store.catch(() => (store = undefined));
    const s = await store;
    await s.refresh();
    return s;
  };
}

function lazyObjects(make: () => DocumentObjects): DocumentObjects {
  let objects: DocumentObjects | undefined;
  const get = () => (objects ??= make());
  return {
    presignPut: (key, length, expiresIn) => get().presignPut(key, length, expiresIn),
    get: (key, maxBytes) => get().get(key, maxBytes),
    put: (key, body, contentType) => get().put(key, body, contentType),
    delete: (key) => get().delete(key),
  };
}

let runtime: IngestRuntime | undefined;

export function defaultRuntime(env: Env = process.env): IngestRuntime {
  if (runtime) return runtime;
  const repo = new DynamoIngestRepo(table("ingest", env));
  const settings = settingsLoader(repo, async () => llmKeys(await secret("llm_keys", env)), env);
  runtime = {
    repo,
    // Resolved on use: the digest handler has no DOCS_BUCKET
    objects: lazyObjects(() => s3Objects(required(env, "DOCS_BUCKET"))),
    settings,
    extractor: async () => (await settings()).getExtractor(),
    orders: repoOrders(repo),
    // Resolved on use: only the proforma handler has PARTIES_TABLE
    importers: { has: (address) => partiesImporters(table("parties", env)).has(address) },
    notify: (message) => enqueueNotice(message, env),
    appendOrderDocument: (doc) => appendOrderDocument(table("orders", env), doc),
    now: () => new Date(),
  };
  return runtime;
}

// Transfers to LLM vendors (Ley 21.719) are logged in memory by the extractor; a Lambda
// container forgets them, so the ones `run` made are persisted before it returns.
export async function withTransfers<T>(repo: DynamoIngestRepo, run: () => Promise<T>): Promise<T> {
  const before = transferLog().length;
  try {
    return await run();
  } finally {
    const fresh = transferLog().slice(before);
    if (fresh.length > 0) {
      await repo.recordTransfers(fresh).catch((e: unknown) => {
        console.error(JSON.stringify({ event: "ingest_transfers_not_saved", count: fresh.length, error: (e as Error).name }));
      });
    }
  }
}

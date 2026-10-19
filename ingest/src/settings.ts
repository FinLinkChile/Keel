// Runtime settings an admin can change without a deploy: which LLM reads documents and
// whether DMARC is mandatory. API keys and base URLs are not settings: they stay in the
// environment. A key is never accepted or returned by the API, and a base URL is never
// accepted, because the documents and the key travel to it: whoever held the admin token
// could otherwise point the extractor at their own server and collect both.
import { randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import { createExtractor, PROVIDERS, type ExtractorConfig, type ExtractorProvider, type ProviderName } from "./extractor";

export const IngestSettings = z
  .object({
    provider: z.enum(PROVIDERS),
    model: z.string().min(1).max(100).regex(/^[\w.:/@-]+$/),
    // true: only DMARC pass authenticates. false: an aligned DKIM signature also does when
    // the sender's domain publishes no DMARC record.
    requireDmarc: z.boolean(),
  })
  .strict();
export type IngestSettings = z.infer<typeof IngestSettings>;

export const SettingsChange = IngestSettings.partial().strict();
export type SettingsChange = z.infer<typeof SettingsChange>;

export interface StoredSettings {
  settings: IngestSettings;
  updatedAt: string;
  updatedBy: string;
}

export interface SettingsAudit {
  type: "settings_changed";
  at: string;
  actor: string;
  changes: Partial<Record<keyof IngestSettings, { from: unknown; to: unknown }>>;
}

// One key per vendor, so the admin can switch between those that are configured
export const KEY_ENV: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  "openai-compatible": "LLM_COMPAT_API_KEY",
};

export type ApiKeys = Partial<Record<ProviderName, string>>;

// LLM_API_KEY still works as the key of the provider chosen in LLM_PROVIDER
export function keysFromEnv(env: Record<string, string | undefined>): ApiKeys {
  const initial = (env.LLM_PROVIDER || "anthropic") as ProviderName;
  const keys: ApiKeys = {};
  for (const provider of PROVIDERS) {
    const key = env[KEY_ENV[provider]] || (provider === initial ? env.LLM_API_KEY : undefined);
    if (key) keys[provider] = key;
  }
  return keys;
}

// Base URLs, per provider and from the environment only, like the keys. LLM_BASE_URL still
// works as the URL of the provider chosen in LLM_PROVIDER.
export const BASE_URL_ENV: Partial<Record<ProviderName, string>> = {
  anthropic: "ANTHROPIC_BASE_URL",
  "openai-compatible": "LLM_COMPAT_BASE_URL",
};

export type BaseUrls = Partial<Record<ProviderName, string>>;

export function baseUrlsFromEnv(env: Record<string, string | undefined>): BaseUrls {
  const initial = (env.LLM_PROVIDER || "anthropic") as ProviderName;
  const urls: BaseUrls = {};
  for (const provider of PROVIDERS) {
    const name = BASE_URL_ENV[provider];
    if (!name) continue; // OpenAI and Gemini always go to their vendor
    const url = env[name] || (provider === initial ? env.LLM_BASE_URL : undefined);
    if (url) urls[provider] = url;
  }
  return urls;
}

export class SettingsError extends Error {
  override name = "SettingsError";
}

export function initialSettings(env: Record<string, string | undefined>): IngestSettings {
  return IngestSettings.parse({
    provider: env.LLM_PROVIDER || "anthropic",
    model: env.LLM_MODEL || (env.LLM_PROVIDER && env.LLM_PROVIDER !== "anthropic" ? undefined : "claude-opus-5-5"),
    // Secure by default: relaxing it is an explicit decision
    requireDmarc: env.INGEST_REQUIRE_DMARC !== "false",
  });
}

// Where the settings live. A file for the local server; a table shared by every Lambda
// instance on AWS (aws/src/ingest/settings.ts), so a change made through one instance is the
// one every other instance reads.
export interface SettingsBackend {
  // undefined when nothing was saved yet. Not validated here: SettingsStore validates.
  load(): Promise<StoredSettings | undefined>;
  // Saves `next` together with its audit entry. `previous` is what the change was computed
  // from: false if someone else saved in between, and nothing is written.
  save(next: StoredSettings, audit: SettingsAudit, previous: StoredSettings): Promise<boolean>;
}

// One process owns the file, so a save never loses a race
export function fileSettingsBackend(file: string): SettingsBackend {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(file, "utf8")) as StoredSettings;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw new SettingsError("settings file is invalid");
      }
    },
    async save(next) {
      const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(tmp, file);
      return true;
    },
  };
}

// Stored settings written before base URLs left the settings may still carry one: it is dropped
function validStored(raw: StoredSettings): StoredSettings {
  try {
    const { baseURL: _legacy, ...settings } = raw.settings as IngestSettings & { baseURL?: string };
    return { settings: IngestSettings.parse(settings), updatedAt: String(raw.updatedAt), updatedBy: String(raw.updatedBy) };
  } catch {
    throw new SettingsError("stored settings are invalid");
  }
}

export class SettingsStore {
  private current: StoredSettings;
  private extractor?: { key: string; instance: Promise<ExtractorProvider> };

  private constructor(
    initial: StoredSettings,
    private readonly keys: ApiKeys,
    private readonly urls: BaseUrls,
    private readonly backend: SettingsBackend | undefined,
    private readonly audit: (entry: SettingsAudit) => void,
    private readonly timeoutMs: number | undefined,
  ) {
    this.current = initial;
  }

  // Loads the stored settings if they exist and are valid, otherwise starts from `fallback`.
  // `file` is a shorthand for fileSettingsBackend(file).
  static async open(options: {
    fallback: IngestSettings;
    keys: ApiKeys;
    urls?: BaseUrls;
    file?: string;
    backend?: SettingsBackend;
    audit?: (entry: SettingsAudit) => void;
    // Per-request timeout of the LLM call, passed to the extractor
    timeoutMs?: number;
  }): Promise<SettingsStore> {
    const backend = options.backend ?? (options.file ? fileSettingsBackend(options.file) : undefined);
    const initial: StoredSettings = { settings: options.fallback, updatedAt: new Date().toISOString(), updatedBy: "env" };
    const store = new SettingsStore(initial, options.keys, options.urls ?? {}, backend, options.audit ?? (() => {}), options.timeoutMs);
    await store.refresh();
    await store.extractorConfig(store.current.settings); // fail at startup, not on the first email
    return store;
  }

  // Reads the backend again. A Lambda calls it once per invocation, so a change saved by
  // another instance applies from the next document on.
  async refresh(): Promise<void> {
    if (!this.backend) return;
    const stored = await this.backend.load();
    if (stored) this.current = validStored(stored);
  }

  get(): StoredSettings {
    return structuredClone(this.current);
  }

  // Providers with a key, and with a base URL where one is required
  availableProviders(): ProviderName[] {
    return PROVIDERS.filter((p) => this.keys[p] && (p !== "openai-compatible" || this.urls[p]));
  }

  // Where the current provider's requests go, from the environment. Shown, never editable.
  baseURL(): string | undefined {
    return this.urls[this.current.settings.provider];
  }

  private async extractorConfig(s: IngestSettings): Promise<ExtractorConfig> {
    const apiKey = this.keys[s.provider];
    if (!apiKey) throw new SettingsError(`no API key configured for ${s.provider} (${KEY_ENV[s.provider]})`);
    const config: ExtractorConfig = {
      provider: s.provider,
      apiKey,
      model: s.model,
      baseURL: this.urls[s.provider],
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    };
    // createExtractor validates the provider/baseURL combination and the TLS rule
    await createExtractor(config).catch((e: unknown) => {
      throw new SettingsError(e instanceof Error ? e.message : "invalid extractor settings");
    });
    return config;
  }

  async update(change: unknown, actor: string): Promise<StoredSettings> {
    const parsed = SettingsChange.safeParse(change);
    if (!parsed.success) throw new SettingsError("invalid settings change");
    const previous = this.current;
    const next: IngestSettings = { ...previous.settings, ...parsed.data };
    await this.extractorConfig(next);

    const changes: SettingsAudit["changes"] = {};
    for (const k of Object.keys(IngestSettings.shape) as (keyof IngestSettings)[]) {
      if (previous.settings[k] !== next[k]) changes[k] = { from: previous.settings[k], to: next[k] };
    }
    if (Object.keys(changes).length === 0) return this.get();

    const stored: StoredSettings = { settings: next, updatedAt: new Date().toISOString(), updatedBy: actor };
    const entry: SettingsAudit = { type: "settings_changed", at: stored.updatedAt, actor, changes };
    if (this.backend && !(await this.backend.save(stored, entry, previous))) {
      // Someone else changed them since this instance read them: their change stands
      await this.refresh();
      throw new SettingsError("settings changed concurrently, read them again and retry");
    }
    this.current = stored;
    this.audit(entry);
    return this.get();
  }

  // The extractor for the current settings, rebuilt only when they change
  async getExtractor(): Promise<ExtractorProvider> {
    const s = this.current.settings;
    const key = `${s.provider}|${s.model}`;
    if (this.extractor?.key !== key) {
      this.extractor = { key, instance: this.extractorConfig(s).then(createExtractor) };
    }
    return this.extractor.instance;
  }
}

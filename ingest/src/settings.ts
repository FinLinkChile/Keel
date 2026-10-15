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

export class SettingsStore {
  private current: StoredSettings;
  private extractor?: { key: string; instance: Promise<ExtractorProvider> };

  private constructor(
    initial: StoredSettings,
    private readonly keys: ApiKeys,
    private readonly urls: BaseUrls,
    private readonly file: string | undefined,
    private readonly audit: (entry: SettingsAudit) => void,
  ) {
    this.current = initial;
  }

  // Loads the file if it exists and is valid, otherwise starts from `fallback`.
  static async open(options: {
    fallback: IngestSettings;
    keys: ApiKeys;
    urls?: BaseUrls;
    file?: string;
    audit?: (entry: SettingsAudit) => void;
  }): Promise<SettingsStore> {
    let stored: StoredSettings = { settings: options.fallback, updatedAt: new Date().toISOString(), updatedBy: "env" };
    if (options.file) {
      try {
        const raw = JSON.parse(await readFile(options.file, "utf8")) as StoredSettings;
        // Files written before base URLs left the settings may still carry one: it is dropped
        const { baseURL: _legacy, ...settings } = raw.settings as IngestSettings & { baseURL?: string };
        stored = { ...raw, settings: IngestSettings.parse(settings) };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new SettingsError("settings file is invalid");
      }
    }
    const store = new SettingsStore(stored, options.keys, options.urls ?? {}, options.file, options.audit ?? (() => {}));
    await store.extractorConfig(stored.settings); // fail at startup, not on the first email
    return store;
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
    const config: ExtractorConfig = { provider: s.provider, apiKey, model: s.model, baseURL: this.urls[s.provider] };
    // createExtractor validates the provider/baseURL combination and the TLS rule
    await createExtractor(config).catch((e: unknown) => {
      throw new SettingsError(e instanceof Error ? e.message : "invalid extractor settings");
    });
    return config;
  }

  async update(change: unknown, actor: string): Promise<StoredSettings> {
    const parsed = SettingsChange.safeParse(change);
    if (!parsed.success) throw new SettingsError("invalid settings change");
    const next: IngestSettings = { ...this.current.settings, ...parsed.data };
    await this.extractorConfig(next);

    const changes: SettingsAudit["changes"] = {};
    for (const k of Object.keys(IngestSettings.shape) as (keyof IngestSettings)[]) {
      if (this.current.settings[k] !== next[k]) changes[k] = { from: this.current.settings[k], to: next[k] };
    }
    if (Object.keys(changes).length === 0) return this.get();

    const stored: StoredSettings = { settings: next, updatedAt: new Date().toISOString(), updatedBy: actor };
    if (this.file) {
      const tmp = `${this.file}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(tmp, JSON.stringify(stored, null, 2), { mode: 0o600 });
      await rename(tmp, this.file);
    }
    this.current = stored;
    this.audit({ type: "settings_changed", at: stored.updatedAt, actor, changes });
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

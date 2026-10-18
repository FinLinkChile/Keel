// Quarantined LLM extractor with a pluggable provider. T3.4, issue #21.
// No tools, fixed prompt, schema-only output, strict validation in contract.ts.
import type { CommercialInvoiceExtraction, InvoiceExtraction, TransportDocumentExtraction } from "@keel/schemas";
import { splitByVisibility } from "../pdf/hidden";
import { MAX_PDF_BYTES, PdfReadError, pdfHeaderOffset, readTextRuns, toLines } from "../pdf/text";
import { logTransfer, redactForLlm, rehydrate, type LlmPurpose } from "../privacy";
import {
  type AttachmentType,
  ExtractionError,
  invoiceRequest,
  toExtraction,
  type ExtractionRequest,
  type ExtractorProvider,
} from "./contract";
import { proformaFileRequest, proformaRequest, toProformaReading, type ProformaReading } from "./proforma";
import {
  commercialInvoiceRequest,
  toCommercialInvoiceExtraction,
  toTransportExtraction,
  transportRequest,
} from "./trade";

export const PROVIDERS = ["anthropic", "openai", "gemini", "openai-compatible"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface ExtractorConfig {
  provider: ProviderName;
  apiKey: string;
  model: string;
  // Required for openai-compatible, e.g. the Qwen DashScope endpoint
  baseURL?: string;
  // Timeout of each request to the vendor, in milliseconds (default LLM_TIMEOUT_MS). A hung
  // vendor must not hold a document, or a Lambda, until the platform kills it.
  timeoutMs?: number;
}

export const LLM_TIMEOUT_MS = 60_000;

// Only Claude has a default: the model ids of other vendors change too often to pin here.
const DEFAULT_MODEL: Partial<Record<ProviderName, string>> = { anthropic: "claude-opus-5-5" };

export class ExtractorConfigError extends Error {
  override name = "ExtractorConfigError";
}

// LLM_PROVIDER, LLM_MODEL, LLM_API_KEY and LLM_BASE_URL (required for openai-compatible,
// optional for anthropic behind a proxy).
export function configFromEnv(env: Record<string, string | undefined> = process.env): ExtractorConfig {
  const provider = (env.LLM_PROVIDER || "anthropic") as ProviderName;
  if (!PROVIDERS.includes(provider)) {
    throw new ExtractorConfigError(`LLM_PROVIDER must be one of ${PROVIDERS.join(", ")}`);
  }
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) throw new ExtractorConfigError("LLM_API_KEY is not set");
  const model = env.LLM_MODEL || DEFAULT_MODEL[provider];
  if (!model) throw new ExtractorConfigError(`LLM_MODEL is required for ${provider}`);
  const config = { provider, apiKey, model, baseURL: env.LLM_BASE_URL || undefined };
  validateConfig(config);
  return config;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Document text and the API key travel to baseURL: it must be TLS, except to this machine.
// Only Claude (through a proxy such as LiteLLM) and openai-compatible endpoints take one.
// On OpenAI or Gemini it is rejected rather than ignored: it would make someone believe
// documents go to their own server while they go to the vendor.
const ACCEPTS_BASE_URL: ProviderName[] = ["anthropic", "openai-compatible"];

function validateConfig(config: ExtractorConfig): void {
  if (!ACCEPTS_BASE_URL.includes(config.provider)) {
    if (config.baseURL) throw new ExtractorConfigError("LLM_BASE_URL only applies to anthropic (a proxy) and openai-compatible");
    return;
  }
  if (!config.baseURL) {
    if (config.provider === "openai-compatible") throw new ExtractorConfigError("LLM_BASE_URL is required for openai-compatible");
    return;
  }
  let url: URL;
  try {
    url = new URL(config.baseURL);
  } catch {
    throw new ExtractorConfigError("LLM_BASE_URL is not a valid URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    throw new ExtractorConfigError("LLM_BASE_URL must use https (plain http only to localhost)");
  }
}

// SDKs load lazily: only the selected vendor's SDK is imported.
export async function createExtractor(config: ExtractorConfig): Promise<ExtractorProvider> {
  validateConfig(config);
  const timeout = config.timeoutMs ?? LLM_TIMEOUT_MS;
  switch (config.provider) {
    case "anthropic": {
      const { AnthropicProvider } = await import("./providers/anthropic");
      return new AnthropicProvider(config.apiKey, config.model, config.baseURL, timeout);
    }
    case "openai": {
      const { OpenAIProvider } = await import("./providers/openai");
      return new OpenAIProvider(config.apiKey, config.model, timeout);
    }
    case "gemini": {
      const { GeminiProvider } = await import("./providers/gemini");
      return new GeminiProvider(config.apiKey, config.model, timeout);
    }
    case "openai-compatible": {
      const { OpenAICompatibleProvider } = await import("./providers/openaiCompatible");
      return new OpenAICompatibleProvider(config.apiKey, config.model, config.baseURL!, timeout);
    }
  }
}

// An invoice or a bill of lading is a page or two; anything far longer is padding for an
// injection or a cost attack
export const MAX_LLM_INPUT_CHARS = 20_000;

type Restore = (value: string) => string;

// The model sees only redacted text: no PDF, no personal data, no destinations.
// The token map never leaves this function.
async function extract<T>(
  pdf: Uint8Array,
  extractor: ExtractorProvider,
  purpose: LlmPurpose,
  request: (text: string) => ExtractionRequest,
  validate: (raw: string, restore: Restore) => T,
): Promise<T> {
  let text: string;
  try {
    text = toLines(await readTextRuns(pdf)).join("\n");
  } catch (e) {
    throw new ExtractionError("unreadable_input", { cause: e });
  }
  if (text.length > MAX_LLM_INPUT_CHARS) throw new ExtractionError("input_too_large");
  const { text: redacted, tokenMap, found } = redactForLlm(text);
  logTransfer(extractor.provider, Object.keys(found), purpose);
  const raw = await extractor.complete(request(redacted));
  return validate(raw, (value) => rehydrate(value, tokenMap));
}

export const extractInvoice = (pdf: Uint8Array, extractor: ExtractorProvider): Promise<InvoiceExtraction> =>
  extract(pdf, extractor, "extraccion_factura", invoiceRequest, toExtraction);

export const extractTransportDocument = (
  pdf: Uint8Array,
  extractor: ExtractorProvider,
): Promise<TransportDocumentExtraction> =>
  extract(pdf, extractor, "extraccion_documento_comercio", transportRequest, toTransportExtraction);

export const extractCommercialInvoice = (
  pdf: Uint8Array,
  extractor: ExtractorProvider,
): Promise<CommercialInvoiceExtraction> =>
  extract(pdf, extractor, "extraccion_documento_comercio", commercialInvoiceRequest, toCommercialInvoiceExtraction);

// A proforma PDF with less visible text than this is a scan: its file goes to the model
export const MIN_PROFORMA_TEXT_CHARS = 200;
// The image limit of the providers' APIs (Anthropic: 5 MB per image)
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ProformaExtraction {
  reading: ProformaReading;
  // "text": a PDF with a text layer, redacted before the model saw it. "file": a photo or a
  // scan, sent as it is, because there is no text to redact.
  input: "text" | "file";
}

// T3.9. A PDF with text is read like the other documents: redacted text only, and the parser's
// hidden text check is added to the model's. A photo or a scanned PDF has no text to redact or
// to check, so the file goes to the model: the transfer is logged as unredacted, and the
// importer's review before signing is the second reader.
export async function extractProforma(
  file: Uint8Array,
  mediaType: AttachmentType,
  extractor: ExtractorProvider,
): Promise<ProformaExtraction> {
  if (mediaType === "application/pdf") {
    if (file.length > MAX_PDF_BYTES) throw new ExtractionError("input_too_large");
    let runs;
    try {
      runs = await readTextRuns(file);
    } catch (e) {
      if (e instanceof PdfReadError && e.reason !== "unreadable") throw new ExtractionError("input_too_large", { cause: e });
      throw new ExtractionError("unreadable_input", { cause: e });
    }
    const { visible, hidden } = splitByVisibility(runs);
    if (toLines(visible).join("\n").length >= MIN_PROFORMA_TEXT_CHARS) {
      const text = toLines(runs).join("\n");
      if (text.length > MAX_LLM_INPUT_CHARS) throw new ExtractionError("input_too_large");
      const { text: redacted, tokenMap, found } = redactForLlm(text);
      logTransfer(extractor.provider, Object.keys(found), "extraccion_proforma");
      const reading = toProformaReading(await extractor.complete(proformaRequest(redacted)), (v) => rehydrate(v, tokenMap));
      return { reading: { ...reading, hidden_text_detected: reading.hidden_text_detected || hidden.length > 0 }, input: "text" };
    }
  } else if (file.length > MAX_IMAGE_BYTES) {
    throw new ExtractionError("input_too_large");
  }
  logTransfer(extractor.provider, ["documento_sin_redactar"], "extraccion_proforma");
  // A scanner may write bytes before the PDF header: the model gets the file from the header on
  const sent = mediaType === "application/pdf" ? file.subarray(Math.max(0, pdfHeaderOffset(file))) : file;
  const raw = await extractor.complete(proformaFileRequest({ mediaType, data: Buffer.from(sent).toString("base64") }));
  return { reading: toProformaReading(raw), input: "file" };
}

export {
  EXTRACTION_FAILURES,
  ExtractionError,
  type ExtractionFailure,
  type ExtractionRequest,
  type ExtractorProvider,
} from "./contract";

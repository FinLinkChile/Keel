import Anthropic from "@anthropic-ai/sdk";
import { ExtractionError, type ExtractionRequest, type ExtractorProvider } from "../contract";

// Models that accept `effort` and the server-side refusal fallback
const CURRENT_GEN = /^claude-(opus-5|fable-5|sonnet-5-5)/;

// The file goes before the instructions, as the API recommends for images and documents
function userContent(request: ExtractionRequest): string | Anthropic.Beta.BetaContentBlockParam[] {
  const a = request.attachment;
  if (!a) return request.user;
  const file: Anthropic.Beta.BetaContentBlockParam =
    a.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: a.mediaType, data: a.data } }
      : { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } };
  return [file, { type: "text", text: request.user }];
}

export class AnthropicProvider implements ExtractorProvider {
  // Behind a proxy the documents reach its operator too: the transfer is logged under that name
  readonly provider: "anthropic" | "anthropic-proxy";
  private readonly client: Anthropic;
  private readonly proxied: boolean;

  constructor(
    apiKey: string,
    readonly model: string,
    baseURL?: string,
    timeoutMs?: number,
  ) {
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), ...(timeoutMs ? { timeout: timeoutMs } : {}) });
    this.proxied = baseURL !== undefined;
    this.provider = this.proxied ? "anthropic-proxy" : "anthropic";
  }

  async complete(request: ExtractionRequest): Promise<string> {
    // A proxy (LiteLLM) may not forward the beta header or `effort`: it gets the plain request
    const modern = CURRENT_GEN.test(this.model) && !this.proxied;
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: request.system,
        ...(modern ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        output_config: {
          ...(modern ? { effort: "low" as const } : {}),
          format: { type: "json_schema", schema: request.schema },
        },
        messages: [{ role: "user", content: userContent(request) }],
      });
    } catch (e) {
      throw new ExtractionError("provider_error", { cause: e });
    }
    if (res.stop_reason === "refusal") throw new ExtractionError("refused");
    if (res.stop_reason === "max_tokens") throw new ExtractionError("truncated");
    return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  }
}

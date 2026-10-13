import Anthropic from "@anthropic-ai/sdk";
import { ExtractionError, LLM_OUTPUT_SCHEMA, SYSTEM_PROMPT, userMessage, type ExtractorProvider, type InvoiceDocument } from "../contract";

// Models that accept `effort` and the server-side refusal fallback
const CURRENT_GEN = /^claude-(opus-5|fable-5|sonnet-5-5)/;

export class AnthropicProvider implements ExtractorProvider {
  readonly provider = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(doc: InvoiceDocument): Promise<string> {
    const modern = CURRENT_GEN.test(this.model);
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        ...(modern ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        output_config: {
          ...(modern ? { effort: "low" as const } : {}),
          format: { type: "json_schema", schema: LLM_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
        },
        messages: [{ role: "user", content: userMessage(doc.text) }],
      });
    } catch (e) {
      throw new ExtractionError("provider_error", { cause: e });
    }
    if (res.stop_reason === "refusal") throw new ExtractionError("refused");
    if (res.stop_reason === "max_tokens") throw new ExtractionError("truncated");
    return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  }
}

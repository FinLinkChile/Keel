import OpenAI from "openai";
import { ExtractionError, LLM_OUTPUT_SCHEMA, SYSTEM_PROMPT, userMessage, type ExtractorProvider, type InvoiceDocument } from "../contract";

export class OpenAIProvider implements ExtractorProvider {
  readonly provider = "openai";
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(doc: InvoiceDocument): Promise<string> {
    let res: OpenAI.Responses.Response;
    try {
      res = await this.client.responses.create({
        model: this.model,
        instructions: SYSTEM_PROMPT,
        input: [{ role: "user", content: [{ type: "input_text", text: userMessage(doc.text) }] }],
        text: {
          format: {
            type: "json_schema",
            name: "invoice_extraction",
            strict: true,
            schema: LLM_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      });
    } catch (e) {
      throw new ExtractionError("provider_error", { cause: e });
    }
    const refused = res.output.some(
      (item) => item.type === "message" && item.content.some((c) => c.type === "refusal"),
    );
    if (refused) throw new ExtractionError("refused");
    if (res.status === "incomplete") throw new ExtractionError("truncated");
    return res.output_text;
  }
}

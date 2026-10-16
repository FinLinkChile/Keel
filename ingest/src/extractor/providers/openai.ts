import OpenAI from "openai";
import { ExtractionError, type ExtractionRequest, type ExtractorProvider } from "../contract";

export class OpenAIProvider implements ExtractorProvider {
  readonly provider = "openai";
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(request: ExtractionRequest): Promise<string> {
    let res: OpenAI.Responses.Response;
    try {
      res = await this.client.responses.create({
        model: this.model,
        instructions: request.system,
        input: [{ role: "user", content: [{ type: "input_text", text: request.user }] }],
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.schema,
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

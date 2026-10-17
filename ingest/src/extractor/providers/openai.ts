import OpenAI from "openai";
import { ExtractionError, type ExtractionRequest, type ExtractorProvider } from "../contract";

function attachmentContent(request: ExtractionRequest): OpenAI.Responses.ResponseInputContent[] {
  const a = request.attachment;
  if (!a) return [];
  const url = `data:${a.mediaType};base64,${a.data}`;
  return a.mediaType === "application/pdf"
    ? [{ type: "input_file", filename: "document.pdf", file_data: url }]
    : [{ type: "input_image", image_url: url, detail: "high" }];
}

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
        input: [{ role: "user", content: [...attachmentContent(request), { type: "input_text", text: request.user }] }],
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

// Any endpoint that speaks the OpenAI Chat Completions API: Qwen (Alibaba DashScope),
// DeepSeek, Kimi, or a self-hosted model. Not all of them support strict JSON Schema,
// so the output is requested as a JSON object and contract.ts validates it strictly.
import OpenAI from "openai";
import { ExtractionError, type ExtractionRequest, type ExtractorProvider } from "../contract";

export class OpenAICompatibleProvider implements ExtractorProvider {
  readonly provider = "openai-compatible";
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    baseURL: string,
  ) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async complete(request: ExtractionRequest): Promise<string> {
    let res: OpenAI.Chat.ChatCompletion;
    try {
      res = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${request.system}\n\nReply with one JSON object that matches this JSON Schema exactly:\n${JSON.stringify(request.schema)}`,
          },
          { role: "user", content: request.user },
        ],
      });
    } catch (e) {
      throw new ExtractionError("provider_error", { cause: e });
    }
    const choice = res.choices[0];
    if (choice?.message.refusal || choice?.finish_reason === "content_filter") throw new ExtractionError("refused");
    if (choice?.finish_reason === "length") throw new ExtractionError("truncated");
    const content = choice?.message.content;
    if (!content) throw new ExtractionError("invalid_output");
    return content;
  }
}

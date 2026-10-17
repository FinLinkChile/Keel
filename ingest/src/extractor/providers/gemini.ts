import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { ExtractionError, type ExtractionRequest, type ExtractorProvider } from "../contract";

const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"]);

export class GeminiProvider implements ExtractorProvider {
  readonly provider = "gemini";
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async complete(request: ExtractionRequest): Promise<string> {
    let res: GenerateContentResponse;
    try {
      res = await this.client.models.generateContent({
        model: this.model,
        contents: [
          {
            role: "user",
            parts: [
              ...(request.attachment ? [{ inlineData: { mimeType: request.attachment.mediaType, data: request.attachment.data } }] : []),
              { text: request.user },
            ],
          },
        ],
        config: {
          systemInstruction: request.system,
          responseMimeType: "application/json",
          responseJsonSchema: request.schema,
          temperature: 0,
        },
      });
    } catch (e) {
      throw new ExtractionError("provider_error", { cause: e });
    }
    const finish = res.candidates?.[0]?.finishReason;
    if (res.promptFeedback?.blockReason || (finish && BLOCKED.has(finish))) throw new ExtractionError("refused");
    if (finish === "MAX_TOKENS") throw new ExtractionError("truncated");
    const text = res.text;
    if (!text) throw new ExtractionError("invalid_output");
    return text;
  }
}

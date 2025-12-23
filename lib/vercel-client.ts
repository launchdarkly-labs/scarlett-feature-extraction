/**
 * Vercel AI Gateway Client with Structured Output Support
 * Uses OpenAI SDK with Vercel AI Gateway for LLM-based feature extraction
 */

import OpenAI from "openai";

export class VercelAIClient {
  private client: OpenAI;

  constructor(apiKey?: string, baseURL: string = "https://ai-gateway.vercel.sh/v1") {
    // Prefer OIDC token (for vercel dev), fallback to API key
    const oidcToken = process.env.VERCEL_OIDC_TOKEN;
    const key = apiKey || oidcToken || process.env.AI_GATEWAY_API_KEY;

    if (!key) {
      throw new Error(
        "No API key or OIDC token found. Set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN environment variable."
      );
    }

    this.client = new OpenAI({
      apiKey: key,
      baseURL,
    });
  }

  async extractFeatures(params: {
    transcript: string;
    model: string;
    systemPrompt: string;
    temperature?: number;
    jsonSchema: Record<string, any>;
  }): Promise<any> {
    const { transcript, model, systemPrompt, temperature = 0, jsonSchema } = params;

    console.log(`Calling Vercel AI Gateway with model: ${model}`);
    console.log(`Schema has ${Object.keys(jsonSchema.properties || {}).length} properties`);

    try {
      const response = await this.client.beta.chat.completions.parse({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Transcript:\n\n${transcript}` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: jsonSchema.title || "extraction_schema",
            strict: true,
            schema: jsonSchema,
          },
        },
        temperature,
        timeout: 30000, // 30 second timeout
      });

      console.log("Extraction successful");
      return response.choices[0].message.parsed;
    } catch (error: any) {
      console.error("Extraction error:", error.message || error);
      if (error.response) {
        console.error("API Response:", error.response.status, error.response.data);
      }
      throw new Error(`Feature extraction failed: ${error.message || error}`);
    }
  }

  getDefaultExtractionPrompt(): string {
    return `You are an expert sales analyst extracting structured information from sales call transcripts.

Your task is to analyze the transcript and extract the following information:

1. **Metadata**: Identify the salesperson, customer company, date, duration, and call sequence number
2. **Business Context**: Classify deal stage, customer size, and industry
3. **Sentiment**: Assess customer sentiment about product, pricing, competitors, market conditions, and current solution
4. **Signals**: Count decision makers, note budget amounts and timelines mentioned
5. **Deal Signals**: Identify if next steps were defined, objections raised/resolved, etc.

Guidelines:
- Be precise and evidence-based
- Set boolean flags to false when not explicitly mentioned
- Use null for optional numerical fields when not discussed
- Infer deal stage based on conversation context
- Default call_number to 1 if not mentioned

Return all information in the structured format provided.`;
  }
}

export function mapLDToVercelModel(ldModelName: string): string {
  const modelMapping: Record<string, string> = {
    // Google models - map to actual available models
    "gemini-2.5-flash": "google/gemini-2.5-flash",
    "gemini-2.5-pro": "google/gemini-2.5-pro",
    "gemini-2.0-flash": "google/gemini-2.0-flash",

    // Anthropic models
    "claude-3.5-sonnet": "anthropic/claude-3.5-sonnet",
    "claude-3.5-haiku": "anthropic/claude-3.5-haiku",
    "claude-3-haiku": "anthropic/claude-3-haiku",
    "claude-3-opus": "anthropic/claude-3-opus",

    // OpenAI models
    "gpt-4o": "openai/gpt-4o",
    "gpt-4o-mini": "openai/gpt-4o-mini",
    "gpt-4-turbo": "openai/gpt-4-turbo",
    "gpt-3.5-turbo": "openai/gpt-3.5-turbo",

    // DeepSeek models
    "deepseek-v3": "deepseek/deepseek-v3",
    "deepseek-v3.2": "deepseek/deepseek-v3.2",
    "deepseek-r1": "deepseek/deepseek-r1",

    // Add other specific models as needed
  };

  // If already in Vercel format (has /), return as-is
  if (ldModelName.includes("/")) {
    return ldModelName;
  }

  // Otherwise, look up mapping or return as-is
  return modelMapping[ldModelName] || ldModelName;
}

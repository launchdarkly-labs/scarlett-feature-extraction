/**
 * LaunchDarkly AI SDK Implementation for Next.js
 *
 * This implementation uses the official LaunchDarkly AI SDK pattern with initAi()
 * and proper integration with Vercel AI Gateway through VercelProvider.
 *
 * ARCHITECTURE:
 * 1. Initialize LaunchDarkly client (singleton)
 * 2. Initialize AI client using initAi()
 * 3. Get AI configs using completionConfig()
 * 4. Convert configs to Vercel format using VercelProvider.toVercelAISDK()
 * 5. Use Vercel AI SDK's generateObject() for structured output
 * 6. Track metrics using aiConfig.tracker.trackMetricsOf()
 *
 * This implementation is compatible with:
 * - Local development (npm run dev)
 * - Docker builds
 * - Vercel deployments
 */

import * as ld from "@launchdarkly/node-server-sdk";
import { initAi } from "@launchdarkly/server-sdk-ai";
import { VercelProvider } from "@launchdarkly/server-sdk-ai-vercel";
import { generateObject, jsonSchema as createJsonSchema } from "ai";

// Singleton instances
let ldClientInstance: ld.LDClient | null = null;
let initializationPromise: Promise<void> | null = null;

/**
 * Map LaunchDarkly model names to Vercel AI Gateway compatible model names
 * This handles cases where LD uses version-specific model names that aren't in Vercel
 */
function mapLDModelToVercel(ldModelName: string): string {
  const modelMap: Record<string, string> = {
    // Claude models
    "claude-3-opus-20240229": "claude-3-opus",
    "claude-3-5-sonnet-20241022": "claude-3.5-sonnet",
    "claude-3-5-sonnet-20240620": "claude-3.5-sonnet-20240620",
    "claude-3-haiku-20240307": "claude-3-haiku",
    "claude-3-7-sonnet-latest": "claude-3.7-sonnet",

    // Gemini models
    "gemini-1.5-pro-002": "gemini-2.5-pro",
    "gemini-1.5-pro": "gemini-2.5-pro",
    "gemini-1.5-flash-002": "gemini-2.0-flash",
    "gemini-2.0-flash-exp": "gemini-2.0-flash",
    "gemini-2.0-flash-thinking-exp-01-21": "gemini-2.0-flash",
  };

  // Return mapped name if exists, otherwise return original
  return modelMap[ldModelName] || ldModelName;
}

function getLDClient(): ld.LDClient {
  if (!ldClientInstance) {
    const sdkKey = process.env.LAUNCHDARKLY_SDK_KEY?.trim();

    if (!sdkKey) {
      throw new Error(
        "No LaunchDarkly SDK key found. Set LAUNCHDARKLY_SDK_KEY environment variable."
      );
    }

    ldClientInstance = ld.init(sdkKey);
  }

  return ldClientInstance;
}

async function ensureInitialized(): Promise<void> {
  if (!initializationPromise) {
    const client = getLDClient();
    initializationPromise = Promise.race([
      client.waitForInitialization(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('LaunchDarkly initialization timeout after 5s')), 5000)
      )
    ]).then(() => {
      console.log("LaunchDarkly client initialized successfully");
      return;
    }).catch((err) => {
      console.error("LaunchDarkly initialization failed:", err);
      throw err;
    });
  }

  await initializationPromise;
}

export class LaunchDarklyAIClient {
  private ldClient: ld.LDClient | null = null;
  private aiClient: any = null;

  constructor() {
    // Don't initialize here - let it be lazy loaded
  }

  private ensureLDClient(): ld.LDClient {
    if (!this.ldClient) {
      this.ldClient = getLDClient();
      this.aiClient = initAi(this.ldClient);
    }
    return this.ldClient;
  }

  async initialize(): Promise<void> {
    this.ensureLDClient();
    await ensureInitialized();
  }

  /**
   * Extract structured features from a transcript using AI Config
   * Uses the working invokeStructuredModel() approach with unified AI Config
   */
  async extractStructuredFeatures(params: {
    configKey: string;
    context: ld.LDContext;
    transcript: string;
  }): Promise<any> {
    const { configKey, context, transcript } = params;

    // Ensure client is initialized before each flag evaluation
    this.ensureLDClient();
    await ensureInitialized();

    console.error("[EXTRACT] Client initialized, fetching AI config:", configKey);

    try {
      // Get the AI config using the SDK's completionConfig method
      const aiConfig = await this.aiClient!.completionConfig(
        configKey,
        context,
        { enabled: false }
      );

      console.error("[EXTRACT] AI Config retrieved. Enabled:", aiConfig?.enabled, "Has tools:", !!(aiConfig?.model?.parameters?.tools));

      if (!aiConfig || !aiConfig.enabled) {
        console.error("[EXTRACT] ERROR: AI Config not found or disabled");
        throw new Error(`AI Config '${configKey}' not found or disabled`);
      }

      // Extract JSON schema from the first tool (all tools share same core fields)
      const tools = aiConfig.model?.parameters?.tools || [];
      if (!tools || tools.length === 0) {
        throw new Error("No tools found in AI config");
      }

      const jsonSchema = tools[0].parameters;

      // Get model name and provider
      const ldModelName = aiConfig.model?.name;
      const providerName = VercelProvider.mapProvider(aiConfig.provider?.name || "");

      if (!ldModelName) {
        throw new Error("Model name is required in AI configuration");
      }

      // Map LD model name to Vercel-compatible name
      const vercelModelName = mapLDModelToVercel(ldModelName);

      // Construct the gateway model ID: "provider/model"
      const gatewayModelId = `${providerName}/${vercelModelName}`;

      // Get API key for Vercel AI Gateway (trim to remove any whitespace/newlines)
      const vercelOidc = process.env.VERCEL_OIDC_TOKEN?.trim();
      const aiGatewayKey = process.env.AI_GATEWAY_API_KEY?.trim();

      // On Vercel, prefer AI_GATEWAY_API_KEY if OIDC is expired/unavailable
      const isVercel = process.env.VERCEL === '1';
      const apiKey = isVercel ? (aiGatewayKey || vercelOidc || "") : (vercelOidc || aiGatewayKey || "");

      console.error("[DEBUG] Running on Vercel:", isVercel);
      console.error("[DEBUG] VERCEL_OIDC_TOKEN available:", !!vercelOidc, "length:", vercelOidc?.length || 0);
      console.error("[DEBUG] AI_GATEWAY_API_KEY available:", !!aiGatewayKey, "length:", aiGatewayKey?.length || 0);
      console.error("[DEBUG] Using:", apiKey === vercelOidc ? "VERCEL_OIDC_TOKEN" : apiKey === aiGatewayKey ? "AI_GATEWAY_API_KEY" : "NONE");

      if (!apiKey) {
        console.error("[ERROR] No API key available. VERCEL_OIDC_TOKEN:", process.env.VERCEL_OIDC_TOKEN ? "SET" : "NOT SET", "AI_GATEWAY_API_KEY:", process.env.AI_GATEWAY_API_KEY ? "SET" : "NOT SET");
        throw new Error("No Vercel AI Gateway API key found");
      }

      // Create the OpenAI interface for Vercel AI Gateway
      const { createOpenAI } = await import("@ai-sdk/openai");
      const vercelGateway = createOpenAI({
        baseURL: "https://ai-gateway.vercel.sh/v1",
        apiKey: apiKey,
      });

      const model = vercelGateway.chat(gatewayModelId);

      // Map parameters using VercelProvider's utility
      const parameters = VercelProvider.mapParameters(
        aiConfig.model?.parameters || {}
      );

      // Create VercelProvider instance (using type assertion to handle version mismatches)
      const provider = new VercelProvider(model as any, parameters);

      // Get system prompt from config messages
      const systemPrompt = aiConfig.config?.messages?.[0]?.content ||
        "Extract structured information from the provided transcript.";

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: `Transcript:\n\n${transcript}` },
      ];

      console.error("[EXTRACT] Calling invokeStructuredModel with model:", gatewayModelId);
      console.error("[EXTRACT] API key length:", apiKey.length);
      console.error("[EXTRACT] Schema keys:", Object.keys(jsonSchema).join(", "));

      // Use invokeStructuredModel for structured output
      const response = await provider.invokeStructuredModel(
        messages,
        jsonSchema
      );

      console.error("[EXTRACT] LLM response received. Type:", typeof response);
      console.error("[EXTRACT] Response keys:", response ? Object.keys(response).join(", ") : "null");

      // VercelProvider.invokeStructuredModel returns: { value: {...}, metrics: {...} }
      const result = (response as any).value || response;
      console.error("[EXTRACT] Extracted result fields:", Object.keys(result || {}).length);

      return result;
    } catch (error: any) {
      console.error("[EXTRACT] Feature extraction error:", error);
      console.error("[EXTRACT] Error stack:", error?.stack);
      throw new Error(`Feature extraction failed: ${error?.message || error}`);
    }
  }

  /**
   * Extract JSON Schema from LaunchDarkly AI Config tools.
   *
   * LaunchDarkly AI Configs can include "tools" which define structured output schemas.
   * This function extracts the JSON schema from the first tool in the configuration.
   *
   * @param aiConfig - The AI configuration from LaunchDarkly
   * @returns The JSON schema from the first tool, or null if no tools are defined
   */
  async extractJSONSchemaFromTools(
    aiConfig: any | null
  ): Promise<Record<string, any> | null> {
    if (!aiConfig) {
      return null;
    }

    // LaunchDarkly returns tools in model.parameters.tools
    const tools = aiConfig.model?.parameters?.tools;

    if (!tools || tools.length === 0) {
      console.log("No tools found in config");
      return null;
    }

    try {
      const tool = tools[0];

      // LaunchDarkly returns the schema directly in tool.parameters
      if (tool.parameters) {
        return tool.parameters;
      }

      // Tool is a reference - this shouldn't happen in production
      if (tool.key && !tool.parameters) {
        console.error(
          "ERROR: LaunchDarkly returned tool reference instead of full schema"
        );
        return null;
      }

      return null;
    } catch (error) {
      console.error("Failed to extract JSON Schema from tools:", error);
      return null;
    }
  }

  /**
   * Get AI Config from LaunchDarkly
   * This uses the SDK's completionConfig method
   */
  async getAIConfig(
    configKey: string,
    context: ld.LDContext
  ): Promise<any | null> {
    try {
      // Ensure client is initialized before each flag evaluation
      this.ensureLDClient();
      await ensureInitialized();

      const config = await this.aiClient!.completionConfig(
        configKey,
        context,
        { enabled: false }
      );

      if (!config || !config.enabled) {
        console.warn(`AI Config '${configKey}' not found or disabled`);
        return null;
      }

      return config;
    } catch (error) {
      console.error(`Failed to fetch AI Config '${configKey}':`, error);
      return null;
    }
  }

  /**
   * Create LaunchDarkly context
   */
  createContext(
    key: string,
    kind: string = "transcript",
    attributes?: Record<string, any>
  ): ld.LDContext {
    return {
      kind,
      key,
      ...attributes,
    };
  }

  async close(): Promise<void> {
    if (ldClientInstance) {
      await ldClientInstance.close();
      ldClientInstance = null;
    }
  }
}

// Export singleton instance for convenience
export const ldAIClient = new LaunchDarklyAIClient();

// Export convenience functions
export function createContext(
  key: string,
  kind: string = "transcript",
  attributes?: Record<string, any>
): ld.LDContext {
  return {
    kind,
    key,
    ...attributes,
  };
}

export async function extractJSONSchemaFromTools(
  aiConfig: any | null
): Promise<Record<string, any> | null> {
  return ldAIClient.extractJSONSchemaFromTools(aiConfig);
}

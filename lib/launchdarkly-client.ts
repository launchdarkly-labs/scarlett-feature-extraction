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
import { generateObject, jsonSchema } from "ai";

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
    const sdkKey = process.env.LAUNCHDARKLY_SDK_KEY;

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
  private ldClient: ld.LDClient;
  private aiClient: any;

  constructor() {
    this.ldClient = getLDClient();
    // Initialize AI client using the official SDK pattern
    this.aiClient = initAi(this.ldClient);
  }

  async initialize(): Promise<void> {
    await ensureInitialized();
  }

  /**
   * Extract structured features from a transcript using AI Config
   * Following the official SDK pattern with completionConfig() and VercelProvider.toVercelAISDK()
   */
  async extractStructuredFeatures(params: {
    configKey: string;
    context: ld.LDContext;
    transcript: string;
    jsonSchema: Record<string, any>;
  }): Promise<any> {
    const { configKey, context, transcript, jsonSchema: responseSchema } = params;

    // Ensure client is initialized before each flag evaluation
    await ensureInitialized();

    console.log(`Requesting AI Config: ${configKey}`);
    console.log(`With context:`, JSON.stringify(context, null, 2));

    try {
      // Get the AI config using the SDK's completionConfig method
      const aiConfig = await this.aiClient.completionConfig(
        configKey,
        context,
        { enabled: false }
      );

      if (!aiConfig || !aiConfig.enabled) {
        throw new Error(`AI Config '${configKey}' not found or disabled`);
      }

      console.log(`Using AI Config: ${configKey}`);
      console.log(`Config enabled:`, aiConfig.enabled);
      console.log(`Model:`, aiConfig.model?.name);
      console.log(`Provider:`, aiConfig.provider?.name);

      // Get the model name from aiConfig (not aiConfig.config!)
      const ldModelName = aiConfig.model?.name;
      const providerName = VercelProvider.mapProvider(aiConfig.provider?.name || "");

      if (!ldModelName) {
        console.error("Model name not found in aiConfig");
        throw new Error("Model name is required in AI configuration");
      }

      // Map LD model name to Vercel-compatible name
      const vercelModelName = mapLDModelToVercel(ldModelName);

      // Log the mapping for debugging
      if (ldModelName !== vercelModelName) {
        console.log(`Model mapping: ${ldModelName} → ${vercelModelName}`);
      }

      // Construct the gateway model ID: "provider/model"
      const gatewayModelId = `${providerName}/${vercelModelName}`;

      // Get API key for Vercel AI Gateway
      const apiKey = process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY || "";
      if (!apiKey) {
        throw new Error("No Vercel AI Gateway API key found. Set VERCEL_OIDC_TOKEN or AI_GATEWAY_API_KEY");
      }

      // Create the OpenAI interface for Vercel AI Gateway
      const { createOpenAI } = await import("@ai-sdk/openai");
      const vercelGateway = createOpenAI({
        baseURL: "https://ai-gateway.vercel.sh/v1",
        apiKey: apiKey,
      });

      // Create a provider function that returns the model for the given ID
      // This function is called by VercelProvider.toVercelAISDK()
      const providerFunction = (modelId: string) => {
        console.log(`Provider function called with modelId: ${modelId}`);
        // Return the chat model for the gateway model ID
        return vercelGateway.chat(gatewayModelId);
      };

      // Prepare user message
      const userMessage = {
        role: "user" as const,
        content: `Transcript:\n\n${transcript}`,
      };

      // Convert AI config to Vercel AI SDK format
      // Pass the entire aiConfig, not aiConfig.config!
      const vercelConfig = VercelProvider.toVercelAISDK(aiConfig, providerFunction, {
        nonInterpolatedMessages: [userMessage],
      });

      console.log("VercelConfig keys:", Object.keys(vercelConfig));
      console.log("VercelConfig.model:", vercelConfig.model);
      console.log("Using JSON Schema with", Object.keys(responseSchema.properties || {}).length, "properties");

      // Wrap the schema using jsonSchema() from Vercel AI SDK
      const schema = jsonSchema(responseSchema);

      // Use generateObject for structured output with metrics tracking
      const result = await aiConfig.tracker.trackMetricsOf(
        VercelProvider.getAIMetricsFromResponse,
        () => generateObject({
          ...vercelConfig,
          messages: vercelConfig.messages ?? [],
          schema: schema,
        } as any)
      );

      console.log("Structured extraction response received");
      console.log("Result keys:", Object.keys(result));

      // The result from generateObject contains { object, finishReason, usage }
      if (!result.object || Object.keys(result.object).length === 0) {
        console.error("SDK returned empty object despite completion");
        console.error("Finish reason:", result.finishReason);
        throw new Error("Extraction returned no data");
      }

      console.log("Extraction successful, data keys:", Object.keys(result.object));
      return result.object;
    } catch (error: any) {
      console.error("Feature extraction error:", error);
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
      await ensureInitialized();

      const config = await this.aiClient.completionConfig(
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
    const context: ld.LDContext = {
      kind,
      key,
      ...attributes,
    };

    console.log(`Created context with kind '${kind}' and key '${key}'`);
    if (attributes?.variation_hint) {
      console.log(`Context includes variation_hint: ${attributes.variation_hint}`);
    }

    return context;
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
  const context: ld.LDContext = {
    kind,
    key,
    ...attributes,
  };

  console.log(`Created context with kind '${kind}' and key '${key}'`);
  if (attributes?.variation_hint) {
    console.log(`Context includes variation_hint: ${attributes.variation_hint}`);
  }

  return context;
}

export async function extractJSONSchemaFromTools(
  aiConfig: any | null
): Promise<Record<string, any> | null> {
  return ldAIClient.extractJSONSchemaFromTools(aiConfig);
}

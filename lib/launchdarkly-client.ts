/**
 * LaunchDarkly AI SDK Implementation for Next.js
 *
 * This implementation follows the official pattern from @launchdarkly/server-sdk-ai-vercel
 * but handles Next.js bundling issues through careful use of dynamic imports.
 *
 * WHY THIS IMPLEMENTATION EXISTS:
 * The official LaunchDarkly SDK (@launchdarkly/server-sdk-ai) uses dynamic imports
 * to load provider-specific packages at runtime. Next.js tries to statically analyze
 * and bundle these imports at build time, causing errors for optional packages we
 * don't have installed (like @launchdarkly/server-sdk-ai-openai).
 *
 * HOW THIS WORKS:
 * 1. We use VercelProvider directly with the @ai-sdk packages
 * 2. Dynamic imports are used only in a switch statement at runtime
 * 3. The JSON schemas are extracted from LaunchDarkly AI Config tools
 * 4. The next.config.js webpack configuration handles the remaining bundling issues
 *
 * This implementation is compatible with:
 * - Local development (npm run dev)
 * - Docker builds
 * - Vercel deployments
 */

import * as ld from "@launchdarkly/node-server-sdk";
import { VercelProvider } from "@launchdarkly/server-sdk-ai-vercel";
import { type LanguageModel } from "ai";

// Singleton instances
let ldClientInstance: ld.LDClient | null = null;
let initializationPromise: Promise<void> | null = null;

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
    // Use Promise.race to implement timeout
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

/**
 * Creates a Vercel AI Gateway model from LaunchDarkly configuration.
 * Routes ALL models through Vercel AI Gateway using the OpenAI-compatible interface.
 *
 * @param aiConfig - The AI configuration from LaunchDarkly containing provider and model info
 * @returns A LanguageModel instance that routes through Vercel AI Gateway
 */
async function createVercelModel(aiConfig: any): Promise<any> {
  const providerName = VercelProvider.mapProvider(
    aiConfig.provider?.name || aiConfig.model?.provider || ""
  );
  const modelName = aiConfig.model?.name;

  if (!modelName) {
    throw new Error("Model name is required in AI configuration");
  }

  // Construct the gateway model ID: "provider/model"
  // e.g., "google/gemini-2.0-flash", "anthropic/claude-3-5-sonnet"
  const gatewayModelId = `${providerName}/${modelName}`;
  console.log(`Creating Vercel AI Gateway model: ${gatewayModelId}`);

  // Get API key for Vercel AI Gateway
  const apiKey = process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY || "";
  if (!apiKey) {
    throw new Error("No Vercel AI Gateway API key found. Set VERCEL_OIDC_TOKEN or AI_GATEWAY_API_KEY");
  }

  // Use ONLY the OpenAI interface from Vercel AI SDK
  // This works for ALL providers through Vercel AI Gateway
  const { createOpenAI } = await import("@ai-sdk/openai");
  const vercelGateway = createOpenAI({
    baseURL: "https://ai-gateway.vercel.sh/v1",
    apiKey: apiKey,
  });

  // Use the chat model interface explicitly for all providers
  // This ensures it uses /chat/completions endpoint instead of /responses
  return vercelGateway.chat(gatewayModelId);
}

export class LaunchDarklyAIClient {
  private ldClient: ld.LDClient;

  constructor() {
    this.ldClient = getLDClient();
  }

  async initialize(): Promise<void> {
    await ensureInitialized();
  }

  /**
   * Extract structured features from a transcript using AI Config
   * Following the VercelProvider pattern for structured outputs
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

    // Get the AI config from LaunchDarkly
    console.log(`Requesting AI Config: ${configKey}`);
    console.log(`With context:`, JSON.stringify(context, null, 2));

    const aiConfig = await this.ldClient.jsonVariation(
      configKey,
      context,
      null
    );

    if (!aiConfig) {
      throw new Error(`AI Config '${configKey}' not found`);
    }

    console.log(`Using AI Config: ${configKey}`);
    console.log(`Received variation:`, (aiConfig as any)._ldMeta?.variationKey || 'unknown');

    try {
      // Create the Vercel model using dynamic imports
      const model = await createVercelModel(aiConfig);

      // Map parameters using VercelProvider's utility
      const parameters = VercelProvider.mapParameters(
        (aiConfig as any).model?.parameters || {}
      );

      // Create VercelProvider instance with a logger to see errors
      const logger = {
        error: (message: string, ...args: any[]) => console.error(`VercelProvider Error: ${message}`, ...args),
        warn: (message: string, ...args: any[]) => console.warn(`VercelProvider Warning: ${message}`, ...args),
        info: (message: string, ...args: any[]) => console.log(`VercelProvider Info: ${message}`, ...args),
        debug: (message: string, ...args: any[]) => console.debug(`VercelProvider Debug: ${message}`, ...args)
      };
      const provider = new VercelProvider(model, parameters, logger);

      // Get messages from config
      const systemPrompt =
        (aiConfig as any).messages?.[0]?.content ||
        "Extract structured information from the provided transcript.";

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: `Transcript:\n\n${transcript}` },
      ];

      // Log the schema being used
      console.log("Using JSON Schema:", JSON.stringify(responseSchema, null, 2).slice(0, 500) + "...");
      console.log("Message count:", messages.length);
      console.log("System message preview:", messages[0].content.slice(0, 200) + "...");

      // Use invokeStructuredModel for structured output
      // The SDK will wrap the schema with jsonSchema internally
      const response = await provider.invokeStructuredModel(
        messages,
        responseSchema
      );

      console.log("Structured extraction response received");
      console.log("Response metrics:", JSON.stringify(response.metrics, null, 2));

      // The SDK's invokeStructuredModel returns { data, rawResponse, metrics }
      // The actual extracted data is in response.data
      if (!response.metrics?.success) {
        console.error("SDK invocation failed - metrics.success is false");
        console.error("Full response:", JSON.stringify(response, null, 2));
        throw new Error("AI invocation failed");
      }

      if (!response.data || Object.keys(response.data).length === 0) {
        console.error("SDK returned empty data object despite success");
        console.error("Full response:", JSON.stringify(response, null, 2));
        throw new Error("Extraction returned no data");
      }

      console.log("Extraction successful, data keys:", Object.keys(response.data));
      return response.data;
    } catch (error: any) {
      console.error("Feature extraction error:", error);
      throw new Error(`Feature extraction failed: ${error?.message || error}`);
    }
  }

  /**
   * Extract JSON Schema from LaunchDarkly AI Config tools.
   *
   * LaunchDarkly AI Configs can include "tools" which define structured output schemas.
   * This function extracts the JSON schema from the first tool in the configuration,
   * which is then used with VercelProvider.invokeStructuredModel() to ensure the AI
   * returns data in the expected format.
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
   */
  async getAIConfig(
    configKey: string,
    context: ld.LDContext
  ): Promise<any | null> {
    try {
      // Ensure client is initialized before each flag evaluation
      await ensureInitialized();

      const config = await this.ldClient.jsonVariation(
        configKey,
        context,
        null
      );

      if (!config) {
        console.warn(`AI Config '${configKey}' not found`);
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
    // For custom contexts, attributes should be at the root level
    // The SDK will handle them correctly when evaluating rules
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
  // For custom contexts, attributes should be at the root level
  // The SDK will handle them correctly when evaluating rules
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
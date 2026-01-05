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
    initializationPromise = client.waitForInitialization().then(() => {
      // Convert to void promise
      return;
    });
  }

  await initializationPromise;
}

/**
 * Creates a Vercel AI model from LaunchDarkly configuration using dynamic imports.
 *
 * This function mimics VercelProvider.createVercelModel() but uses dynamic imports
 * in a way that Next.js can handle properly. The imports only happen at runtime,
 * not during the build phase.
 *
 * @param aiConfig - The AI configuration from LaunchDarkly containing provider and model info
 * @returns A LanguageModel instance from the appropriate @ai-sdk package
 */
async function createVercelModel(aiConfig: any): Promise<any> {
  const providerName = VercelProvider.mapProvider(
    aiConfig.provider?.name || aiConfig.model?.provider || ""
  );
  const modelName = aiConfig.model?.name;

  if (!modelName) {
    throw new Error("Model name is required in AI configuration");
  }

  console.log(`Creating model - Provider: ${providerName}, Model: ${modelName}`);

  switch (providerName.toLowerCase()) {
    case "openai":
      try {
        const { openai } = await import("@ai-sdk/openai");
        return openai(modelName);
      } catch (error) {
        throw new Error(`Failed to load OpenAI provider: ${error}`);
      }

    case "anthropic":
      try {
        const { anthropic } = await import("@ai-sdk/anthropic");
        return anthropic(modelName);
      } catch (error) {
        throw new Error(`Failed to load Anthropic provider: ${error}`);
      }

    case "google":
    case "gemini":
    case "google-vertex-ai":
      try {
        const { google } = await import("@ai-sdk/google");
        return google(modelName);
      } catch (error) {
        throw new Error(`Failed to load Google provider: ${error}`);
      }

    default:
      throw new Error(
        `Unsupported provider: ${providerName}. Supported: openai, anthropic, google`
      );
  }
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
    const { configKey, context, transcript, jsonSchema } = params;

    // Get the AI config from LaunchDarkly
    const aiConfig = await this.ldClient.jsonVariation(
      configKey,
      context,
      null
    );

    if (!aiConfig) {
      throw new Error(`AI Config '${configKey}' not found`);
    }

    console.log(`Using AI Config: ${configKey}`);

    try {
      // Create the Vercel model using dynamic imports
      const model = await createVercelModel(aiConfig);

      // Map parameters using VercelProvider's utility
      const parameters = VercelProvider.mapParameters(
        (aiConfig as any).model?.parameters || {}
      );

      // Create VercelProvider instance
      const provider = new VercelProvider(model, parameters);

      // Get messages from config
      const systemPrompt =
        (aiConfig as any).messages?.[0]?.content ||
        "Extract structured information from the provided transcript.";

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: `Transcript:\n\n${transcript}` },
      ];

      // Use invokeStructuredModel for structured output
      const response = await provider.invokeStructuredModel(
        messages,
        jsonSchema
      );

      console.log("Structured extraction successful");

      // Extract the value from the response
      // VercelProvider returns { value: {...}, metrics: {...} }
      return (response as any).value || response;
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
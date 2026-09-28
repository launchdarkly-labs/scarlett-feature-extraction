/**
 * LaunchDarkly AI SDK Implementation for Next.js
 *
 * Provides seamless integration between LaunchDarkly AI configs and Vercel AI Gateway.
 * Compatible with local development, Docker, and Vercel deployments.
 */

import * as ld from "@launchdarkly/node-server-sdk";
import { config as aiConfig, createHandler, initClient, inspectConfig, parseTemplate } from "@launchdarkly/ai-server";
import { generateObject, jsonSchema } from "ai";

/**
 * Map a LaunchDarkly provider name to a Vercel AI Gateway provider slug.
 *
 * Inlined from VercelProvider.mapProvider. There is no Vercel handler package
 * for the current AI SDK, and the old one pulls in the previous SDK, so the
 * two mappings it supplied live here now.
 */
function mapProvider(ldProviderName: string): string {
  const lowercased = ldProviderName.toLowerCase();
  return lowercased === "gemini" ? "google" : lowercased;
}

/**
 * Narrow a node-server-sdk context to the AI SDK's context type.
 *
 * node-server-sdk's LDContext still admits the legacy keyless LDUser shape,
 * while the AI SDK requires `kind`. Every context this module builds sets it,
 * so the narrowing is safe here even though the compiler cannot see it.
 */
function toAIContext(context: ld.LDContext): Parameters<typeof inspectConfig>[1] {
  return context as Parameters<typeof inspectConfig>[1];
}

/** Map LaunchDarkly model parameters to Vercel AI SDK parameters. */
function mapParameters(parameters: Record<string, any> | undefined): Record<string, any> {
  if (!parameters) return {};
  const mapping: Record<string, string> = {
    max_tokens: "maxTokens",
    max_completion_tokens: "maxOutputTokens",
    temperature: "temperature",
    top_p: "topP",
    top_k: "topK",
    presence_penalty: "presencePenalty",
    frequency_penalty: "frequencyPenalty",
    stop: "stopSequences",
    seed: "seed",
  };
  const params: Record<string, any> = {};
  for (const [from, to] of Object.entries(mapping)) {
    if (parameters[from] !== undefined) params[to] = parameters[from];
  }
  return params;
}
// Note: generateObject is imported but not currently used

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
      return;
    }).catch((err) => {
      throw err;
    });
  }

  await initializationPromise;
}

export class LaunchDarklyAIClient {
  private ldClient: ld.LDClient | null = null;
  private aiReady: Promise<boolean> | null = null;

  constructor() {
    // Don't initialize here - let it be lazy loaded
  }

  private ensureLDClient(): ld.LDClient {
    if (!this.ldClient) {
      this.ldClient = getLDClient();
      // Hand the client built here to the AI SDK rather than letting it
      // build its own, so both evaluate against the same one.
      this.aiReady = initClient(this.ldClient as unknown as Parameters<typeof initClient>[0]).then(() => true);
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

    try {
      await this.aiReady;

      // The model call runs inside a handler driven by invoke(), so the SDK
      // times it and emits duration, token, and success/error events. Nothing
      // was recorded before: invokeStructuredModel returned a metrics object
      // that no caller ever sent, so this app had no AI metrics at all.
      const handler = createHandler(
        ["vercel", "messages"],
        async (cfg: any, userInput, _toolHandlers, variables) => {
          // Tools carry the structured-output schema; LaunchDarkly serves them
          // under model.parameters.
          const tools = cfg.model?.parameters?.tools || [];
          if (!tools.length) {
            throw new Error("No tools found in AI config");
          }
          const schema = tools[0].parameters;

          const ldModelName = cfg.model?.name;
          if (!ldModelName) {
            throw new Error("Model name is required in AI configuration");
          }

          const providerName = mapProvider(cfg.provider?.name || "");
          const gatewayModelId = `${providerName}/${mapLDModelToVercel(ldModelName)}`;

          // On Vercel deployments, use AI_GATEWAY_API_KEY (VERCEL_OIDC_TOKEN is for Vercel services, not AI Gateway)
          // Locally, use either token
          const isVercelDeployment = process.env.VERCEL === "1";
          const apiKey = isVercelDeployment
            ? (process.env.AI_GATEWAY_API_KEY?.trim() || "")
            : (process.env.VERCEL_OIDC_TOKEN?.trim() || process.env.AI_GATEWAY_API_KEY?.trim() || "");

          if (!apiKey) {
            throw new Error("No Vercel AI Gateway API key found. Set AI_GATEWAY_API_KEY environment variable");
          }

          const { createOpenAI } = await import("@ai-sdk/openai");
          const vercelGateway = createOpenAI({
            baseURL: "https://ai-gateway.vercel.sh/v1",
            apiKey,
          });

          // Interpolation is the handler's job: invoke() forwards `variables`
          // but does not render them, and only the first-party handlers call
          // parseTemplate for you.
          const rawSystem = cfg.messages?.[0]?.content ||
            "Extract structured information from the provided transcript.";
          const systemPrompt = parseTemplate(rawSystem, variables ?? {});

          const result = await generateObject({
            ...mapParameters(cfg.model?.parameters),
            // Cast for the same reason the previous code did when building
            // VercelProvider: @ai-sdk/openai bundles its own @ai-sdk/provider,
            // so the two LanguageModelV2 types are structurally identical but
            // nominally different.
            model: vercelGateway.chat(gatewayModelId) as any,
            messages: [
              { role: "system" as const, content: systemPrompt },
              { role: "user" as const, content: userInput ?? "" },
            ],
            schema: jsonSchema(schema),
          });

          // Errors are no longer swallowed. invokeStructuredModel caught them
          // and returned an empty object with success:false, so a failed
          // extraction looked like an empty one.
          return {
            output: result.object,
            usage: {
              input_tokens: result.usage?.inputTokens ?? 0,
              output_tokens: result.usage?.outputTokens ?? 0,
            },
          };
        }
      );

      const response = await aiConfig({ key: configKey, handler }).invoke<any>(
        `Transcript:\n\n${transcript}`,
        toAIContext(context)
      );

      const result = response.response;

      return result;
    } catch (error: any) {
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
        return null;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get AI Config from LaunchDarkly
   * This uses inspectConfig, which reads without invoking a model
   */
  async getAIConfig(
    configKey: string,
    context: ld.LDContext
  ): Promise<any | null> {
    try {
      // Ensure client is initialized before each flag evaluation
      this.ensureLDClient();
      await ensureInitialized();

      await this.aiReady;

      // inspectConfig reads the variation without invoking a model or
      // emitting events, which is what this accessor wants. It never throws,
      // so a disabled config and an unreachable LaunchDarkly both arrive as
      // enabled:false rather than as an exception.
      const inspected = await inspectConfig(configKey, toAIContext(context));

      if (!inspected.enabled || !inspected.config) {
        return null;
      }

      return inspected.config;
    } catch (error) {
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

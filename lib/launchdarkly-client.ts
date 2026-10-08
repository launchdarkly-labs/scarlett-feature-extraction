/**
 * LaunchDarkly AI SDK Implementation for Next.js
 *
 * Provides seamless integration between LaunchDarkly AI configs and Vercel AI Gateway.
 * Compatible with local development, Docker, and Vercel deployments.
 */

import * as ld from "@launchdarkly/node-server-sdk";
import {
  config,
  createHandler,
  initClient,
  inspectConfig,
  parseTemplate,
} from "@launchdarkly/ai-server";
import type { AiConfigRep, LDContext } from "@launchdarkly/ai-server";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, jsonSchema, Output } from "ai";

/**
 * Map a LaunchDarkly provider name to a Vercel AI Gateway provider slug.
 *
 * Inlined from the old VercelProvider.mapProvider. The current AI SDK has no
 * Vercel handler package, so the one mapping it supplied lives here now.
 */
function mapProvider(ldProviderName: string): string {
  const lowercased = ldProviderName.toLowerCase();
  return lowercased === "gemini" ? "google" : lowercased;
}

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
    "claude-sonnet-4-5": "claude-sonnet-4.5",
    "claude-haiku-4-5": "claude-haiku-4.5",

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

/**
 * Resolve the Vercel AI Gateway credential for the current environment.
 *
 * On Vercel deployments only AI_GATEWAY_API_KEY works: VERCEL_OIDC_TOKEN
 * authenticates to Vercel platform services, not to the gateway. Locally,
 * `npx vercel env pull` writes VERCEL_OIDC_TOKEN and either is accepted.
 */
function gatewayApiKey(): string {
  const isVercelDeployment = process.env.VERCEL === "1";
  const apiKey = isVercelDeployment
    ? process.env.AI_GATEWAY_API_KEY?.trim()
    : process.env.VERCEL_OIDC_TOKEN?.trim() ||
      process.env.AI_GATEWAY_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "No Vercel AI Gateway API key found. Set AI_GATEWAY_API_KEY environment variable"
    );
  }

  return apiKey;
}

/**
 * Built on first use rather than at module load, so a missing gateway key
 * fails the request that needs it instead of the Next.js build that imports
 * this file.
 */
let gateway: ReturnType<typeof createOpenAI> | null = null;

function vercelGateway(): ReturnType<typeof createOpenAI> {
  if (!gateway) {
    gateway = createOpenAI({
      baseURL: "https://ai-gateway.vercel.sh/v1",
      apiKey: gatewayApiKey(),
    });
  }
  return gateway;
}

/** Map LaunchDarkly model parameters to Vercel AI SDK parameters. */
function mapParameters(
  parameters: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!parameters) return {};
  const mapping: Record<string, string> = {
    max_tokens: "maxOutputTokens",
    max_completion_tokens: "maxOutputTokens",
    temperature: "temperature",
    top_p: "topP",
    top_k: "topK",
    presence_penalty: "presencePenalty",
    frequency_penalty: "frequencyPenalty",
    stop: "stopSequences",
    seed: "seed",
  };
  const params: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(mapping)) {
    if (parameters[from] !== undefined) params[to] = parameters[from];
  }
  return params;
}

type Schema = Record<string, any>;

/**
 * Rewrite a JSON schema into the form structured-output strict mode accepts:
 * every property listed as required, optional ones made nullable, and no
 * additional properties. Without strict mode the model is free to skip
 * required fields or echo the schema back instead of filling it.
 */
function toStrictSchema(schema: Schema): Schema {
  if (schema.type === "array" && schema.items) {
    return { ...schema, items: toStrictSchema(schema.items) };
  }
  if (schema.type !== "object" || !schema.properties) {
    return schema;
  }
  const required = new Set<string>(schema.required ?? []);
  const properties: Schema = {};
  for (const [name, property] of Object.entries<Schema>(schema.properties)) {
    const strict = toStrictSchema(property);
    properties[name] = required.has(name)
      ? strict
      : { anyOf: [strict, { type: "null" }] };
  }
  return {
    ...schema,
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** Drop the nulls strict mode uses to stand in for omitted optional fields. */
function dropNulls(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== null)
  );
}

/**
 * A handler is the seam between LaunchDarkly and whatever actually calls the
 * model. The first argument says which configs it can serve: any provider, in
 * messages mode. The wildcard matters here because the config's provider is
 * whoever owns the model (openai, anthropic, google) - never "vercel" - and
 * the gateway fronts all of them with one OpenAI-shaped endpoint.
 */
const extractionHandler = createHandler(
  ["*", "messages"],
  async (aiConfig, transcript = "", _toolHandlers, variables = {}) => {
    // All six extraction tools share the core fields, so the first one's
    // parameters double as the output schema.
    const schema = Object.values(aiConfig.tools ?? {})[0]?.parameters;
    if (!schema) {
      throw new Error("No tools found in AI config");
    }

    const gatewayModelId = `${mapProvider(aiConfig.provider.name)}/${mapLDModelToVercel(
      aiConfig.model.name
    )}`;

    // invoke() forwards `variables` without substituting them, so a handler
    // you write yourself has to interpolate the prompt. Skip this and your
    // mustache placeholders reach the model verbatim.
    const system = (aiConfig.messages ?? [])
      .filter((message) => message.role === "system")
      .map((message) => parseTemplate(message.content, variables))
      .join("\n");

    const result = await generateText({
      ...mapParameters(aiConfig.model.parameters),
      model: vercelGateway().chat(gatewayModelId),
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: `Transcript:\n\n${transcript}` }],
      output: Output.object({ schema: jsonSchema(toStrictSchema(schema)) }),
    });

    // `total_tokens` is deliberately absent: the SDK derives the total from
    // input + output and ignores a provider-supplied one.
    return {
      output: dropNulls(result.output as Record<string, unknown>),
      usage: {
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
      },
    };
  }
);

// Singleton instances
let ldClientInstance: ld.LDClient | null = null;
let initializationPromise: Promise<void> | null = null;

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
    initializationPromise = client
      .waitForInitialization({ timeout: 5 })
      .then(() => undefined);
  }

  await initializationPromise;
}

/**
 * Narrow a node-server-sdk context to the AI SDK's context type.
 *
 * node-server-sdk's LDContext still admits the legacy keyless LDUser shape,
 * while the AI SDK requires `kind`. Every context this module builds sets it,
 * so the narrowing is safe here even though the compiler cannot see it.
 */
function toAIContext(context: ld.LDContext): LDContext {
  return context as LDContext;
}

export class LaunchDarklyAIClient {
  private ldClient: ld.LDClient | null = null;
  private aiReady: Promise<unknown> | null = null;

  constructor() {
    // Don't initialize here - let it be lazy loaded
  }

  private ensureLDClient(): ld.LDClient {
    if (!this.ldClient) {
      this.ldClient = getLDClient();
      // Hand the already-initialized client to the AI SDK. There is no
      // separate AI client object to keep: config() uses this one. The cast
      // covers return-type differences only: node-server-sdk's close()
      // returns void and flush() resolves to a boolean, where
      // LDClientInterface declares Promise<void> and void.
      this.aiReady = initClient(
        this.ldClient as unknown as Parameters<typeof initClient>[0]
      );
    }
    return this.ldClient;
  }

  async initialize(): Promise<void> {
    this.ensureLDClient();
    await ensureInitialized();
    await this.aiReady;
  }

  /**
   * Extract structured features from a transcript using the unified AI Config.
   *
   * One invoke() call evaluates the config, picks the model named in it, runs
   * the extraction through the handler, and records duration, tokens, and
   * success or error.
   */
  async extractStructuredFeatures(params: {
    configKey: string;
    context: ld.LDContext;
    transcript: string;
  }): Promise<Record<string, any>> {
    const { configKey, context, transcript } = params;

    // Ensure client is initialized before each flag evaluation
    this.ensureLDClient();
    await ensureInitialized();
    await this.aiReady;

    try {
      const result = await config({
        key: configKey,
        handler: extractionHandler,
      }).invoke<Record<string, any>>(transcript, toAIContext(context));

      return result.response;
    } catch (error: any) {
      throw new Error(`Feature extraction failed: ${error?.message || error}`);
    }
  }

  /**
   * Extract JSON Schema from LaunchDarkly AI Config tools.
   *
   * LaunchDarkly AI Configs can include "tools" which define structured output
   * schemas. This returns the schema from the first tool in the configuration.
   *
   * @param aiConfig - The AI configuration from LaunchDarkly
   * @returns The JSON schema from the first tool, or null if no tools are defined
   */
  async extractJSONSchemaFromTools(
    aiConfig: AiConfigRep | null
  ): Promise<Record<string, unknown> | null> {
    if (!aiConfig) {
      return null;
    }

    // Tools arrive as a keyed map on the config, not as an array under
    // model.parameters the way the previous SDK delivered them.
    return Object.values(aiConfig.tools ?? {})[0]?.parameters ?? null;
  }

  /**
   * Get AI Config from LaunchDarkly without invoking a model.
   *
   * inspectConfig never throws, so a disabled config and an unreachable
   * LaunchDarkly both arrive as enabled:false rather than as an exception. It
   * also emits no events, which is what this read-only accessor wants.
   */
  async getAIConfig(
    configKey: string,
    context: ld.LDContext
  ): Promise<AiConfigRep | null> {
    // Ensure client is initialized before each flag evaluation
    this.ensureLDClient();
    await ensureInitialized();
    await this.aiReady;

    const inspected = await inspectConfig(configKey, toAIContext(context));

    return inspected.enabled ? inspected.config : null;
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

  /** Send pending analytics events without closing the shared client. */
  async flush(): Promise<void> {
    await ldClientInstance?.flush();
  }

  /** For process shutdown. The next call after this builds and awaits a new client. */
  async close(): Promise<void> {
    if (ldClientInstance) {
      await ldClientInstance.close();
      ldClientInstance = null;
      initializationPromise = null;
    }
    this.ldClient = null;
    this.aiReady = null;
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
  aiConfig: AiConfigRep | null
): Promise<Record<string, unknown> | null> {
  return ldAIClient.extractJSONSchemaFromTools(aiConfig);
}

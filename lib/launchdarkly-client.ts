/**
 * LaunchDarkly AI Config Integration
 * Singleton client for optimal performance across requests
 */

import * as ld from "@launchdarkly/node-server-sdk";

export interface AIConfig {
  enabled: boolean;
  model: {
    name: string;
    parameters?: Record<string, any>;
  };
  messages?: Array<{
    role: string;
    content: string;
  }>;
  tools?: Array<{
    key?: string;
    version?: number;
    type?: string;
    function?: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }>;
}

// Singleton instance
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
    initializationPromise = client.waitForInitialization().then(() => undefined);
  }

  await initializationPromise;
}

export class LaunchDarklyAIConfigClient {
  private client: ld.LDClient;

  constructor() {
    this.client = getLDClient();
  }

  async waitForInitialization(): Promise<void> {
    await ensureInitialized();
  }

  async getAIConfig(
    configKey: string,
    context: ld.LDContext
  ): Promise<AIConfig | null> {
    try {
      const config = await this.client.jsonVariation(
        configKey,
        context,
        null
      );

      if (!config) {
        console.warn(`AI Config '${configKey}' not found`);
        return null;
      }

      return config as AIConfig;
    } catch (error) {
      console.error(`Failed to fetch AI Config '${configKey}':`, error);
      return null;
    }
  }

  // Don't close singleton client - it's reused across requests
  async close(): Promise<void> {
    // No-op for singleton pattern
  }
}

export async function extractJSONSchemaFromTools(
  aiConfig: AIConfig | null
): Promise<Record<string, any> | null> {
  if (!aiConfig) {
    return null;
  }

  // LaunchDarkly returns tools in model.parameters.tools
  const tools = (aiConfig as any).model?.parameters?.tools;

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

    // Tool is a reference {key, version} - this shouldn't happen
    if (tool.key && !tool.parameters) {
      console.error(`❌ ERROR: LaunchDarkly returned tool reference instead of full schema`);
      console.error(`Tool reference:`, tool);
      console.error(`This indicates a configuration issue. Tools should be fully embedded.`);
      return null;
    }

    return null;
  } catch (error) {
    console.error("Failed to extract JSON Schema from tools:", error);
    return null;
  }
}

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

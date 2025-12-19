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

  // Tools can be in two places:
  // 1. aiConfig.tools (expected structure)
  // 2. aiConfig.model.parameters.tools (actual LaunchDarkly structure)
  const tools = (aiConfig as any).model?.parameters?.tools || aiConfig.tools;

  console.log("Tools extracted:", tools ? `Found ${tools.length} tools` : "No tools");

  if (!tools || tools.length === 0) {
    console.log("No tools found in config");
    return null;
  }

  try {
    const tool = tools[0];
    console.log("Tool structure:", JSON.stringify(tool, null, 2));

    // Check if tool has the schema directly (LaunchDarkly structure)
    if (tool.parameters) {
      console.log("Returning schema from tool.parameters");
      return tool.parameters;
    }

    // Check if tool has the schema in function (expected structure)
    if (tool.function?.parameters) {
      return tool.function.parameters;
    }

    // Tool is a reference {key, version} - fetch the full tool from API
    if (tool.key) {
      console.log(`Fetching tool schema for: ${tool.key}`);
      const apiKey = process.env.LD_API_KEY;
      const projectKey = process.env.LD_PROJECT_KEY;

      if (!apiKey || !projectKey) {
        console.error("LD_API_KEY or LD_PROJECT_KEY not set - cannot fetch tool schema");
        return null;
      }

      const response = await fetch(
        `https://app.launchdarkly.com/api/v2/projects/${projectKey}/ai-tools/${tool.key}`,
        {
          headers: {
            "Authorization": apiKey,
            "LD-API-Version": "beta",
          },
        }
      );

      if (response.ok) {
        const toolData = await response.json();
        return toolData.schema;
      } else {
        console.error(`Failed to fetch tool ${tool.key}: ${response.statusText}`);
        return null;
      }
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

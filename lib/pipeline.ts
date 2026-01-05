/**
 * Two-Stage Transcript Extraction Pipeline using LaunchDarkly AI Configs
 *
 * This pipeline processes sales transcripts through two AI stages:
 *
 * Stage 1: Classification
 * - Uses the "transcript-classification" AI Config from LaunchDarkly
 * - Determines the call type (discovery, demo, negotiation, etc.)
 * - Routes to the appropriate extraction variation (A-F)
 *
 * Stage 2: Feature Extraction
 * - Uses the "sales-transcript-extraction" AI Config from LaunchDarkly
 * - Extracts structured data based on the call type
 * - Returns 60+ fields of structured information
 *
 * The implementation uses the official @launchdarkly/server-sdk-ai-vercel pattern
 * with Next.js-specific workarounds for bundling issues (see launchdarkly-client.ts)
 */

import {
  LaunchDarklyAIClient,
  createContext,
  extractJSONSchemaFromTools,
} from "./launchdarkly-client";
import { getVariationForCategory } from "./variation-mapping";

export interface TranscriptFile {
  name: string;
  content: string;
}

export interface ExtractionResult {
  filename: string;
  success: boolean;
  data?: Record<string, any>;
  error?: string;
  classification?: {
    category: string;
    variation: string;
  };
}

export interface ProgressUpdate {
  type: 'start' | 'classification' | 'extraction' | 'complete' | 'error';
  current: number;
  total: number;
  filename: string;
  message: string;
  percentage: number;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

export class TranscriptPipeline {
  private ldAIClient: LaunchDarklyAIClient;

  constructor() {
    this.ldAIClient = new LaunchDarklyAIClient();
  }

  async initialize(): Promise<void> {
    await this.ldAIClient.initialize();
  }

  async processTranscript(
    transcriptFile: TranscriptFile,
    transcriptId: string,
    onProgress?: ProgressCallback,
    current?: number,
    total?: number
  ): Promise<ExtractionResult> {
    try {
      // Validate file has sufficient content for analysis
      if (!transcriptFile.content || transcriptFile.content.trim().length === 0) {
        throw new Error("File is empty or contains no text");
      }
      if (transcriptFile.content.trim().length < 50) {
        throw new Error("File content too short for analysis (minimum 50 characters)");
      }

      // STAGE 1: CLASSIFICATION
      if (onProgress && current !== undefined && total !== undefined) {
        onProgress({
          type: 'classification',
          current,
          total,
          filename: transcriptFile.name,
          message: `Classifying ${transcriptFile.name}...`,
          percentage: Math.round(((current - 1) / total) * 100)
        });
      }

      const classificationContext = createContext(transcriptId, "transcript");

      // Get classification config
      const classificationConfig = await this.ldAIClient.getAIConfig(
        "transcript-classification",
        classificationContext
      );

      if (!classificationConfig) {
        throw new Error("Classification config not found");
      }

      // Extract schema for classification
      const classificationSchema = await extractJSONSchemaFromTools(
        classificationConfig
      );

      if (!classificationSchema) {
        throw new Error("Classification schema not found in tools");
      }

      // TEST: Log which prompt source is being used
      console.log("📝 Classification prompt source:",
        classificationConfig.messages?.[0]?.content ? "LaunchDarkly" : "DEFAULT (ERROR!)");

      // Extract classification features
      const classification = await this.ldAIClient.extractStructuredFeatures({
        configKey: "transcript-classification",
        context: classificationContext,
        transcript: transcriptFile.content,
        jsonSchema: classificationSchema,
      });

      console.log("Classification result:", JSON.stringify(classification, null, 2));

      // Validate classification returned structured data
      if (!classification || typeof classification !== 'object') {
        throw new Error("Classification failed to return valid response");
      }

      // Determine which extraction variation (A-F) to use
      const primaryVariation =
        classification.primary_variation ||
        getVariationForCategory(classification.call_category);

      if (!primaryVariation) {
        console.warn("⚠️  No variation could be determined from classification, defaulting to 'B'");
      }

      const finalVariation = primaryVariation || "B"; // Default to Variation B (Discovery)
      console.log("Primary variation determined:", finalVariation);

      // STAGE 2: FEATURE EXTRACTION
      if (onProgress && current !== undefined && total !== undefined) {
        onProgress({
          type: 'extraction',
          current,
          total,
          filename: transcriptFile.name,
          message: `Extracting features from ${transcriptFile.name}...`,
          percentage: Math.round(((current - 0.5) / total) * 100)
        });
      }

      const extractionContext = createContext(transcriptId, "transcript", {
        variation_hint: finalVariation,
        call_category: classification.call_category,
        customer_segment: classification.customer_segment,
      });

      console.log("Extraction context:", JSON.stringify(extractionContext, null, 2));

      // Get extraction config
      const extractionConfig = await this.ldAIClient.getAIConfig(
        "sales-transcript-extraction",
        extractionContext
      );

      if (!extractionConfig) {
        throw new Error("Extraction config not found");
      }

      // Extract schema for extraction
      const extractionSchema = await extractJSONSchemaFromTools(extractionConfig);
      if (!extractionSchema) {
        throw new Error("Extraction schema not found in tools");
      }

      // TEST: Log which prompt source is being used
      console.log("📝 Extraction prompt source:",
        extractionConfig.messages?.[0]?.content ? "LaunchDarkly" : "DEFAULT (ERROR!)");

      // Extract features
      const features = await this.ldAIClient.extractStructuredFeatures({
        configKey: "sales-transcript-extraction",
        context: extractionContext,
        transcript: transcriptFile.content,
        jsonSchema: extractionSchema,
      });

      // Get model names from configs
      // With completionConfig(), the model is at the top level
      const classificationModel = classificationConfig.model?.name || "unknown";
      const extractionModel = extractionConfig.model?.name || "unknown";

      // Combine extracted features with metadata
      const result = {
        source_file: transcriptFile.name,
        ...features,
        transcript_id: transcriptId,
        variation_used: primaryVariation,
        classification_model_used: classificationModel,
        extraction_model_used: extractionModel,
        extraction_timestamp: new Date().toISOString(),
      };

      return {
        filename: transcriptFile.name,
        success: true,
        data: result,
        classification: {
          category: classification.call_category,
          variation: finalVariation,
        },
      };
    } catch (error) {
      // Translate technical errors into user-friendly messages
      let errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
        errorMessage = "Request timed out - file may be too large or service unavailable";
      } else if (errorMessage.includes("network") || errorMessage.includes("ECONNREFUSED")) {
        errorMessage = "Network error - please check your connection";
      } else if (errorMessage.includes("API key") || errorMessage.includes("unauthorized")) {
        errorMessage = "Authentication error - please check API credentials";
      }

      return {
        filename: transcriptFile.name,
        success: false,
        error: errorMessage,
      };
    }
  }

  async processMultiple(
    transcripts: TranscriptFile[],
    onProgress?: ProgressCallback
  ): Promise<ExtractionResult[]> {
    const results: ExtractionResult[] = [];

    for (let i = 0; i < transcripts.length; i++) {
      const transcript = transcripts[i];
      const transcriptId = `transcript_${i + 1}`;

      console.log(`[${i + 1}/${transcripts.length}] Processing ${transcript.name}...`);

      if (onProgress) {
        onProgress({
          type: 'start',
          current: i + 1,
          total: transcripts.length,
          filename: transcript.name,
          message: `Starting ${transcript.name}...`,
          percentage: Math.round((i / transcripts.length) * 100)
        });
      }

      const result = await this.processTranscript(
        transcript,
        transcriptId,
        onProgress,
        i + 1,
        transcripts.length
      );
      results.push(result);

      if (result.success) {
        console.log(`  ✓ Success - Variation ${result.classification?.variation}`);
        if (onProgress) {
          onProgress({
            type: 'complete',
            current: i + 1,
            total: transcripts.length,
            filename: transcript.name,
            message: `Completed ${transcript.name}`,
            percentage: Math.round(((i + 1) / transcripts.length) * 100)
          });
        }
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
        if (onProgress) {
          onProgress({
            type: 'error',
            current: i + 1,
            total: transcripts.length,
            filename: transcript.name,
            message: `Failed: ${result.error}`,
            percentage: Math.round(((i + 1) / transcripts.length) * 100)
          });
        }
      }
    }

    return results;
  }

  async close(): Promise<void> {
    await this.ldAIClient.close();
  }
}
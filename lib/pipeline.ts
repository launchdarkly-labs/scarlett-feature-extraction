/**
 * Two-Stage Transcript Extraction Pipeline
 *
 * Stage 1: Classification - Determines call type and routes to appropriate variation (A-F)
 * Stage 2: Feature Extraction - Extracts structured data based on call type
 *
 * Supports optional progress callbacks for real-time status updates via SSE.
 */

import {
  LaunchDarklyAIConfigClient,
  createContext,
  extractJSONSchemaFromTools,
} from "./launchdarkly-client";
import { VercelAIClient, mapLDToVercelModel } from "./vercel-client";
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
  private ldClient: LaunchDarklyAIConfigClient;
  private vercelClient: VercelAIClient;

  constructor() {
    this.ldClient = new LaunchDarklyAIConfigClient();
    this.vercelClient = new VercelAIClient();
  }

  async initialize(): Promise<void> {
    await this.ldClient.waitForInitialization();
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
      const classificationConfig = await this.ldClient.getAIConfig(
        "transcript-classification",
        classificationContext
      );

      if (!classificationConfig) {
        throw new Error("Classification config not found");
      }

      const classificationSchema = await extractJSONSchemaFromTools(
        classificationConfig
      );
      if (!classificationSchema) {
        throw new Error("Classification schema not found in tools");
      }

      if (!classificationConfig.model || !classificationConfig.model.name) {
        throw new Error(`Classification config missing model information. Config: ${JSON.stringify(classificationConfig)}`);
      }

      const classificationModel = mapLDToVercelModel(
        classificationConfig.model.name
      );
      const classificationPrompt =
        classificationConfig.messages?.[0]?.content ||
        this.vercelClient.getDefaultExtractionPrompt();

      const classification = await this.vercelClient.extractFeatures({
        transcript: transcriptFile.content,
        model: classificationModel,
        systemPrompt: classificationPrompt,
        temperature: classificationConfig.model.parameters?.temperature || 0,
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

      const extractionConfig = await this.ldClient.getAIConfig(
        "sales-transcript-extraction",
        extractionContext
      );

      if (!extractionConfig) {
        throw new Error("Extraction config not found");
      }

      console.log("Extraction config received:", JSON.stringify(extractionConfig, null, 2));

      const extractionSchema = await extractJSONSchemaFromTools(extractionConfig);
      if (!extractionSchema) {
        throw new Error("Extraction schema not found in tools");
      }

      if (!extractionConfig.model || !extractionConfig.model.name) {
        throw new Error(`Extraction config missing model information. Config: ${JSON.stringify(extractionConfig)}`);
      }

      const extractionModel = mapLDToVercelModel(extractionConfig.model.name);
      const extractionPrompt =
        extractionConfig.messages?.[0]?.content ||
        this.vercelClient.getDefaultExtractionPrompt();

      const features = await this.vercelClient.extractFeatures({
        transcript: transcriptFile.content,
        model: extractionModel,
        systemPrompt: extractionPrompt,
        temperature: extractionConfig.model.parameters?.temperature || 0,
        jsonSchema: extractionSchema,
      });

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
    await this.ldClient.close();
  }
}

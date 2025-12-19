/**
 * Two-Stage Transcript Extraction Pipeline
 * Stage 1: Classification → Stage 2: Feature Extraction
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
    transcriptId: string
  ): Promise<ExtractionResult> {
    try {
      // STAGE 1: CLASSIFICATION
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

      // Validate classification response
      if (!classification || typeof classification !== 'object') {
        throw new Error("Classification failed to return valid response");
      }

      // Determine variation from classification
      const primaryVariation =
        classification.primary_variation ||
        getVariationForCategory(classification.call_category);

      if (!primaryVariation) {
        console.warn("⚠️  No variation could be determined from classification, defaulting to 'B'");
      }

      const finalVariation = primaryVariation || "B"; // Default to B (Discovery) if no variation found
      console.log("Primary variation determined:", finalVariation);

      // STAGE 2: FEATURE EXTRACTION
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

      // Add metadata
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
      return {
        filename: transcriptFile.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async processMultiple(
    transcripts: TranscriptFile[]
  ): Promise<ExtractionResult[]> {
    const results: ExtractionResult[] = [];

    for (let i = 0; i < transcripts.length; i++) {
      const transcript = transcripts[i];
      const transcriptId = `transcript_${i + 1}`;

      console.log(`[${i + 1}/${transcripts.length}] Processing ${transcript.name}...`);

      const result = await this.processTranscript(transcript, transcriptId);
      results.push(result);

      if (result.success) {
        console.log(`  ✓ Success - Variation ${result.classification?.variation}`);
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
      }
    }

    return results;
  }

  async close(): Promise<void> {
    await this.ldClient.close();
  }
}

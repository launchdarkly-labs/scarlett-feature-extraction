/**
 * Single-Stage Transcript Extraction Pipeline using LaunchDarkly AI Configs
 *
 * This pipeline processes sales transcripts through one unified AI stage:
 * - Uses the "transcript-extraction-unified" AI Config from LaunchDarkly
 * - AI automatically selects the appropriate extraction tool (A-F) based on call type
 * - Extracts structured data in a single LLM call
 * - Returns 40-65 fields depending on which tool was selected
 *
 * The implementation uses the official @launchdarkly/server-sdk-ai-vercel pattern
 */

import {
  LaunchDarklyAIClient,
  createContext,
} from "./launchdarkly-client";

export interface TranscriptFile {
  name: string;
  content: string;
}

export interface ExtractionResult {
  filename: string;
  success: boolean;
  data?: Record<string, any>;
  error?: string;
}

export interface ProgressUpdate {
  type: 'start' | 'extraction' | 'complete' | 'error';
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

      // The AI will automatically select the appropriate extraction tool (A-F) based on content
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

      const extractionContext = createContext(transcriptId, "transcript");


      // Extract features using unified config
      const features = await this.ldAIClient.extractStructuredFeatures({
        configKey: "transcript-extraction-unified",
        context: extractionContext,
        transcript: transcriptFile.content,
      });


      // Infer which tool type was most appropriate based on call_category
      // Normalize: lowercase and replace spaces with underscores
      const callCategory = (features.call_category || 'unknown')
        .toLowerCase()
        .replace(/\s+/g, '_');

      const toolMapping: Record<string, string> = {
        'prospecting': 'extract_prospecting_features',
        'discovery': 'extract_discovery_features',
        'qualification': 'extract_discovery_features',
        'demo': 'extract_demo_features',
        'product_demo': 'extract_demo_features',
        'proposal': 'extract_proposal_features',
        'negotiation': 'extract_proposal_features',
        'technical': 'extract_technical_features',
        'customer_success': 'extract_customer_success_features',
        'renewal': 'extract_customer_success_features',
      };
      const toolUsed = toolMapping[callCategory] || 'unknown';

      // Remove variation_used field (legacy from old approach)
      const { variation_used, ...cleanFeatures } = features;

      // Combine extracted features with metadata
      const result = {
        source_file: transcriptFile.name,
        tool_used: toolUsed,
        ...cleanFeatures,
        transcript_id: transcriptId,
        extraction_timestamp: new Date().toISOString(),
      };

      return {
        filename: transcriptFile.name,
        success: true,
        data: result,
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

      if (result.success && onProgress) {
        onProgress({
          type: 'complete',
          current: i + 1,
          total: transcripts.length,
          filename: transcript.name,
          message: `Completed ${transcript.name}`,
          percentage: Math.round(((i + 1) / transcripts.length) * 100)
        });
      } else if (!result.success && onProgress) {
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

    return results;
  }

  async close(): Promise<void> {
    await this.ldAIClient.close();
  }
}
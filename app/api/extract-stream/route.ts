/**
 * Streaming Extraction Endpoint with Real-Time Progress
 *
 * Processes transcript files and streams progress updates via Server-Sent Events (SSE).
 *
 * Progress event types:
 * - start: File processing begins
 * - extraction: AI extraction stage (unified - AI selects appropriate tool)
 * - complete: File successfully processed
 * - error: Individual file error (processing continues)
 * - done: All files processed, CSV ready for download
 */

import { NextRequest } from "next/server";
import { TranscriptPipeline, ProgressUpdate } from "@/lib/pipeline";
import Papa from "papaparse";

export const maxDuration = 300; // 5 minutes max for processing

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const formData = await request.formData();
        const files = formData.getAll("files") as File[];

        if (files.length === 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: 'No files uploaded'
          })}\n\n`));
          controller.close();
          return;
        }

        // Read all transcript files
        const transcripts = await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            content: await file.text(),
          }))
        );

        // Initialize pipeline
        const pipeline = new TranscriptPipeline();
        await pipeline.initialize();

        // Process with real-time progress updates sent via SSE
        const results = await pipeline.processMultiple(
          transcripts,
          (update: ProgressUpdate) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(update)}\n\n`)
            );
          }
        );

        await pipeline.close();

        // Generate CSV from successful results only
        const successfulResults = results
          .filter((r) => r.success && r.data)
          .map((r) => r.data!);

        if (successfulResults.length === 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: 'No transcripts were successfully processed',
            results
          })}\n\n`));
          controller.close();
          return;
        }

        const csv = Papa.unparse(successfulResults);

        // Send final event with CSV data and completion metadata
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'done',
          csv: csv,
          filename: `extracted_${Date.now()}.csv`,
          successCount: successfulResults.length,
          totalCount: files.length
        })}\n\n`));

        controller.close();
      } catch (error) {
        console.error("Extraction error:", error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Processing failed'
        })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

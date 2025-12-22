/**
 * Legacy Non-Streaming Extraction Endpoint
 *
 * This endpoint processes transcripts without real-time progress updates.
 * For progress tracking, use /api/extract-stream instead (recommended).
 *
 * This endpoint is kept for:
 * - Backwards compatibility
 * - Testing without SSE
 * - Clients that don't support Server-Sent Events
 */

import { NextRequest, NextResponse } from "next/server";
import { TranscriptPipeline } from "@/lib/pipeline";
import Papa from "papaparse";

export const maxDuration = 300; // 5 minutes max for processing

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files uploaded" },
        { status: 400 }
      );
    }

    // Read all transcript files
    const transcripts = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        content: await file.text(),
      }))
    );

    // Initialize pipeline and process without progress callbacks
    const pipeline = new TranscriptPipeline();
    await pipeline.initialize();

    const results = await pipeline.processMultiple(transcripts);

    await pipeline.close();

    // Convert to CSV
    const successfulResults = results
      .filter((r) => r.success && r.data)
      .map((r) => r.data!);

    if (successfulResults.length === 0) {
      return NextResponse.json(
        { error: "No transcripts were successfully processed", results },
        { status: 400 }
      );
    }

    const csv = Papa.unparse(successfulResults);

    // Return CSV file
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="extracted_${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    console.error("Extraction error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}

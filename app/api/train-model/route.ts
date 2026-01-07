/**
 * API Route: Train ML Model
 *
 * Trains the two-stage deal prediction model and returns metrics.
 * Can use either demo data or a provided CSV file.
 */

import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import { tmpdir } from "os";

const execPromise = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const useDemo = formData.get("useDemo") === "true";
    const csvFile = formData.get("csvFile") as File | null;

    let command: string;
    let tempFilePath: string | null = null;

    if (useDemo) {
      // Use demo synthetic data
      command = "source venv/bin/activate && python ml/train_and_return_metrics.py --demo --samples 500";
    } else if (csvFile) {
      // Save uploaded CSV to temp file
      const bytes = await csvFile.arrayBuffer();
      const buffer = Buffer.from(bytes);

      tempFilePath = path.join(tmpdir(), `training_data_${Date.now()}.csv`);
      await writeFile(tempFilePath, buffer);

      command = `source venv/bin/activate && python ml/train_and_return_metrics.py --csv "${tempFilePath}"`;
    } else {
      return NextResponse.json(
        { error: "Either useDemo=true or csvFile must be provided" },
        { status: 400 }
      );
    }


    // Execute Python script with bash shell
    const { stdout, stderr } = await execPromise(command, {
      cwd: process.cwd(),
      timeout: 120000, // 2 minute timeout
      shell: "/bin/bash",
    });

    // Clean up temp file if created
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (err) {
        // Ignore temp file deletion errors
      }
    }

    if (stderr && stderr.includes("error")) {
      throw new Error(stderr);
    }

    // Parse JSON output from Python script
    const metrics = JSON.parse(stdout);

    if (!metrics.success) {
      throw new Error(metrics.error || "Model training failed");
    }

    return NextResponse.json(metrics);
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to train model",
      },
      { status: 500 }
    );
  }
}

// Note: bodyParser is disabled by default in App Router
// No config export needed

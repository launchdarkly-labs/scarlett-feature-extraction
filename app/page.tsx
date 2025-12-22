"use client";

import { useState } from "react";

interface ProgressState {
  percentage: number;
  message: string;
  current: number;
  total: number;
  filename: string;
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progressState, setProgressState] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string>("");
  const [downloadFilename, setDownloadFilename] = useState<string>("");

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      // Filter: only .txt and .md files, excluding system files
      const validFiles = Array.from(e.target.files).filter((file) => {
        const name = file.name.toLowerCase();
        const isSystemFile = name.startsWith('.') || name === 'desktop.ini' || name === 'thumbs.db';
        const isValidExtension = name.endsWith('.txt') || name.endsWith('.md');
        return !isSystemFile && isValidExtension;
      });

      setFiles(validFiles);
      setError("");

      if (validFiles.length === 0 && e.target.files.length > 0) {
        setError("No valid .txt or .md files found. System files were filtered out.");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (files.length === 0) {
      setError("Please select at least one transcript file");
      return;
    }

    setProcessing(true);
    setProgressState({
      percentage: 0,
      message: "Starting processing...",
      current: 0,
      total: files.length,
      filename: ""
    });
    setError("");

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const response = await fetch("/api/extract-stream", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Processing failed");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("Failed to get response reader");
      }

      let csvData = "";
      let csvFilename = "";

      // Read SSE stream until complete
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.substring(6));

            // Fatal error (no files uploaded, stream failure) - stop processing
            if (data.type === "error" && !data.current) {
              throw new Error(data.message);
            }
            // Individual file error - display warning but continue batch processing
            else if (data.type === "error") {
              setProgressState({
                percentage: data.percentage,
                message: `⚠️ ${data.message}`,
                current: data.current,
                total: data.total,
                filename: data.filename
              });
            } else if (data.type === "done") {
              csvData = data.csv;
              csvFilename = data.filename;
              setProgressState({
                percentage: 100,
                message: `✓ Successfully processed ${data.successCount}/${data.totalCount} transcript(s)`,
                current: data.totalCount,
                total: data.totalCount,
                filename: ""
              });
            } else if (data.type) {
              // Progress update (start, classification, extraction, complete)
              setProgressState({
                percentage: data.percentage,
                message: data.message,
                current: data.current,
                total: data.total,
                filename: data.filename
              });
            }
          }
        }
      }

      // Trigger CSV download with custom or generated filename
      if (csvData) {
        const blob = new Blob([csvData], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = downloadFilename || csvFilename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }

      // Reset UI after brief delay to show completion state
      setTimeout(() => {
        setFiles([]);
        setProgressState(null);
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setProgressState(null);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Sales Transcript Extractor
        </h1>
        <p className="text-gray-600 mb-8">
          Upload sales call transcripts to extract structured data using AI
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <input
              type="file"
              accept=".txt,.md"
              multiple
              // @ts-ignore - webkitdirectory is not in TypeScript types yet
              webkitdirectory=""
              onChange={handleFileSelect}
              className="hidden"
              id="file-input"
              disabled={processing}
            />
            <label
              htmlFor="file-input"
              className="cursor-pointer text-gray-600 hover:text-gray-900"
            >
              <div className="mb-3">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  stroke="currentColor"
                  fill="none"
                  viewBox="0 0 48 48"
                  aria-hidden="true"
                >
                  <path
                    d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium">
                Click to select a folder
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Navigate into the folder, then click "Upload" or "Open"
              </p>
              <p className="text-xs text-gray-400 mt-1">
                All .txt and .md files will be processed
              </p>
            </label>
          </div>

          {files.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-900 mb-2">
                Selected files ({files.length}):
              </p>
              <ul className="text-sm text-gray-600 space-y-1 max-h-40 overflow-y-auto">
                {files.map((file, i) => (
                  <li key={i} className="truncate">
                    📄 {file.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {files.length > 0 && !processing && (
            <div className="space-y-2">
              <label htmlFor="filename" className="block text-sm font-medium text-gray-700">
                Output filename (optional)
              </label>
              <input
                type="text"
                id="filename"
                value={downloadFilename}
                onChange={(e) => setDownloadFilename(e.target.value)}
                placeholder="extracted_results.csv"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
              />
              <p className="text-xs text-gray-500">
                Files will be downloaded to your browser's default download location
              </p>
            </div>
          )}

          {progressState && (
            <div className="space-y-3">
              <div className={`${progressState.message.startsWith('⚠️') ? 'bg-yellow-50 border-yellow-200' : 'bg-blue-50 border-blue-200'} border rounded-lg p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-sm font-medium ${progressState.message.startsWith('⚠️') ? 'text-yellow-900' : 'text-blue-900'}`}>
                    {progressState.message}
                  </p>
                  <span className={`text-sm font-bold ${progressState.message.startsWith('⚠️') ? 'text-yellow-900' : 'text-blue-900'}`}>
                    {progressState.percentage}%
                  </span>
                </div>
                <div className={`w-full ${progressState.message.startsWith('⚠️') ? 'bg-yellow-200' : 'bg-blue-200'} rounded-full h-3 overflow-hidden`}>
                  <div
                    className={`${progressState.message.startsWith('⚠️') ? 'bg-yellow-600' : 'bg-blue-600'} h-full transition-all duration-300 ease-out rounded-full`}
                    style={{ width: `${progressState.percentage}%` }}
                  />
                </div>
                {progressState.filename && (
                  <p className={`text-xs ${progressState.message.startsWith('⚠️') ? 'text-yellow-700' : 'text-blue-700'} mt-2`}>
                    Processing: {progressState.filename}
                  </p>
                )}
                <p className={`text-xs ${progressState.message.startsWith('⚠️') ? 'text-yellow-700' : 'text-blue-700'} mt-1`}>
                  File {progressState.current} of {progressState.total}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={files.length === 0 || processing}
            className="w-full bg-black text-white rounded-lg px-6 py-3 font-medium hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {processing ? "Processing..." : "Extract Features"}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            Powered by Vercel AI Gateway + LaunchDarkly AI Configs
          </p>
        </div>
      </div>
    </div>
  );
}

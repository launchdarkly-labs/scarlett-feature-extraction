"use client";

import { useState } from "react";

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string>("");

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      // Filter out system files and non-text files
      const validFiles = Array.from(e.target.files).filter((file) => {
        const name = file.name.toLowerCase();
        // Exclude system files
        if (name.startsWith('.') || name === 'desktop.ini' || name === 'thumbs.db') {
          return false;
        }
        // Only include .txt and .md files
        return name.endsWith('.txt') || name.endsWith('.md');
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
    setProgress(`Processing ${files.length} transcript(s)...`);
    setError("");

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Processing failed");
      }

      // Download CSV
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `extracted_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setProgress(`✓ Successfully processed ${files.length} transcript(s)`);
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
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
                All .txt and .md files will be processed
              </p>
            </label>
          </div>

          {files.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-900 mb-2">
                Selected files ({files.length}):
              </p>
              <ul className="text-sm text-gray-600 space-y-1">
                {files.map((file, i) => (
                  <li key={i} className="truncate">
                    📄 {file.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {progress && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">{progress}</p>
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

"use client";

import { useState } from "react";

interface ProgressState {
  percentage: number;
  message: string;
  current: number;
  total: number;
  filename: string;
}

interface ExtractionStats {
  total_calls: number;
  call_categories: Record<string, number>;
  avg_sentiment: number;
  avg_engagement: number;
  avg_urgency: number;
  next_steps_defined_pct: number;
  competitors_mentioned_pct: number;
  avg_word_count: number;
  avg_questions: number;
}

interface ModelMetrics {
  data_stats: {
    total_samples: number;
    train_samples: number;
    test_samples: number;
    close_rate_actual: number;
    total_actual_value: number;
    avg_deal_value: number;
  };
  classification_metrics: {
    roc_auc: number;
    pr_auc: number;
    f2_score: number;
    close_rate_predicted: number;
  };
  regression_metrics: {
    rmse_closed: number;
    mae_closed: number;
    r2_closed: number;
  };
  business_metrics: {
    total_predicted_value: number;
    value_error_pct: number;
    rmse_overall: number;
    mae_overall: number;
  };
  feature_importance: {
    classifier: Array<{ feature: string; importance: number }>;
    regressor: Array<{ feature: string; importance: number }>;
  };
  roc_curve: {
    fpr: number[];
    tpr: number[];
  };
  sample_predictions: Array<{
    deal_num: number;
    p_close: number;
    value_if_closed: number;
    expected_value: number;
    actual_closed: boolean;
    actual_value: number;
  }>;
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progressState, setProgressState] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string>("");
  const [downloadFilename, setDownloadFilename] = useState<string>("");
  const [trainingModel, setTrainingModel] = useState(false);
  const [modelMetrics, setModelMetrics] = useState<ModelMetrics | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [extractionStats, setExtractionStats] = useState<ExtractionStats | null>(null);
  const [trainingFile, setTrainingFile] = useState<File | null>(null);
  const [useDemo, setUseDemo] = useState(false);
  const [trainTestSplit, setTrainTestSplit] = useState(80);
  const [minSamplesForTraining, setMinSamplesForTraining] = useState(100);

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
    setExtractionStats(null);  // Clear any previous stats when starting new extraction

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
              // Progress update (start, extraction, complete)
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

      // Calculate extraction stats from CSV
      if (csvData) {
        const rows = csvData.split('\n').filter(row => row.trim());
        const headers = rows[0].split(',');
        const dataRows = rows.slice(1);

        // Parse CSV and calculate stats
        const parsedData = dataRows.map(row => {
          const values = row.split(',');
          return headers.reduce((obj, header, i) => {
            obj[header.trim()] = values[i]?.trim() || '';
            return obj;
          }, {} as Record<string, string>);
        });

        // Calculate statistics
        const callCategories: Record<string, number> = {};
        let totalSentiment = 0;
        let totalEngagement = 0;
        let totalUrgency = 0;
        let nextStepsDefined = 0;
        let competitorsMentioned = 0;
        let totalWordCount = 0;
        let totalQuestions = 0;

        parsedData.forEach(row => {
          const category = row['call_category'] || 'unknown';
          callCategories[category] = (callCategories[category] || 0) + 1;

          totalSentiment += parseFloat(row['overall_sentiment_score'] || '0');
          totalEngagement += parseFloat(row['customer_engagement_score'] || '0');
          totalUrgency += parseFloat(row['urgency_score'] || '0');

          // Handle boolean values - they come as 'true'/'false' strings from CSV
          nextStepsDefined += row['next_steps_defined'] === 'true' ? 1 : 0;
          competitorsMentioned += row['competitors_mentioned'] === 'true' ? 1 : 0;
          // Handle different possible field names for word count
          const wordCount = row['transcript_word_count'] || row['text_word_count'] || row['word_count'];
          totalWordCount += parseInt(wordCount || '0');

          // Handle question count field - it can be empty string in CSV
          const questionCount = row['customer_question_count'] || row['question_count'] || '0';
          totalQuestions += parseInt(questionCount) || 0;

        });

        const totalCalls = parsedData.length;
        setExtractionStats({
          total_calls: totalCalls,
          call_categories: callCategories,
          avg_sentiment: totalSentiment / totalCalls,
          avg_engagement: totalEngagement / totalCalls,
          avg_urgency: totalUrgency / totalCalls,
          next_steps_defined_pct: (nextStepsDefined / totalCalls) * 100,
          competitors_mentioned_pct: (competitorsMentioned / totalCalls) * 100,
          avg_word_count: totalWordCount / totalCalls,
          avg_questions: totalQuestions / totalCalls
        });

        // Trigger CSV download with custom or generated filename
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
        // Don't clear stats here - let user dismiss manually
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setProgressState(null);
    } finally {
      setProcessing(false);
    }
  };

  const handleTrainModel = async () => {
    if (!useDemo && !trainingFile) {
      setError("Please select a CSV file or enable demo mode");
      return;
    }

    setTrainingModel(true);
    setError("");
    setModelMetrics(null);

    try {
      const formData = new FormData();

      if (useDemo) {
        formData.append("useDemo", "true");
      } else if (trainingFile) {
        formData.append("csvFile", trainingFile);
        formData.append("trainTestSplit", trainTestSplit.toString());
        formData.append("minSamples", minSamplesForTraining.toString());
      }

      const response = await fetch("/api/train-model", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Model training failed");
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Model training failed");
      }

      setModelMetrics(result);
      setShowMetrics(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to train model");
    } finally {
      setTrainingModel(false);
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

        {extractionStats && extractionStats.total_calls > 0 && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                📊 Extraction Results
              </h3>
              <button
                onClick={() => setExtractionStats(null)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Hide
              </button>
            </div>

            {/* Hero Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
                <div className="text-sm text-gray-600 mb-1">Total Calls</div>
                <div className="text-3xl font-bold text-blue-600">{extractionStats.total_calls}</div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
                <div className="text-sm text-gray-600 mb-1">Avg Sentiment</div>
                <div className="text-3xl font-bold text-green-600">
                  {extractionStats.avg_sentiment >= 0 ? '+' : ''}{(extractionStats.avg_sentiment * 100).toFixed(0)}%
                </div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-4 border border-purple-200">
                <div className="text-sm text-gray-600 mb-1">Avg Engagement</div>
                <div className="text-3xl font-bold text-purple-600">{(extractionStats.avg_engagement * 100).toFixed(0)}%</div>
              </div>
            </div>

            {/* Call Categories Distribution */}
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Call Type Distribution</h4>
              <div className="space-y-2">
                {Object.entries(extractionStats.call_categories).map(([category, count]) => {
                  const percentage = (count / extractionStats.total_calls) * 100;
                  return (
                    <div key={category} className="flex items-center">
                      <div className="w-32 text-sm text-gray-600 capitalize">{category.replace(/_/g, ' ')}</div>
                      <div className="flex-1 mx-3">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                      <div className="w-16 text-right text-sm font-medium text-gray-700">
                        {count} ({percentage.toFixed(0)}%)
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Key Metrics */}
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Key Insights</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Next Steps Defined:</span>
                  <span className="font-semibold text-gray-900">{extractionStats.next_steps_defined_pct.toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Competitors Mentioned:</span>
                  <span className="font-semibold text-gray-900">{extractionStats.competitors_mentioned_pct.toFixed(0)}%</span>
                </div>
                {extractionStats.avg_word_count > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Avg Transcript Length:</span>
                    <span className="font-semibold text-gray-900">{extractionStats.avg_word_count.toFixed(0)} words</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg Customer Questions:</span>
                  <span className="font-semibold text-gray-900">{extractionStats.avg_questions.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Urgency Score:</span>
                  <span className="font-semibold text-gray-900">{(extractionStats.avg_urgency * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Ready for ML Training:</span>
                  <span className={`font-semibold ${extractionStats.total_calls >= 200 ? 'text-green-600' : 'text-orange-600'}`}>
                    {extractionStats.total_calls >= 1000 ? '✓ Excellent' : extractionStats.total_calls >= 500 ? '✓ Good' : extractionStats.total_calls >= 200 ? '⚠ Minimum' : '✗ Need More'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-gray-200">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              🤖 ML Model Training
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Train a two-stage deal prediction model on your extracted data
            </p>
          </div>

          <div className="space-y-4">
            {/* Data Source Selection */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Data Source</h4>
              <div className="space-y-3">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={useDemo}
                    onChange={(e) => {
                      setUseDemo(e.target.checked);
                      if (e.target.checked) setTrainingFile(null);
                    }}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700">Use demo data (500 synthetic samples)</span>
                </label>

                {!useDemo && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select CSV file (from extracted results)
                    </label>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setTrainingFile(e.target.files[0]);
                          setError("");
                        }
                      }}
                      className="block w-full text-sm text-gray-500
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-full file:border-0
                        file:text-sm file:font-semibold
                        file:bg-purple-50 file:text-purple-700
                        hover:file:bg-purple-100"
                    />
                    {trainingFile && (
                      <p className="mt-2 text-xs text-gray-600">
                        Selected: {trainingFile.name}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Training Parameters */}
            {!useDemo && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Training Parameters</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      Train/Test Split: {trainTestSplit}%/{100-trainTestSplit}%
                    </label>
                    <input
                      type="range"
                      min="60"
                      max="90"
                      step="5"
                      value={trainTestSplit}
                      onChange={(e) => setTrainTestSplit(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      Minimum samples required: {minSamplesForTraining}
                    </label>
                    <input
                      type="range"
                      min="50"
                      max="500"
                      step="50"
                      value={minSamplesForTraining}
                      onChange={(e) => setMinSamplesForTraining(Number(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Model won't train if dataset has fewer samples than this threshold
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={handleTrainModel}
              disabled={trainingModel || (!useDemo && !trainingFile)}
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg px-6 py-3 font-medium hover:from-purple-700 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
            >
              {trainingModel ? "Training Model..." : "🚀 Train Model & View Metrics"}
            </button>
          </div>
        </div>

        {showMetrics && modelMetrics && (
          <div className="mt-6 space-y-6">
            {/* Hero Metrics */}
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg p-6 border border-purple-200">
              <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                🎯 Model Performance
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="text-sm text-gray-600 mb-1">F2 Score</div>
                  <div className="text-3xl font-bold text-purple-600">
                    {(modelMetrics.classification_metrics.f2_score * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Optimizes for recall</div>
                </div>
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="text-sm text-gray-600 mb-1">ROC-AUC</div>
                  <div className="text-3xl font-bold text-blue-600">
                    {(modelMetrics.classification_metrics.roc_auc * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Classification power</div>
                </div>
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="text-sm text-gray-600 mb-1">PR-AUC</div>
                  <div className="text-3xl font-bold text-indigo-600">
                    {(modelMetrics.classification_metrics.pr_auc * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Precision-recall</div>
                </div>
              </div>
            </div>

            {/* Data Stats */}
            <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">📊 Training Data</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Total Samples:</span>
                  <span className="ml-2 font-semibold">{modelMetrics.data_stats.total_samples.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-600">Close Rate:</span>
                  <span className="ml-2 font-semibold">{(modelMetrics.data_stats.close_rate_actual * 100).toFixed(1)}%</span>
                </div>
                <div>
                  <span className="text-gray-600">Train / Test Split:</span>
                  <span className="ml-2 font-semibold">{modelMetrics.data_stats.train_samples} / {modelMetrics.data_stats.test_samples}</span>
                </div>
                <div>
                  <span className="text-gray-600">Total Deal Value:</span>
                  <span className="ml-2 font-semibold">${modelMetrics.data_stats.total_actual_value.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Business Metrics */}
            <div className="bg-green-50 rounded-lg p-6 border border-green-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">💼 Business Impact</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Predicted Total Value:</span>
                  <span className="font-semibold text-green-700">${Math.round(modelMetrics.business_metrics.total_predicted_value).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Prediction Error:</span>
                  <span className={`font-semibold ${Math.abs(modelMetrics.business_metrics.value_error_pct) < 10 ? 'text-green-700' : 'text-orange-600'}`}>
                    {modelMetrics.business_metrics.value_error_pct >= 0 ? '+' : ''}{modelMetrics.business_metrics.value_error_pct.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">MAE (Overall):</span>
                  <span className="font-semibold">${Math.round(modelMetrics.business_metrics.mae_overall).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Feature Importance */}
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">🔍 Top Features</h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Deal Close Drivers</h4>
                  <div className="space-y-2">
                    {modelMetrics.feature_importance.classifier.slice(0, 5).map((feat, i) => (
                      <div key={i} className="flex items-center">
                        <div className="flex-1">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-600">{feat.feature.replace(/_/g, ' ')}</span>
                            <span className="text-gray-500">{feat.importance.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-purple-600 h-2 rounded-full transition-all"
                              style={{ width: `${Math.min(feat.importance, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Deal Value Drivers</h4>
                  <div className="space-y-2">
                    {modelMetrics.feature_importance.regressor.slice(0, 5).map((feat, i) => (
                      <div key={i} className="flex items-center">
                        <div className="flex-1">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-600">{feat.feature.replace(/_/g, ' ')}</span>
                            <span className="text-gray-500">{feat.importance.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all"
                              style={{ width: `${Math.min(feat.importance, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ROC Curve Visualization */}
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">📈 ROC Curve</h3>
              <div className="relative w-full h-64 bg-gray-50 rounded-lg overflow-hidden">
                <svg viewBox="0 0 400 300" className="w-full h-full">
                  {/* Grid */}
                  <defs>
                    <pattern id="grid" width="40" height="30" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 30" fill="none" stroke="#e5e7eb" strokeWidth="0.5"/>
                    </pattern>
                  </defs>
                  <rect width="400" height="300" fill="url(#grid)" />

                  {/* Axes */}
                  <line x1="50" y1="250" x2="380" y2="250" stroke="#374151" strokeWidth="2" />
                  <line x1="50" y1="20" x2="50" y2="250" stroke="#374151" strokeWidth="2" />

                  {/* Diagonal (random classifier) */}
                  <line x1="50" y1="250" x2="380" y2="20" stroke="#9ca3af" strokeWidth="1" strokeDasharray="5,5" />

                  {/* ROC Curve */}
                  <polyline
                    points={modelMetrics.roc_curve.fpr.map((fpr, i) => {
                      const tpr = modelMetrics.roc_curve.tpr[i];
                      const x = 50 + (fpr * 330);
                      const y = 250 - (tpr * 230);
                      return `${x},${y}`;
                    }).join(' ')}
                    fill="none"
                    stroke="#7c3aed"
                    strokeWidth="3"
                  />

                  {/* Labels */}
                  <text x="215" y="280" textAnchor="middle" className="text-xs fill-gray-600">False Positive Rate</text>
                  <text x="20" y="135" textAnchor="middle" transform="rotate(-90 20 135)" className="text-xs fill-gray-600">True Positive Rate</text>

                  {/* AUC label */}
                  <text x="300" y="200" className="text-sm font-semibold fill-purple-600">
                    AUC = {modelMetrics.classification_metrics.roc_auc.toFixed(3)}
                  </text>
                </svg>
              </div>
            </div>

            {/* Sample Predictions */}
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">🎲 Sample Predictions</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-2 font-medium text-gray-600">#</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-600">P(Close)</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-600">Value|Close</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-600">Expected</th>
                      <th className="text-center py-2 px-2 font-medium text-gray-600">Actual</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-600">Actual Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelMetrics.sample_predictions.map((pred) => (
                      <tr key={pred.deal_num} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-2">{pred.deal_num}</td>
                        <td className="py-2 px-2 text-right font-medium">{(pred.p_close * 100).toFixed(1)}%</td>
                        <td className="py-2 px-2 text-right">${Math.round(pred.value_if_closed).toLocaleString()}</td>
                        <td className="py-2 px-2 text-right font-semibold text-purple-600">${Math.round(pred.expected_value).toLocaleString()}</td>
                        <td className="py-2 px-2 text-center">
                          {pred.actual_closed ? (
                            <span className="text-green-600 font-bold">✓</span>
                          ) : (
                            <span className="text-red-500">✗</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">${pred.actual_value.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <button
              onClick={() => setShowMetrics(false)}
              className="w-full bg-gray-200 text-gray-700 rounded-lg px-6 py-2 font-medium hover:bg-gray-300 transition-colors"
            >
              Hide Metrics
            </button>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            Powered by LaunchDarkly AI Configs + Vercel AI Gateway
          </p>
        </div>
      </div>
    </div>
  );
}

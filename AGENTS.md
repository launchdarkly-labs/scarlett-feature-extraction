# AGENTS.md

Sales Call Transcript Extractor: a Next.js 14 app that turns uploaded sales-call transcripts into CSV rows of 40–65 fields. One LaunchDarkly AI Config (`transcript-extraction-unified`) carries six schema tools (A–F, one per call type); the model picks the schema and extracts in a single call through Vercel AI Gateway via `@launchdarkly/server-sdk-ai-vercel`. A Python side (`ml/`) trains a two-stage CatBoost deal-prediction model on the extracted CSVs. The upstream repo is `launchdarkly-labs/scarlett-feature-extraction`.

## Setup and commands

- Node: `npm install`, `cp .env.example .env`, then `npm run dev` (port 3000). `LAUNCHDARKLY_SDK_KEY` is required. For the AI Gateway, local dev uses `VERCEL_OIDC_TOKEN` (`npx vercel env pull`, expires every 12 h, a 401 means refresh it) and Vercel deployments use `AI_GATEWAY_API_KEY`; `lib/launchdarkly-client.ts` picks based on `VERCEL === '1'`.
- Python: `python3 -m venv venv && source venv/bin/activate`, `pip install -r ml/requirements.txt` plus `requests python-dotenv` for the bootstrap. The `/api/train-model` route shells out to `source venv/bin/activate && python ml/train_and_return_metrics.py`, so the venv must be at `./venv` (or run under Docker, where it uses `python3`).
- LaunchDarkly bootstrap: `python bootstrap/create_unified_config.py` with `LD_API_KEY` and `LD_PROJECT_KEY`. **It deletes every AI Config and tool in the project first**, so point it at a project dedicated to this app.
- Verification: `npx tsc --noEmit` (must pass), then a manual extraction run in the UI with `examples/input/*.txt` (happy path) and `data/test-transcripts/` (edge cases: empty, invalid, unicode). There is no test suite.

## Where the schemas live

Schemas are LaunchDarkly *tools*. Their JSON schemas live in `LAUNCHDARKLY_TOOLS.json` at the repo root (`core_fields_schema` plus `variation_a_prospecting` … `variation_f_*`); `bootstrap/create_unified_config.py` reads that file, creates the six tools, and attaches them to the `unified` variation. Adding or changing a field means editing the JSON and re-running the bootstrap, not editing TypeScript. `lib/pipeline.ts` reads whatever fields come back, so the CSV columns follow the served schema. The default model is set in the same bootstrap file (`Anthropic.claude-3-7-sonnet-latest`).

## Layout

- `app/api/extract-stream/route.ts` streams per-transcript progress; `app/api/train-model/route.ts` wraps the Python trainer.
- `lib/launchdarkly-client.ts` owns SDK init, the AI Gateway credential choice, and `createContext(id, "transcript")`; `lib/pipeline.ts` runs one transcript end to end.
- `ml/deal_model.py` is the two-stage model; `ml/train_and_return_metrics.py` is what the API calls. `ml/README.md` describes the modelling choices.
- `content/` and `examples/` are tutorial material and sample I/O, not runtime inputs.

## Gotchas

- `.env.vercel` is written by `npx vercel env pull` and is gitignored; it holds a short-lived `VERCEL_OIDC_TOKEN` and must stay out of commits (an old one is in git history).
- `scripts/`, `TUTORIAL.md`, `check_config.py`, and `debug_config.py` are gitignored local-only files.

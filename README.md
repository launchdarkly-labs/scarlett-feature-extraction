# Sales Call Transcript Extractor

**Transform sales call transcripts into actionable CSV data with AI-powered sentiment analysis, business insights, and deal prediction.**

Built with **LaunchDarkly AI Configs** and **Vercel AI Gateway** for dynamic schema management. Uses the official `@launchdarkly/server-sdk-ai-vercel` SDK with intelligent tool selection. Includes ML model training for deal prediction using CatBoost.

## What You Get

📊 **40-65 structured data fields per call** including sentiment scores, deal signals, engagement metrics, and call-specific insights - all exportable as CSV for your CRM or analytics tools.

---

## Quick Start

### Manual Setup

```bash
# 1. Install dependencies
npm install
python3 -m venv venv && source venv/bin/activate
pip install catboost scikit-learn pandas numpy joblib requests python-dotenv

# 2. Configure environment variables
cp .env.example .env
# Add your keys to .env:
#   LAUNCHDARKLY_SDK_KEY=sdk-xxxxx
#   LD_API_KEY=api-xxxxx (for bootstrap only)
#   LD_PROJECT_KEY=your-project (for bootstrap only)

# 3. Get Vercel AI Gateway token
npx vercel env pull

# 4. Bootstrap LaunchDarkly AI Config (one-time)
python bootstrap/create_unified_config.py

# 5. Run
npm run dev  # → http://localhost:3000
```

### Docker Compose

```bash
# 1. Configure environment
cp .env.example .env  # Edit with your keys
npx vercel env pull   # Get OIDC token

# 2. Start services
docker-compose up

# 3. Setup LaunchDarkly (one-time, in another terminal)
docker-compose exec python sh -c ". /app/venv/bin/activate && python bootstrap/create_unified_config.py"

# → http://localhost:3000
```

---

## How It Works

### Unified AI Extraction

```
Upload Transcripts (.txt or .md)
    ↓
AI analyzes content and selects appropriate schema
    ↓
Extracts 40-65 fields in single LLM call
    ↓
CSV downloads automatically
```

### 6 Extraction Schemas

The AI automatically selects the best schema based on transcript content:

| Schema | Type | Fields | Use Case |
|--------|------|--------|----------|
| **A** | Prospecting | ~43 | Cold outreach, first contact, gatekeeper conversations |
| **B** | Discovery | ~48 | BANT qualification, needs assessment, pain point identification |
| **C** | Demo | ~58 | Product demonstrations, feature walkthroughs, POC discussions |
| **D** | Proposal | ~53 | Pricing negotiations, contract terms, commercial discussions |
| **E** | Technical | ~63 | Architecture reviews, integration planning, technical deep-dives |
| **F** | Customer Success | ~53 | QBRs, renewal discussions, expansion opportunities |

**Core Fields** (in all schemas):
- **Identity**: transcript_id, customer_company_name, salesperson_name, call_date
- **Business**: deal_stage, customer_size, industry, estimated_deal_value
- **Sentiment**: overall_sentiment_score, sentiment_about_product, sentiment_about_pricing (-1 to +1)
- **Engagement**: customer_engagement_score, urgency_score, budget_confidence_score (0 to 1)
- **Statistics**: transcript_word_count, customer_question_count, competitor_mention_count
- **Signals**: next_steps_defined, competitors_mentioned, decision_makers_present

---

## Configuration

### 1. Bootstrap LaunchDarkly

```bash
export LD_API_KEY="api-xxxxx"
export LD_PROJECT_KEY="your-project"
python bootstrap/create_unified_config.py
```

**What it creates:**
- ✅ 1 AI Config: `transcript-extraction-unified`
- ✅ 6 extraction tools (schemas A-F)
- ✅ 1 unified variation with all tools attached
- ✅ Default model: `claude-3-7-sonnet-latest`

**Important:** The script deletes all existing AI configs and tools to ensure a clean state.

### 2. Environment Variables

```bash
# LaunchDarkly
LAUNCHDARKLY_SDK_KEY=sdk-xxxxx       # Runtime SDK key
LD_API_KEY=api-xxxxx                 # For bootstrap script only
LD_PROJECT_KEY=your-project          # For bootstrap script only

# Vercel AI Gateway (choose one)
VERCEL_OIDC_TOKEN=eyJhbGc...         # Preferred - auto-refreshed
AI_GATEWAY_API_KEY=vck_xxxxx         # Alternative - manual
```

**Get OIDC token:**
```bash
npx vercel env pull  # Refresh every 12 hours
```

---

## Usage

### Feature Extraction

1. Start dev server: `npm run dev`
2. Upload .txt or .md transcripts
3. Click "Extract Features"
4. Watch real-time progress
5. CSV downloads automatically

**Features:**
- Real-time progress tracking with SSE
- Per-file error reporting (continues on failures)
- Empty file detection
- UTF-8 and special character support
- Large file handling

### ML Model Training

1. Click "Train Model" in the ML section
2. Choose demo data or use extracted CSV
3. View metrics: Precision, Recall, F1, RMSE, R²
4. Model saved as `deal_model.pkl`

---

## Deployment

### Local Development

```bash
npm run dev  # → http://localhost:3000
```

### Production (Vercel)

```bash
npx vercel --prod
```

**Vercel Setup:**
1. Add `LAUNCHDARKLY_SDK_KEY` in project settings
2. `VERCEL_OIDC_TOKEN` auto-provided in production
3. Build configured with `.npmrc` and `next.config.js`

**Production URL**: https://vercel-tan-beta-71.vercel.app

---

## Dynamic Configuration

**All schemas live in LaunchDarkly** - update without code changes!

### Modify Schemas

1. LaunchDarkly → AI Tools → Select tool
2. Edit JSON Schema parameters
3. Save → Changes apply immediately

### A/B Testing

1. Create new variation with modified schema
2. Set targeting rules (e.g., customer_segment = "Enterprise")
3. Monitor metrics in LaunchDarkly dashboard

**Benefits:**
- No code deployment to change fields
- Gradual rollout and canary testing
- Performance tracking per variation
- Instant rollback capability

---

## Customization

### Add New Schema

1. **Define schema** in `LAUNCHDARKLY_TOOLS.json`:
```json
{
  "variation_g_custom": {
    "function": {
      "name": "extract_custom_features",
      "description": "Extract features from custom call type",
      "parameters": {
        "type": "object",
        "properties": {
          "custom_field_1": { "type": "string" },
          "custom_field_2": { "type": "number" }
        },
        "required": ["custom_field_1"]
      }
    }
  }
}
```

2. **Update bootstrap** in `bootstrap/create_unified_config.py`:
```python
tool_mapping = {
    # ... existing tools ...
    "extract_custom_features": ("Extract Custom Features (G)", "variation_g_custom"),
}
```

3. **Run bootstrap**:
```bash
python bootstrap/create_unified_config.py
```

### Adjust Model Selection

Change model in `bootstrap/create_unified_config.py`:
```python
model_config_key="Anthropic.claude-3-7-sonnet-latest"  # Premium, accurate
# or
model_config_key="Gemini.gemini-2.0-flash"  # Fast, cheaper
```

---

## Project Structure

```
├── app/                              # Next.js app
│   ├── page.tsx                      # Upload UI
│   └── api/
│       ├── extract-stream/           # SSE endpoint
│       ├── extract/                  # Non-streaming endpoint
│       └── train-model/              # ML training endpoint
├── lib/
│   ├── pipeline.ts                   # Unified extraction pipeline
│   └── launchdarkly-client.ts        # SDK integration with tool calling
├── bootstrap/
│   ├── create_unified_config.py      # Setup unified AI config
│   └── create_configs.py             # Legacy (do not use)
├── ml/
│   └── train_and_return_metrics.py   # CatBoost model training
├── LAUNCHDARKLY_TOOLS.json           # Schema definitions
├── docker-compose.yml
└── .env
```

---

## Troubleshooting

**"OIDC token has expired" (401 errors)**
```bash
npx vercel env pull  # Refreshes token
# Restart dev server
```

**"Unified extraction config not found"**
```bash
python bootstrap/create_unified_config.py
# Check LAUNCHDARKLY_SDK_KEY is set
```

**"No transcripts were successfully processed"**
- Check OIDC token is fresh
- Verify LaunchDarkly config exists in dashboard
- Check console for specific errors

**LaunchDarkly connection issues**
```bash
# Verify SDK key
echo $LAUNCHDARKLY_SDK_KEY

# Test initialization
npm run dev
# Look for "LaunchDarkly client initialized successfully"
```

**Build errors**
- Already configured in `next.config.js`
- Uses webpack externals for LaunchDarkly SDK
- Check `.npmrc` has `legacy-peer-deps=true`

---

## API Reference

### POST `/api/extract-stream`

Streams extraction progress via Server-Sent Events.

**Request:**
```json
{
  "transcripts": [
    { "name": "call1.txt", "content": "..." },
    { "name": "call2.txt", "content": "..." }
  ]
}
```

**Response (SSE):**
```
event: progress
data: {"type":"extraction","current":1,"total":2,"percentage":50}

event: complete
data: {"type":"done","csvData":"...","results":[...]}
```

### POST `/api/extract`

Non-streaming extraction (for testing).

**Returns:** `{ success: true, csvData: "...", results: [...] }`

---

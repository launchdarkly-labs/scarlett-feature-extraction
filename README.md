# Sales Call Transcript Extractor

AI-powered sales call analysis using **Vercel AI Gateway** and **LaunchDarkly AI Configs**.

Upload transcripts → Get structured CSV with sentiment, business context, and call-specific insights. Includes ML model training for deal prediction using CatBoost.

---

## Quick Start

```bash
# 1. Install Node dependencies
npm install

# 2. Setup Python environment (for ML model)
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt  # or manually: pip install catboost scikit-learn pandas numpy joblib requests python-dotenv

# 3. Configure .env
VERCEL_OIDC_TOKEN=your-vercel-oidc-token  # Get via: npx vercel env pull
# or AI_GATEWAY_API_KEY=your-vercel-api-key
LAUNCHDARKLY_SDK_KEY=sdk-xxxxx

# 4. Setup LaunchDarkly (one-time)
source venv/bin/activate
python bootstrap/create_configs.py

# 5. Run
npm run dev
# → http://localhost:3000
```

---

## How It Works

### Two-Stage Pipeline

```
Upload Transcripts
    ↓
Stage 1: Classification (Gemini 2.5 Flash)
    → Determines call type + routes to variation A-F
    ↓
Stage 2: Feature Extraction (Gemini 2.5 Pro / Claude 3.5 Sonnet)
    → Extracts 52-72 fields based on call type
    ↓
Download CSV
```

### 6 Variations (A-F)

| Variation | Type | Core + Specific | Total Fields | Model | Example |
|-----------|------|-----------------|--------------|-------|---------|
| **A** | Prospecting | 42 + 10 | 52 | Gemini 2.5 Flash | Cold outreach, connection attempts |
| **B** | Discovery | 42 + 15 | 57 | Gemini 2.5 Pro | BANT qualification, pain points |
| **C** | Demo | 42 + 25 | 67 | Claude 3.5 Sonnet | Product demos, feature showcase |
| **D** | Proposal | 42 + 20 | 62 | Claude 3.5 Sonnet | Pricing negotiation, terms |
| **E** | Technical | 42 + 30 | 72 | Claude 3.5 Sonnet | Architecture review, integrations |
| **F** | Customer Success | 42 + 20 | 62 | Gemini 2.5 Pro | QBRs, renewals, upsells |

**Core Fields** (42 fields in all variations):
- **Identity**: transcript_id, customer_company_name, salesperson_name, call_date, call_time
- **Business**: deal_stage, customer_size, industry, estimated_deal_value, call_category
- **Sentiment** (all -1 to +1): overall_sentiment_score, sentiment_about_product, sentiment_about_pricing, sentiment_about_competitors, sentiment_about_market_conditions, sentiment_about_current_solution, sentiment_trajectory
- **Engagement**: customer_engagement_score, urgency_score, budget_confidence_score
- **Text Statistics**: transcript_word_count, customer_word_count, customer_question_count, technical_term_count, pricing_mention_count, competitor_mention_count
- **Signals**: next_steps_defined, competitors_mentioned, decision_makers_present, churn_risk_signals

**Benefit**: Track customer journey across different call types.

---

## Setup

### 1. Bootstrap LaunchDarkly

```bash
# Set env vars
export LD_API_KEY="api-xxxxx"
export LD_PROJECT_KEY="your-project"

# Run bootstrap (creates everything)
python bootstrap/create_configs.py
```

**Automatically creates**:
- ✅ 2 AI Configs (completion mode)
- ✅ 7 tools (1 classification + 6 extraction variations)
- ✅ 8 variations (2 classification + 6 extraction)
- ✅ Targeting rules (routes by `variation_hint`)

### 2. Environment Variables

```bash
# LaunchDarkly
LAUNCHDARKLY_SDK_KEY=sdk-xxxxx
LD_API_KEY=api-xxxxx           # For bootstrap only
LD_PROJECT_KEY=your-project    # For bootstrap only

# Vercel AI Gateway (choose one)
VERCEL_OIDC_TOKEN=eyJhbGc...   # Preferred - get via: npx vercel env pull
# or
AI_GATEWAY_API_KEY=vck_xxxxx    # Alternative - from Vercel dashboard
```

---

## Usage

### Web App

```bash
npm run dev
```

#### Feature Extraction

1. Upload .txt or .md transcripts (select folder)
2. (Optional) Customize output filename
3. Click "Extract Features"
4. Watch real-time progress bar showing:
   - Current file being processed
   - Processing stage (Classification → Extraction)
   - Percentage complete (0-100%)
   - File counter (e.g., "File 2 of 5")
5. CSV downloads automatically when complete

**Features:**
- ✅ Real-time progress tracking with visual progress bar
- ✅ Custom filename support for downloads
- ✅ Per-file error reporting (batch continues on failures)
- ✅ Empty file detection and validation
- ✅ Handles UTF-8, special characters, and large files
- ✅ Summary metrics display after extraction (average sentiment, deal velocity, etc.)

#### ML Model Training (CatBoost Zero-Inflated Model)

1. After extracting features, click "Train Model" in the ML Model section
2. Choose either:
   - **Use Demo Data**: Generates synthetic data for testing (500 samples)
   - **Use Extracted Data**: Uses your actual extracted CSV
3. View model performance metrics:
   - **Stage 1 (Deal/No Deal)**: Precision, Recall, F1-Score
   - **Stage 2 (Deal Size)**: RMSE, R², Mean Absolute Percentage Error
   - **Overall Accuracy** and **Feature Importance**
4. Model is saved as `deal_model.pkl` for production use

### Deploy to Vercel

```bash
vercel deploy
```

Add environment variables in Vercel dashboard:
- `LAUNCHDARKLY_SDK_KEY`
- `AI_GATEWAY_API_KEY`

---

## Dynamic Configuration

**All schemas defined in LaunchDarkly** - no code changes needed!

### Modify Schemas
1. LaunchDarkly → AI Tools → Select tool
2. Edit JSON Schema
3. Save → Changes take effect immediately

### A/B Test Schemas
1. Create variation with different schema
2. Set targeting rules
3. Monitor metrics in LaunchDarkly

**Benefits**:
- ✅ No redeployment to change fields
- ✅ A/B test variations
- ✅ Track cost vs accuracy
- ✅ Gradual rollout

---

## Customization

### Map Call Types to Variations

Edit `lib/variation-mapping.ts`:

```typescript
export const CATEGORY_TO_VARIATION = {
  "your_call_type_1": "A",  // Prospecting
  "your_call_type_2": "C",  // Demo
  // ... add your categories
};
```

---

## Cost Optimization

### Per 1,000 Calls (Mixed Distribution)

```
Classification: 1,000 × $0.0007 = $0.70

Extraction (mixed):
  300 Prospecting  × $0.001 = $0.30
  300 Discovery    × $0.01  = $3.00
  200 Demo         × $0.03  = $6.00
  100 Proposal     × $0.03  = $3.00
  50  Technical    × $0.03  = $1.50
  50  CS/QBR       × $0.01  = $0.50

Total: ~$15/1,000 calls ($0.015/call avg)
```

### Tips
- Route simple calls to Gemini (A, B, F)
- Reserve Claude for complex calls (C, D, E)
- Monitor costs in LaunchDarkly dashboard

---

## Project Structure

```
vercel/
├── app/                              # Next.js Web App
│   ├── page.tsx                      # Upload UI with progress bar
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── extract/route.ts          # Legacy endpoint (no progress)
│       └── extract-stream/route.ts   # Main endpoint with SSE progress
├── lib/
│   ├── pipeline.ts                   # Two-stage orchestration + progress tracking
│   ├── launchdarkly-client.ts        # LD integration (singleton)
│   ├── vercel-client.ts              # Vercel AI Gateway client
│   └── variation-mapping.ts          # Category → Variation routing
├── bootstrap/
│   └── create_configs.py             # Auto-create LD configs
├── data/
│   └── test-transcripts/             # Edge case test files
├── LAUNCHDARKLY_TOOLS.json           # Tool schemas (copy to LD)
├── TUTORIAL.md                       # Long-form guide
├── package.json
└── .env
```

---

## Troubleshooting

**"No API key found"**
→ Set `AI_GATEWAY_API_KEY` in `.env`

**"LaunchDarkly SDK failed to initialize"**
→ Check `LAUNCHDARKLY_SDK_KEY`
→ Run bootstrap if configs don't exist: `python bootstrap/create_configs.py`

**Bootstrap errors**
→ Verify `LD_API_KEY` and `LD_PROJECT_KEY` are set
→ Check Python venv is activated: `source venv/bin/activate`

**Classification/Extraction errors**
→ Verify configs exist in LaunchDarkly UI
→ Check targeting rules use `variation_hint` attribute

**Empty file errors**
→ Files must contain at least 50 characters
→ Empty files are automatically detected and skipped
→ Batch processing continues even if individual files fail

**OIDC token expired (401 errors)**
→ The Vercel AI Gateway OIDC token expires every 12 hours
→ Refresh it by running: `npx vercel env pull`
→ This updates `.env.local` with a fresh token
→ Restart the dev server after refreshing

---

## Advanced

### Adding New Variations

1. Add tool schema to `LAUNCHDARKLY_TOOLS.json`
2. Update `bootstrap/create_configs.py` to include new variation
3. Run bootstrap: `python bootstrap/create_configs.py`
4. Update `lib/variation-mapping.ts` with new category mapping

### Schema Reference

All schemas defined in `LAUNCHDARKLY_TOOLS.json`. The bootstrap script automatically creates them in LaunchDarkly.

---

## License

MIT

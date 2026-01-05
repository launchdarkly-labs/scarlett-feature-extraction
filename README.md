# Sales Call Transcript Extractor

**Transform sales call transcripts into actionable CSV data with AI-powered sentiment analysis, business insights, and deal prediction.**

Built with **LaunchDarkly AI Configs** and **Vercel AI Gateway** for dynamic schema management and A/B testing. Uses the official `@launchdarkly/server-sdk-ai-vercel` SDK with Next.js-specific optimizations. Includes ML model training for deal prediction using CatBoost.

## What You Get

📊 **52-72 structured data fields per call** including sentiment scores, deal signals, engagement metrics, and call-specific insights - all exportable as CSV for your CRM or analytics tools.

---

## Quick Start

### Docker Compose (Recommended)

```bash
# 1. Configure environment variables
cp .env.example .env  # Edit with your keys
npx vercel env pull   # Get OIDC token

# 2. Start all services
docker-compose up

# 3. Setup LaunchDarkly (one-time, in another terminal)
docker-compose exec python sh -c ". /app/venv/bin/activate && python bootstrap/create_configs.py"

# → http://localhost:3000
```

### Manual Setup

```bash
# 1. Install dependencies
npm install
python3 -m venv venv && source venv/bin/activate
pip install catboost scikit-learn pandas numpy joblib requests python-dotenv

# 2. Configure environment
VERCEL_OIDC_TOKEN=...          # Get via: npx vercel env pull
LAUNCHDARKLY_SDK_KEY=sdk-xxxxx

# 3. Setup LaunchDarkly (one-time)
python bootstrap/create_configs.py

# 4. Run
npm run dev  # → http://localhost:3000
```

---

## Example Output

From a discovery call transcript, get structured data like:

```csv
customer_company_name,deal_stage,overall_sentiment_score,urgency_score,budget_mentioned,estimated_deal_value,next_steps_defined
"Acme Corp","Discovery",0.75,0.9,true,150000,"Schedule technical deep dive next Tuesday"
```

📁 **[View complete example →](examples/output/extracted-features.csv)**

---

## How It Works

### Two-Stage Pipeline

```
Upload Transcripts
    ↓
Stage 1: AI Classification
    → Determines call type + routes to variation A-F
    ↓
Stage 2: Feature Extraction
    → Extracts 52-72 fields based on call type
    ↓
Download CSV
```

### 6 Variations (A-F)

Each variation extracts different field sets optimized for specific call types:

| Variation | Type | Total Fields | Example |
|-----------|------|--------------|---------|
| **A** | Prospecting | 52 | Cold outreach, connection attempts |
| **B** | Discovery | 57 | BANT qualification, pain points |
| **C** | Demo | 67 | Product demos, feature showcase |
| **D** | Proposal | 62 | Pricing negotiation, terms |
| **E** | Technical | 72 | Architecture review, integrations |
| **F** | Customer Success | 62 | QBRs, renewals, upsells |

**Core Fields** (42 in all variations):
- **Identity**: transcript_id, customer_company_name, salesperson_name, call_date
- **Business**: deal_stage, customer_size, industry, estimated_deal_value
- **Sentiment**: overall_sentiment_score, sentiment_about_product, sentiment_about_pricing (all -1 to +1)
- **Engagement**: customer_engagement_score, urgency_score, budget_confidence_score
- **Statistics**: transcript_word_count, customer_question_count, competitor_mention_count
- **Signals**: next_steps_defined, competitors_mentioned, decision_makers_present

---

## Configuration

### 1. Bootstrap LaunchDarkly

```bash
export LD_API_KEY="api-xxxxx"
export LD_PROJECT_KEY="your-project"
python bootstrap/create_configs.py
```

**Automatically creates**:
- 2 AI Configs (completion mode)
- 7 tools (1 classification + 6 extraction variations)
- Targeting rules (routes by `variation_hint`)

### 2. Environment Variables

```bash
# LaunchDarkly
LAUNCHDARKLY_SDK_KEY=sdk-xxxxx
LD_API_KEY=api-xxxxx           # For bootstrap only
LD_PROJECT_KEY=your-project    # For bootstrap only

# Vercel AI Gateway (choose one)
VERCEL_OIDC_TOKEN=eyJhbGc...   # Preferred - get via: npx vercel env pull
AI_GATEWAY_API_KEY=vck_xxxxx   # Alternative - from Vercel dashboard
```

---

## Usage

### Feature Extraction

```bash
npm run dev
```

1. Upload .txt or .md transcripts
2. Click "Extract Features"
3. Watch real-time progress tracking
4. CSV downloads automatically

**Features:**
- Real-time progress bar with file counter
- Per-file error reporting (batch continues on failures)
- Empty file detection and validation
- UTF-8, special characters, and large file support

### ML Model Training

1. Click "Train Model" in the ML Model section
2. Choose demo data or use extracted CSV
3. View performance metrics (Precision, Recall, F1, RMSE, R²)
4. Model saved as `deal_model.pkl`

---

## Deployment

### Local Development

```bash
npm run dev  # → http://localhost:3000
```

### Docker Compose

```bash
docker-compose up  # → http://localhost:3000
```

**Note**: For Docker, ensure VERCEL_OIDC_TOKEN is in `.env` file (see [bootstrap/README.md](bootstrap/README.md))

### Vercel Platform

```bash
npx vercel --prod
```

**Production URL**: https://vercel-tan-beta-71.vercel.app

**Setup:**
1. Add `LAUNCHDARKLY_SDK_KEY` in Vercel dashboard settings
2. `VERCEL_OIDC_TOKEN` is automatically provided in production

**Build requirements** (already configured):
- `.npmrc` with `legacy-peer-deps=true`
- TypeScript fixes in `lib/launchdarkly-client.ts`
- Webpack configuration in `next.config.js`

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
- No redeployment to change fields
- A/B test variations
- Track performance metrics
- Gradual rollout

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

### Adding New Variations

1. Add tool schema to `LAUNCHDARKLY_TOOLS.json`
2. Update `bootstrap/create_configs.py`
3. Run: `python bootstrap/create_configs.py`
4. Update `lib/variation-mapping.ts`

---

## Project Structure

```
├── app/                       # Next.js app
│   ├── page.tsx              # Upload UI
│   └── api/
│       └── extract-stream/   # SSE endpoint
├── lib/
│   ├── pipeline.ts           # Two-stage orchestration
│   ├── launchdarkly-client.ts # SDK integration
│   └── variation-mapping.ts  # Category routing
├── bootstrap/
│   └── create_configs.py     # Auto-create LD configs
├── ml/
│   └── train_and_return_metrics.py
├── docker-compose.yml
└── .env
```

---

## Troubleshooting

**"No API key found"**
→ Set `VERCEL_OIDC_TOKEN` or `AI_GATEWAY_API_KEY` in `.env`

**"LaunchDarkly SDK failed to initialize"**
→ Check `LAUNCHDARKLY_SDK_KEY`
→ Run bootstrap: `python bootstrap/create_configs.py`

**OIDC token expired (401 errors)**
→ Refresh: `npx vercel env pull`
→ Restart dev server

**Module not found errors (Next.js bundling)**
→ Handled by webpack config in `next.config.js`

**Docker: VERCEL_OIDC_TOKEN issues**
→ See [bootstrap/README.md](bootstrap/README.md) for Docker-specific setup

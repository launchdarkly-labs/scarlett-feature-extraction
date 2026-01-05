# Sales Call Transcript Extractor

**Transform sales call transcripts into actionable CSV data with AI-powered sentiment analysis, business insights, and deal prediction.**

Built with **LaunchDarkly AI Configs** and **Vercel AI Gateway** for dynamic schema management and A/B testing. Uses the official `@launchdarkly/server-sdk-ai-vercel` SDK with Next.js-specific optimizations for compatibility across all deployment environments. Includes ML model training for deal prediction using CatBoost.

## What You Get

📊 **52-72 structured data fields per call** including sentiment scores, deal signals, engagement metrics, and call-specific insights - all exportable as CSV for your CRM or analytics tools.

---

## Quick Start

### Option 1: Docker Compose (Recommended)

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

### Option 2: Manual Setup

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

### Option 3: Production Build

```bash
# Build for production
npm run build

# Start production server
npm start
# → http://localhost:3000
```

---

## Example Output

From a discovery call transcript, get structured data like:

```csv
customer_company_name,deal_stage,overall_sentiment_score,urgency_score,budget_mentioned,estimated_deal_value,next_steps_defined
"Acme Corp","Discovery",0.75,0.9,true,150000,"Schedule technical deep dive next Tuesday"
"TechStart Inc","Demo",0.82,0.7,false,75000,"Send pricing proposal by EOW"
```

📁 **[View complete example →](examples/output/extracted-features.csv)**
📝 **[Sample input transcripts →](examples/input/)**

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
# Deploy to preview environment
vercel

# Deploy to production
vercel --prod
```

**Required environment variables in Vercel dashboard:**
- `LAUNCHDARKLY_SDK_KEY` - Your LaunchDarkly SDK key
- `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` - Vercel AI Gateway authentication

### Docker Development

The included `docker-compose.yml` provides a consistent development environment:

```bash
# Start all services (web app, Python environment, Redis cache)
docker-compose up

# Run commands in containers
docker-compose exec web npm install new-package
docker-compose exec python python bootstrap/create_configs.py

# Stop services
docker-compose down

# Reset everything (including volumes)
docker-compose down -v
```

**Note**: Docker Compose is for local development only. Vercel deployment uses their platform directly.

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

## Deployment Options

### 1. Local Development
```bash
npm run dev
# → http://localhost:3000
```
✅ Hot reloading
✅ Debug mode
✅ Instant changes

### 2. Production Build (Local)
```bash
npm run build
npm start
# → http://localhost:3000
```
✅ Optimized build
✅ Test production locally
✅ Performance testing

### 3. Docker Compose
```bash
docker-compose up
# → http://localhost:3000
```
✅ Consistent environment
✅ All services included
✅ No dependency issues

### 4. Vercel Platform
```bash
vercel          # Preview deployment
vercel --prod   # Production deployment
```
✅ Auto-scaling
✅ Edge functions
✅ Built-in monitoring

### 5. Docker (Standalone)
```bash
docker build -t transcript-extractor .
docker run -p 3000:3000 --env-file .env transcript-extractor
```
✅ Container isolation
✅ K8s ready
✅ CI/CD compatible

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
│   ├── launchdarkly-client.ts        # Official SDK integration with Next.js workarounds
│   └── variation-mapping.ts          # Category → Variation routing
├── bootstrap/
│   └── create_configs.py             # Auto-create LD configs
├── ml/
│   └── train_and_return_metrics.py   # CatBoost model training
├── data/
│   └── test-transcripts/             # Edge case test files
├── next.config.js                    # Next.js config with SDK bundling workarounds
├── docker-compose.yml                 # Multi-service development environment
├── Dockerfile                         # Production container build
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

**Module not found errors (Next.js bundling)**
→ The LaunchDarkly SDK uses dynamic imports that Next.js can't bundle
→ This is handled by webpack config in `next.config.js`
→ If you see errors about missing @launchdarkly packages, ensure `next.config.js` includes the webpack aliases

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

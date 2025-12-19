# Sales Call Transcript Extractor

AI-powered sales call analysis using **Vercel AI Gateway** and **LaunchDarkly AI Configs**.

Upload transcripts → Get structured CSV with sentiment, business context, and call-specific insights.

---

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure .env
AI_GATEWAY_API_KEY=your-vercel-api-key

# 3. Setup LaunchDarkly (one-time)
python bootstrap/create_configs.py

# 4. Run
npm run dev
# → http://localhost:3000
```

---

## How It Works

### Two-Stage Pipeline

```
Upload Transcripts
    ↓
Stage 1: Classification (Gemini Flash, $0.0007/call)
    → Determines call type + routes to variation A-F
    ↓
Stage 2: Feature Extraction (Gemini/Claude, $0.001-$0.03/call)
    → Extracts 33-63 fields based on call type
    ↓
Download CSV
```

### 6 Variations (A-F)

| Variation | Type | Fields | Model | Cost | Example |
|-----------|------|--------|-------|------|---------|
| **A** | Prospecting | 43 | Gemini Flash | $0.001 | Cold outreach |
| **B** | Discovery | 48 | Gemini Pro | $0.01 | BANT qualification |
| **C** | Demo | 58 | Claude Sonnet 4 | $0.03 | Product demos |
| **D** | Proposal | 53 | Claude Sonnet 4 | $0.03 | Pricing negotiation |
| **E** | Technical | 63 | Claude Sonnet 4 | $0.03 | Architecture review |
| **F** | Customer Success | 53 | Gemini Pro | $0.01 | QBRs, renewals |

**Core Fields** (all variations):
- **Identity**: transcript_id, customer_company_name, salesperson_name
- **Business**: deal_stage, customer_size, industry, estimated_deal_value
- **Sentiment** (all -1 to +1): overall, product, pricing, competitors, market_conditions, current_solution
- **Engagement**: customer_engagement_score, urgency_score, budget_confidence_score
- **Signals**: next_steps_defined, timeline_mentioned, competitors_mentioned

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

# Vercel AI Gateway
AI_GATEWAY_API_KEY=your-vercel-api-key
```

---

## Usage

### Web App

```bash
npm run dev
```

1. Upload .txt or .md transcripts
2. Click "Extract Features"
3. Download CSV

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
├── app/                        # Next.js Web App
│   ├── page.tsx                # Upload UI
│   ├── layout.tsx
│   ├── globals.css
│   └── api/extract/route.ts    # Processing endpoint
├── lib/
│   ├── pipeline.ts             # Two-stage orchestration
│   ├── launchdarkly-client.ts  # LD integration (singleton)
│   ├── vercel-client.ts        # Vercel AI Gateway client
│   └── variation-mapping.ts    # Category → Variation routing
├── bootstrap/
│   └── create_configs.py       # Auto-create LD configs
├── LAUNCHDARKLY_TOOLS.json     # Tool schemas (copy to LD)
├── TUTORIAL.md                 # Long-form guide
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

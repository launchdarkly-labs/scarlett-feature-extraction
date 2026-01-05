# LaunchDarkly Bootstrap Setup

## Quick Start

1. **Set environment variables:**
   ```bash
   export LD_API_KEY="your-launchdarkly-api-key"
   export LD_PROJECT_KEY="your-project-key"
   ```

2. **Run the bootstrap script:**
   ```bash
   python bootstrap/create_configs.py
   ```

## What the Bootstrap Script Does

The script automatically creates:

1. **AI Configs:**
   - `transcript-classification` - Routes transcripts to the right extraction variation
   - `sales-transcript-extraction` - Extracts structured features from transcripts

2. **Tools (with merged core + variation fields):**
   - `classify_transcript` - Classifies call type
   - `extract_prospecting_features` - Variation A (33 core + 10 prospecting fields)
   - `extract_discovery_features` - Variation B (33 core + 15 discovery fields)
   - `extract_demo_features` - Variation C (33 core + 25 demo fields)
   - `extract_proposal_features` - Variation D (33 core + 20 proposal fields)
   - `extract_technical_features` - Variation E (33 core + 30 technical fields)
   - `extract_customer_success_features` - Variation F (33 core + 20 CS fields)

3. **Targeting Rules:**
   - Routes transcripts to variations based on `variation_hint` context
   - Defaults to Variation B (Discovery) if no hint provided

## Core Fields (Included in ALL Variations)

Every extraction includes these 33 core fields:
- Basic metadata: transcript_id, customer_company_name, salesperson_name, etc.
- Sentiment scores: overall_sentiment_score, sentiment_about_product, etc.
- Text statistics: **transcript_word_count**, customer_word_count, customer_question_count
- Business signals: urgency_score, budget_confidence_score, next_steps_defined, etc.

## Troubleshooting

### Missing Fields in Extraction

If fields like `transcript_word_count` are missing:

1. **Check if tools were created properly:**
   ```bash
   python bootstrap/create_configs.py
   ```
   Look for success messages for each tool creation.

2. **Verify in LaunchDarkly Dashboard:**
   - Go to LaunchDarkly → AI Tools
   - Check that each extraction tool has ~45-60 fields (core + variation-specific)
   - Core fields should be present in ALL extraction tools

3. **Force recreate tools:**
   The bootstrap script automatically deletes and recreates tools, so just run it again:
   ```bash
   python bootstrap/create_configs.py
   ```

### LaunchDarkly Not Configured

If you see extraction happening but with minimal fields, LaunchDarkly may not be configured:

1. **Check environment variables:**
   ```bash
   # In .env file
   LAUNCHDARKLY_SDK_KEY=sdk-xxx-xxx
   LD_API_KEY=api-xxx-xxx
   LD_PROJECT_KEY=your-project
   ```

2. **Verify connection:**
   The app will log LaunchDarkly connection status on startup.

## Field Naming

The UI handles multiple field name variants:
- `transcript_word_count` (primary)
- `text_word_count` (fallback)
- `word_count` (fallback)

This ensures compatibility even if field names vary slightly.
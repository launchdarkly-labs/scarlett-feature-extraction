# Examples

This directory contains sample input transcripts and expected output formats to help you understand how the Sales Call Transcript Extractor works.

## 📁 Structure

```
examples/
├── input/              # Sample call transcripts
│   ├── prospecting-call.txt
│   ├── discovery-call.txt
│   └── demo-call.txt
└── output/             # Expected extraction results
    └── extracted-features.csv
```

## 📝 Input Examples

### prospecting-call.txt
- **Type**: Initial cold outreach
- **Features**: Basic qualification, pain point discovery
- **Expected Output**: 52 fields (42 core + 10 prospecting-specific)

### discovery-call.txt
- **Type**: Qualification and needs assessment
- **Features**: BANT qualification, detailed requirements gathering
- **Expected Output**: 57 fields (42 core + 15 discovery-specific)

### demo-call.txt
- **Type**: Product demonstration
- **Features**: Feature showcase, technical discussion, pricing hints
- **Expected Output**: 67 fields (42 core + 25 demo-specific)

## 📊 Output Format

The `extracted-features.csv` shows real examples of extracted data including:

- **Identity Fields**: Company name, salesperson, date/time
- **Business Context**: Deal stage, industry, estimated value
- **Sentiment Analysis**: Scores from -1 to +1 for various aspects
- **Engagement Metrics**: Customer engagement, urgency, budget confidence
- **Call Statistics**: Word counts, question counts, mention frequencies
- **Business Signals**: Next steps, competitors, decision makers
- **Call-Specific Fields**: Vary by call type (prospecting, discovery, demo, etc.)

## 🚀 Using These Examples

1. **Test the system**: Upload files from `input/` to verify extraction works
2. **Validate output**: Compare your results with `output/extracted-features.csv`
3. **Customize schemas**: Use these as templates for your own call types
4. **Train ML models**: The CSV output can be used to train the deal prediction model

## 💡 Tips

- Files should be plain text (.txt) or markdown (.md)
- Minimum 50 characters required for processing
- UTF-8 encoding supported with special characters
- Batch upload multiple files for efficiency
#!/usr/bin/env python3
"""
LaunchDarkly Sales Transcript Extraction Bootstrap Script

Creates AI Configs, variations, and tools for the sales transcript extraction pipeline.

Usage:
    1. Set LD_API_KEY environment variable
    2. Update PROJECT_KEY below to match your LaunchDarkly project
    3. Run: python bootstrap/create_configs.py
"""

import os
import requests
import json
import time
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
PROJECT_KEY = os.getenv("LD_PROJECT_KEY", "default")  # Change to your project key
API_KEY = os.getenv("LD_API_KEY")
BASE_URL = "https://app.launchdarkly.com"

class SalesTranscriptBootstrap:
    def __init__(self, api_key, project_key):
        self.api_key = api_key
        self.project_key = project_key
        self.headers = {
            "Authorization": api_key,
            "LD-API-Version": "beta",
            "Content-Type": "application/json"
        }

    def create_ai_config(self, config_key, config_name, mode="completion"):
        """Create a base AI Config in LaunchDarkly"""
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-configs"

        payload = {
            "key": config_key,
            "name": config_name,
            "mode": mode
        }

        print(f"   Creating AI Config '{config_key}' with mode={mode}...")
        response = requests.post(url, headers=self.headers, json=payload, timeout=30)

        if response.status_code in [200, 201]:
            print(f"   ✅ AI Config '{config_key}' created")
            time.sleep(0.5)
            return True
        elif response.status_code == 409:
            print(f"   ℹ️  AI Config '{config_key}' already exists")
            return True
        else:
            print(f"   ❌ Failed to create AI Config: {response.text[:200]}")
            return False

    def delete_tool(self, tool_key):
        """Delete a tool from LaunchDarkly"""
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-tools/{tool_key}"

        response = requests.delete(url, headers=self.headers, timeout=30)

        if response.status_code in [200, 204]:
            print(f"   🗑️  Tool '{tool_key}' deleted")
            time.sleep(0.5)
            return True
        elif response.status_code == 404:
            return True  # Already doesn't exist
        else:
            print(f"   ⚠️  Could not delete tool '{tool_key}': {response.status_code}")
            return False

    def create_tool(self, tool_key, tool_name, tool_description, tool_schema):
        """Create a tool in LaunchDarkly (delete first if exists)"""
        # Delete existing tool first to ensure clean state
        self.delete_tool(tool_key)

        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-tools"

        payload = {
            "key": tool_key,
            "name": tool_name,
            "description": tool_description,
            "schema": tool_schema,
            "type": "function"
        }

        print(f"   Creating tool '{tool_key}'...")
        response = requests.post(url, headers=self.headers, json=payload, timeout=30)

        if response.status_code in [200, 201]:
            print(f"   ✅ Tool '{tool_key}' created")
            time.sleep(0.5)
            return response.json()
        else:
            print(f"   ❌ Failed to create tool: {response.text[:200]}")
            return None

    def validate_tool_schema(self, tool_schema, required_core_fields):
        """Validate that a tool schema contains all required core fields"""
        if "parameters" not in tool_schema or "properties" not in tool_schema["parameters"]:
            return False, "Missing parameters or properties"

        properties = tool_schema["parameters"]["properties"]
        missing_fields = set(required_core_fields) - set(properties.keys())

        if missing_fields:
            return False, f"Missing core fields: {missing_fields}"

        return True, "OK"

    def create_variation(self, config_key, variation_data):
        """Create a variation in an AI Config"""
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-configs/{config_key}/variations"

        # Build payload  - for completion mode with tools, use system message not instructions
        tools = variation_data.get("tools", [])
        tool_refs = []
        for tool_key in tools:
            tool_refs.append({
                "key": tool_key,
                "version": 1
            })

        payload = {
            "key": variation_data["key"],
            "name": variation_data["name"],
            "messages": [
                {
                    "role": "system",
                    "content": variation_data["instructions"]
                }
            ],
            "tools": tool_refs,
            "modelConfigKey": variation_data.get("modelConfigKey")
        }

        print(f"   Creating variation '{variation_data['key']}'...")
        response = requests.post(url, headers=self.headers, json=payload, timeout=30)

        if response.status_code in [200, 201]:
            print(f"   ✅ Variation '{variation_data['key']}' created")
            time.sleep(0.5)
            return response.json()
        elif response.status_code == 409:
            print(f"   ℹ️  Variation '{variation_data['key']}' already exists")
            return None
        else:
            print(f"   ❌ Failed to create variation (HTTP {response.status_code})")
            print(f"   Response: {response.text}")
            return None

    def get_targeting_variation_map(self, config_key):
        """Get targeting variation IDs"""
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-configs/{config_key}/targeting"
        response = requests.get(url, headers=self.headers, timeout=30)

        if response.status_code == 200:
            targeting_data = response.json()
            targeting_variations = targeting_data.get("variations", [])

            variation_map = {}
            for variation in targeting_variations:
                if variation.get("name") == "disabled":
                    continue

                variation_value = variation.get("value", {})
                ld_meta = variation_value.get("_ldMeta", {})
                variation_key = ld_meta.get("variationKey")

                if variation_key:
                    variation_map[variation_key] = variation["_id"]

            return variation_map
        else:
            print(f"   ❌ Failed to fetch targeting data: {response.text[:200]}")
            return {}

    def update_targeting(self, config_key, variation_rules, default_variation):
        """Update targeting rules for an AI Config"""
        variation_map = self.get_targeting_variation_map(config_key)
        if not variation_map:
            print(f"   ❌ Could not get targeting variations for '{config_key}'")
            return False

        print(f"   Available variations: {list(variation_map.keys())}")

        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-configs/{config_key}/targeting"

        instructions = []

        # Add rules for variation hint routing
        for rule in variation_rules:
            variation_key = rule["variation"]
            variation_id = variation_map.get(variation_key)

            if not variation_id:
                print(f"   ⚠️  Variation '{variation_key}' not found in targeting")
                continue

            instruction = {
                "kind": "addRule",
                "clauses": rule["clauses"],
                "variationId": variation_id
            }
            instructions.append(instruction)
            print(f"   Adding rule: {rule['description']} → '{variation_key}'")

        # Set fallthrough (default) variation
        default_variation_id = variation_map.get(default_variation)
        if default_variation_id:
            instructions.append({
                "kind": "updateFallthroughVariationOrRollout",
                "variationId": default_variation_id
            })
            print(f"   Setting default variation: '{default_variation}'")

        payload = {
            "environmentKey": "production",
            "instructions": instructions
        }

        response = requests.patch(url, headers=self.headers, json=payload, timeout=30)

        if response.status_code == 200:
            print(f"   ✅ Targeting updated for '{config_key}'")
            return True
        else:
            print(f"   ❌ Failed to update targeting: {response.text[:200]}")
            return False


def main():
    print("=" * 80)
    print("🎯 SALES TRANSCRIPT EXTRACTION - LAUNCHDARKLY BOOTSTRAP")
    print("=" * 80)
    print()

    if not API_KEY:
        print("❌ LD_API_KEY environment variable not set")
        print("   Get your API key from: https://app.launchdarkly.com/settings/authorization")
        return

    print(f"📦 Project: {PROJECT_KEY}")
    print()

    # Initialize bootstrap
    bootstrap = SalesTranscriptBootstrap(API_KEY, PROJECT_KEY)

    # Load tool schemas from LAUNCHDARKLY_TOOLS.json
    tools_file = Path(__file__).parent.parent / "LAUNCHDARKLY_TOOLS.json"
    if not tools_file.exists():
        print(f"❌ LAUNCHDARKLY_TOOLS.json not found at {tools_file}")
        return

    with open(tools_file) as f:
        tools_data = json.load(f)

    print("=" * 80)
    print("STEP 0: Create Base AI Configs")
    print("=" * 80)
    print()

    print("📋 Creating base AI Configs...")
    bootstrap.create_ai_config(
        config_key="transcript-classification",
        config_name="Transcript Classification"
    )
    bootstrap.create_ai_config(
        config_key="sales-transcript-extraction",
        config_name="Sales Transcript Extraction"
    )

    print()
    print("=" * 80)
    print("STEP 1: Create Tools")
    print("=" * 80)
    print()

    # Create classification tool
    print("📋 Creating classification tool...")
    class_tool = tools_data["classification_tool"]["function"]
    bootstrap.create_tool(
        tool_key="classify_transcript",
        tool_name="Classify Transcript",
        tool_description=class_tool["description"],
        tool_schema=class_tool["parameters"]
    )

    # Define mandatory core fields for validation
    CORE_FIELDS_MANDATORY = [
        'transcript_id',
        'overall_sentiment_score',
        'sentiment_about_product',
        'sentiment_about_pricing',
        'sentiment_trajectory',
        'customer_engagement_score',
        'urgency_score',
        'budget_confidence_score',
        'next_steps_defined',
        'competitors_mentioned',
        'decision_makers_present',
        'transcript_word_count',
        'customer_word_count',
        'customer_question_count',
        'technical_term_count',
        'pricing_mention_count',
        'competitor_mention_count'
    ]

    # Create extraction tools for each variation
    # Get core fields to merge into each variation
    core_fields = tools_data["core_fields_schema"]

    tool_mapping = {
        "A": ("extract_prospecting_features", "Extract Prospecting Features", "variation_a_prospecting"),
        "B": ("extract_discovery_features", "Extract Discovery Features", "variation_b_discovery"),
        "C": ("extract_demo_features", "Extract Demo Features", "variation_c_demo"),
        "D": ("extract_proposal_features", "Extract Proposal Features", "variation_d_proposal"),
        "E": ("extract_technical_features", "Extract Technical Features", "variation_e_technical"),
        "F": ("extract_customer_success_features", "Extract Customer Success Features", "variation_f_customer_success"),
    }

    for var_letter, (tool_key, tool_name, schema_key) in tool_mapping.items():
        print(f"📋 Creating extraction tool for Variation {var_letter}...")
        tool_func = tools_data[schema_key]["function"]

        # Merge core fields + variation-specific fields
        # Core fields should come first, then variation-specific fields
        merged_properties = {**core_fields, **tool_func["parameters"]["properties"]}

        # Use the required fields from the variation (which already includes core fields)
        merged_schema = {
            "type": "object",
            "properties": merged_properties,
            "required": tool_func["parameters"]["required"]
        }

        # Validate merged schema has all mandatory core fields
        is_valid, message = bootstrap.validate_tool_schema({"parameters": merged_schema}, CORE_FIELDS_MANDATORY)
        if not is_valid:
            print(f"   ⚠️  WARNING: Variation {var_letter} - {message}")
            print(f"   Continuing anyway, but this may cause ML model issues...")

        bootstrap.create_tool(
            tool_key=tool_key,
            tool_name=tool_name,
            tool_description=tool_func["description"],
            tool_schema=merged_schema
        )

    print()
    print("=" * 80)
    print("STEP 2: Create AI Config Variations")
    print("=" * 80)
    print()

    # Classification config variations
    print("📋 Creating classification config variations...")
    classification_variations = [
        {
            "key": "fast",
            "name": "Fast Classification (Gemini 1.5 Flash)",
            "instructions": """Analyze the sales call transcript and classify it:

1. Determine call category (prospecting, discovery, demo, proposal, technical, customer success)
2. Assign primary variation letter (A-F) based on call type
3. Assess business context (deal value, company size, industry)
4. Identify complexity signals

Be accurate and concise. Output structured data only.""",
            "tools": ["classify_transcript"],
            "modelConfigKey": "gemini-2.5-flash"
        },
        {
            "key": "accurate",
            "name": "Accurate Classification (Gemini 1.5 Pro)",
            "instructions": """Analyze the sales call transcript with high accuracy:

1. Precisely determine call category and stage
2. Assign optimal variation letter (A-F)
3. Assess all business context dimensions
4. Evaluate complexity and signals

Prioritize accuracy over speed.""",
            "tools": ["classify_transcript"],
            "modelConfigKey": "gemini-2.5-pro"
        }
    ]

    for variation in classification_variations:
        bootstrap.create_variation("transcript-classification", variation)

    # Extraction config variations
    print()
    print("📋 Creating extraction config variations...")
    extraction_variations = [
        {
            "key": "variation-a",
            "name": "Variation A - Prospecting",
            "instructions": """Extract prospecting call features with focus on:
- Connection quality and outcome
- Interest level and pain points
- Callback scheduling
- Initial engagement signals

Be precise and evidence-based.""",
            "tools": ["extract_prospecting_features"],
            "modelConfigKey": "gemini-2.5-flash"
        },
        {
            "key": "variation-b",
            "name": "Variation B - Discovery/Qualification",
            "instructions": """Extract discovery call features using BANT framework:
- Budget confirmation and amount
- Authority level identification
- Need validation and pain points
- Timeline for decision and implementation

Focus on qualification signals.""",
            "tools": ["extract_discovery_features"],
            "modelConfigKey": "gemini-2.5-pro"
        },
        {
            "key": "variation-c",
            "name": "Variation C - Demo/Presentation",
            "instructions": """Extract demo call features focusing on:
- Features demonstrated and use cases
- Customer engagement and wow moments
- Technical fit and concerns
- Competitive comparisons
- Trial/POC requests

Assess demo effectiveness.""",
            "tools": ["extract_demo_features"],
            "modelConfigKey": "claude-3.5-sonnet"
        },
        {
            "key": "variation-d",
            "name": "Variation D - Proposal/Negotiation",
            "instructions": """Extract proposal review features:
- Pricing discussion and objections
- Negotiation points and terms
- Procurement process stage
- Legal/security reviews
- Close probability and blockers

Focus on deal closing signals.""",
            "tools": ["extract_proposal_features"],
            "modelConfigKey": "claude-3.5-sonnet"
        },
        {
            "key": "variation-e",
            "name": "Variation E - Technical/SE",
            "instructions": """Extract technical call features:
- Architecture and deployment requirements
- Integration points and APIs
- Security, compliance, scalability
- POC scope and success criteria
- Implementation complexity

Assess technical fit and risk.""",
            "tools": ["extract_technical_features"],
            "modelConfigKey": "claude-3.5-sonnet"
        },
        {
            "key": "variation-f",
            "name": "Variation F - Customer Success",
            "instructions": """Extract customer success call features:
- Account health and satisfaction
- Product adoption and usage
- Renewal likelihood and risks
- Expansion opportunities
- ROI and success stories

Focus on retention signals.""",
            "tools": ["extract_customer_success_features"],
            "modelConfigKey": "gemini-2.5-pro"
        }
    ]

    for variation in extraction_variations:
        bootstrap.create_variation("sales-transcript-extraction", variation)

    print()
    print("=" * 80)
    print("STEP 3: Setup Targeting Rules")
    print("=" * 80)
    print()

    # Classification targeting (default to fast)
    print("📋 Setting up classification targeting...")
    bootstrap.update_targeting(
        config_key="transcript-classification",
        variation_rules=[],  # No special rules, just default
        default_variation="fast"
    )

    # Extraction targeting (route based on variation_hint)
    print()
    print("📋 Setting up extraction targeting...")
    extraction_rules = [
        {
            "description": "Route to Variation A if variation_hint = A",
            "variation": "variation-a",
            "clauses": [{
                "attribute": "variation_hint",
                "op": "in",
                "values": ["A"],
                "contextKind": "transcript"
            }]
        },
        {
            "description": "Route to Variation B if variation_hint = B",
            "variation": "variation-b",
            "clauses": [{
                "attribute": "variation_hint",
                "op": "in",
                "values": ["B"],
                "contextKind": "transcript"
            }]
        },
        {
            "description": "Route to Variation C if variation_hint = C",
            "variation": "variation-c",
            "clauses": [{
                "attribute": "variation_hint",
                "op": "in",
                "values": ["C"],
                "contextKind": "transcript"
            }]
        },
        {
            "description": "Route to Variation D if variation_hint = D",
            "variation": "variation-d",
            "clauses": [{
                "attribute": "variation_hint",
                "op": "in",
                "values": ["D"],
                "contextKind": "transcript"
            }]
        },
        {
            "description": "Route to Variation E if variation_hint = E",
            "variation": "variation-e",
            "clauses": [{
                "attribute": "variation_hint",
                "op": "in",
                "values": ["E"],
                "contextKind": "transcript"
            }]
        },
        {
            "description": "Route to Variation F if variation_hint = F",
            "variation": "variation-f",
            "clauses": [{
                "attribute": "variation_hint",
                "op": "in",
                "values": ["F"],
                "contextKind": "transcript"
            }]
        }
    ]

    bootstrap.update_targeting(
        config_key="sales-transcript-extraction",
        variation_rules=extraction_rules,
        default_variation="variation-b"  # Default to discovery if no hint
    )

    print()
    print("=" * 80)
    print("✨ BOOTSTRAP COMPLETE!")
    print("=" * 80)
    print()
    print("Next steps:")
    print("  1. Check LaunchDarkly dashboard to verify configurations")
    print("  2. Test with sample transcripts: python scripts/batch_extract_folder.py")
    print("  3. Monitor usage and costs in LaunchDarkly")
    print()
    print("💡 All schemas are now in LaunchDarkly - modify them there, not in code!")

if __name__ == "__main__":
    main()

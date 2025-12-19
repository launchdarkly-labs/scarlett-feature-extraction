#!/usr/bin/env python3
"""
Fix targeting rules for sales-transcript-extraction AI Config
Adds missing rules for variations A and B, and sets default to variation-b
"""

import os
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

PROJECT_KEY = os.getenv("LD_PROJECT_KEY", "default")
API_KEY = os.getenv("LD_API_KEY")
BASE_URL = "https://app.launchdarkly.com"

def get_targeting_variation_map(api_key, project_key, config_key):
    """Get targeting variation IDs"""
    url = f"{BASE_URL}/api/v2/projects/{project_key}/ai-configs/{config_key}/targeting"
    headers = {
        "Authorization": api_key,
        "LD-API-Version": "beta",
        "Content-Type": "application/json"
    }

    response = requests.get(url, headers=headers, timeout=30)

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
        print(f"❌ Failed to fetch targeting data: {response.text[:200]}")
        return {}

def add_targeting_rules(api_key, project_key, config_key):
    """Add targeting rules for variations A and B, set default to variation-b"""
    headers = {
        "Authorization": api_key,
        "LD-API-Version": "beta",
        "Content-Type": "application/json"
    }

    # Get variation IDs
    variation_map = get_targeting_variation_map(api_key, project_key, config_key)
    if not variation_map:
        print("❌ Could not get targeting variations")
        return False

    print(f"Available variations: {list(variation_map.keys())}")

    # Get IDs for variations A, B
    var_a_id = variation_map.get("variation-a")
    var_b_id = variation_map.get("variation-b")

    if not var_a_id or not var_b_id:
        print("❌ Could not find variation-a or variation-b")
        return False

    url = f"{BASE_URL}/api/v2/projects/{project_key}/ai-configs/{config_key}/targeting"

    instructions = [
        # Add rule for variation A
        {
            "kind": "addRule",
            "clauses": [{
                "attribute": "variation_hint",
                "op": "in",
                "values": ["A"],
                "contextKind": "transcript"
            }],
            "variationId": var_a_id
        },
        # Add rule for variation B
        {
            "kind": "addRule",
            "clauses": [{
                "attribute": "variation_hint",
                "op": "in",
                "values": ["B"],
                "contextKind": "transcript"
            }],
            "variationId": var_b_id
        },
        # Set default to variation-b
        {
            "kind": "updateFallthroughVariationOrRollout",
            "variationId": var_b_id
        }
    ]

    payload = {
        "environmentKey": "production",
        "instructions": instructions
    }

    print("\nAdding targeting rules...")
    print(f"  - Rule: variation_hint = A → Variation A")
    print(f"  - Rule: variation_hint = B → Variation B")
    print(f"  - Default: Variation B")

    response = requests.patch(url, headers=headers, json=payload, timeout=30)

    if response.status_code == 200:
        print("\n✅ Targeting rules added successfully!")
        return True
    else:
        print(f"\n❌ Failed to add targeting rules: {response.text[:500]}")
        return False

if __name__ == "__main__":
    print("=" * 80)
    print("🔧 FIXING TARGETING RULES FOR SALES-TRANSCRIPT-EXTRACTION")
    print("=" * 80)
    print()

    if not API_KEY:
        print("❌ LD_API_KEY environment variable not set")
        exit(1)

    print(f"📦 Project: {PROJECT_KEY}")
    print(f"🎯 Config: sales-transcript-extraction")
    print()

    success = add_targeting_rules(API_KEY, PROJECT_KEY, "sales-transcript-extraction")

    if success:
        print("\n✨ Done! Try uploading transcripts again.")
    else:
        print("\n❌ Failed to fix targeting rules. Check the error above.")

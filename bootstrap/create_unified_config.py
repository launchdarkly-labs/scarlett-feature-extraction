#!/usr/bin/env python3
"""
LaunchDarkly Unified Transcript Extraction Bootstrap Script

Creates a SINGLE AI Config with multiple tools for simplified extraction.

Usage:
    1. Set LD_API_KEY environment variable
    2. Update PROJECT_KEY below to match your LaunchDarkly project
    3. Run: python bootstrap/create_unified_config.py
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
PROJECT_KEY = os.getenv("LD_PROJECT_KEY", "default")
API_KEY = os.getenv("LD_API_KEY")
BASE_URL = "https://app.launchdarkly.com"


def _request(method, url, retries=5, **kwargs):
    """requests.request, retried on 429 so a rate limit can't silently drop a tool."""
    for attempt in range(retries + 1):
        response = requests.request(method, url, **kwargs)
        if response.status_code != 429 or attempt == retries:
            return response
        reset_ms = response.headers.get("X-Ratelimit-Reset")
        wait = max(0.0, int(reset_ms) / 1000 - time.time()) if reset_ms else 2 ** attempt
        print(f"   ⏳ Rate limited, retrying in {wait:.1f}s")
        time.sleep(min(wait, 30) + 0.5)


class UnifiedBootstrap:
    def __init__(self, api_key, project_key):
        self.api_key = api_key
        self.project_key = project_key
        self.headers = {
            "Authorization": api_key,
            "LD-API-Version": "beta",
            "Content-Type": "application/json"
        }

    def list_ai_configs(self):
        """List all AI configs in the project"""
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-configs"
        response = _request("GET", url, headers=self.headers, timeout=30)

        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list):
                return data
            else:
                return data.get("items", [])
        else:
            return []

    def delete_ai_config(self, config_key):
        """Delete an AI config"""
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-configs/{config_key}"
        response = _request("DELETE", url, headers=self.headers, timeout=30)

        if response.status_code in [200, 204]:
            print(f"   🗑️  AI Config '{config_key}' deleted")
            time.sleep(0.5)
            return True
        elif response.status_code == 404:
            return True
        else:
            print(f"   ⚠️  Could not delete '{config_key}': {response.status_code}")
            return False

    def list_tools(self):
        """List all tools"""
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-tools"
        response = _request("GET", url, headers=self.headers, timeout=30)

        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list):
                return data
            else:
                return data.get("items", [])
        else:
            return []

    def delete_tool(self, tool_key):
        """Delete a tool"""
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-tools/{tool_key}"
        response = _request("DELETE", url, headers=self.headers, timeout=30)

        if response.status_code in [200, 204]:
            print(f"   🗑️  Tool '{tool_key}' deleted")
            time.sleep(0.5)
            return True
        elif response.status_code == 404:
            return True
        else:
            return False

    def cleanup(self, config_key, tool_keys):
        """Delete this script's own AI config and tools so a re-run starts clean.

        Only the keys passed in are touched: the project may hold other AI
        configs and tools that have nothing to do with this pipeline.
        """
        print("🧹 Cleaning up old configurations...")
        print()

        existing_configs = {c.get("key") for c in self.list_ai_configs()}
        if config_key in existing_configs:
            self.delete_ai_config(config_key)
        else:
            print(f"   No existing AI config '{config_key}'")

        print()

        existing_tools = {t.get("key") for t in self.list_tools()}
        stale_tools = [key for key in tool_keys if key in existing_tools]
        if stale_tools:
            print(f"   Found {len(stale_tools)} tools to delete")
            for tool_key in stale_tools:
                self.delete_tool(tool_key)
        else:
            print("   No existing tools found")

        print()
        print("   ✅ Cleanup complete")
        print()

    def create_ai_config(self, config_key, config_name):
        """Create a base AI Config"""
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-configs"

        payload = {
            "key": config_key,
            "name": config_name,
            "mode": "completion"
        }

        print(f"   Creating AI Config '{config_key}'...")
        response = _request("POST", url, headers=self.headers, json=payload, timeout=30)

        if response.status_code in [200, 201]:
            print(f"   ✅ AI Config '{config_key}' created")
            time.sleep(0.5)
            return True
        elif response.status_code == 409:
            print(f"   ℹ️  AI Config '{config_key}' already exists")
            return True
        else:
            print(f"   ❌ Failed: {response.text[:200]}")
            return False

    def create_tool(self, tool_key, tool_name, tool_description, tool_schema):
        """Create a tool"""
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-tools"

        payload = {
            "key": tool_key,
            "name": tool_name,
            "description": tool_description,
            "schema": tool_schema,
            "type": "function"
        }

        print(f"   Creating tool '{tool_key}'...")
        response = _request("POST", url, headers=self.headers, json=payload, timeout=30)

        if response.status_code in [200, 201]:
            print(f"   ✅ Tool '{tool_key}' created")
            time.sleep(0.5)
            return True
        else:
            print(f"   ❌ Failed: {response.text[:200]}")
            return False

    def create_variation_with_all_tools(self, config_key, tool_keys, model_config_key):
        """Create a single variation with all tools attached"""
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-configs/{config_key}/variations"

        # Build tool references
        tool_refs = [{"key": tool_key, "version": 1} for tool_key in tool_keys]

        payload = {
            "key": "unified",
            "name": "Unified Extraction (All Tools)",
            "messages": [
                {
                    "role": "system",
                    "content": """You are a sales transcript analyzer. You MUST call exactly ONE tool to extract structured data from the sales call transcript.

Available tools:
- **extract_prospecting_features**: Call for cold outreach, first contact, gatekeeper conversations, connection attempts
- **extract_discovery_features**: Call for needs assessment, qualification calls, BANT qualification, pain point identification
- **extract_demo_features**: Call for product demonstrations, feature walkthroughs, technical presentations, proof of concept
- **extract_proposal_features**: Call for pricing discussions, contract negotiations, commercial terms, discount requests
- **extract_technical_features**: Call for architecture reviews, integration planning, technical deep-dives, security discussions
- **extract_customer_success_features**: Call for quarterly business reviews, renewal discussions, expansion opportunities, account health checks

IMPORTANT: You must CALL the most appropriate tool based on the transcript content. Do NOT respond with text - CALL A TOOL with all required fields filled out."""
                }
            ],
            "tools": tool_refs,
            "modelConfigKey": model_config_key
        }

        print(f"   Creating unified variation with {len(tool_keys)} tools...")
        response = _request("POST", url, headers=self.headers, json=payload, timeout=30)

        if response.status_code in [200, 201]:
            print(f"   ✅ Unified variation created")
            time.sleep(0.5)
            return True
        elif response.status_code == 409:
            print(f"   ℹ️  Variation already exists")
            return True
        else:
            print(f"   ❌ Failed: {response.text[:300]}")
            return False

    def set_default_variation(self, config_key):
        """Set the unified variation as default"""
        # First get the variation ID
        url = f"{BASE_URL}/api/v2/projects/{self.project_key}/ai-configs/{config_key}/targeting"
        response = _request("GET", url, headers=self.headers, timeout=30)

        if response.status_code != 200:
            print(f"   ⚠️  Could not get targeting info")
            return False

        targeting_data = response.json()
        variations = targeting_data.get("variations", [])

        unified_id = None
        for var in variations:
            value = var.get("value", {})
            meta = value.get("_ldMeta", {})
            if meta.get("variationKey") == "unified":
                unified_id = var["_id"]
                break

        if not unified_id:
            print(f"   ⚠️  Could not find unified variation ID")
            return False

        # Update targeting to use unified as default
        payload = {
            "environmentKey": "production",
            "instructions": [
                {
                    "kind": "updateFallthroughVariationOrRollout",
                    "variationId": unified_id
                }
            ]
        }

        response = _request("PATCH", url, headers=self.headers, json=payload, timeout=30)

        if response.status_code == 200:
            print(f"   ✅ Targeting updated - unified variation set as default")
            return True
        else:
            print(f"   ⚠️  Failed to update targeting: {response.text[:200]}")
            return False


def main():
    print("=" * 80)
    print("🎯 UNIFIED TRANSCRIPT EXTRACTION - LAUNCHDARKLY BOOTSTRAP")
    print("=" * 80)
    print()

    if not API_KEY:
        print("❌ LD_API_KEY environment variable not set")
        return

    print(f"📦 Project: {PROJECT_KEY}")
    print()

    bootstrap = UnifiedBootstrap(API_KEY, PROJECT_KEY)

    # Load tool schemas
    tools_file = Path(__file__).parent.parent / "LAUNCHDARKLY_TOOLS.json"
    if not tools_file.exists():
        print(f"❌ LAUNCHDARKLY_TOOLS.json not found at {tools_file}")
        return

    with open(tools_file) as f:
        tools_data = json.load(f)

    tool_mapping = {
        "extract_prospecting_features": ("Extract Prospecting Features", "variation_a_prospecting"),
        "extract_discovery_features": ("Extract Discovery Features", "variation_b_discovery"),
        "extract_demo_features": ("Extract Demo Features", "variation_c_demo"),
        "extract_proposal_features": ("Extract Proposal Features", "variation_d_proposal"),
        "extract_technical_features": ("Extract Technical Features", "variation_e_technical"),
        "extract_customer_success_features": ("Extract Customer Success Features", "variation_f_customer_success"),
    }

    print("=" * 80)
    print("STEP 1: Clean Up Old Configurations")
    print("=" * 80)
    print()
    bootstrap.cleanup("transcript-extraction-unified", list(tool_mapping))

    print("=" * 80)
    print("STEP 2: Create Unified AI Config")
    print("=" * 80)
    print()
    bootstrap.create_ai_config(
        config_key="transcript-extraction-unified",
        config_name="Transcript Extraction (Unified)"
    )

    print()
    print("=" * 80)
    print("STEP 3: Create Extraction Tools")
    print("=" * 80)
    print()

    # Get core fields
    core_fields = tools_data["core_fields_schema"]

    created_tools = []
    for tool_key, (tool_name, schema_key) in tool_mapping.items():
        tool_func = tools_data[schema_key]["function"]

        # Merge core + variation fields
        merged_properties = {**core_fields, **tool_func["parameters"]["properties"]}
        merged_schema = {
            "type": "object",
            "properties": merged_properties,
            "required": tool_func["parameters"]["required"]
        }

        success = bootstrap.create_tool(
            tool_key=tool_key,
            tool_name=tool_name,
            tool_description=tool_func["description"],
            tool_schema=merged_schema
        )

        if success:
            created_tools.append(tool_key)

    print()
    print("=" * 80)
    print("STEP 4: Create Unified Variation")
    print("=" * 80)
    print()

    bootstrap.create_variation_with_all_tools(
        config_key="transcript-extraction-unified",
        tool_keys=created_tools,
        # Any model the Vercel AI Gateway serves works; this one is on its free tier.
        model_config_key="OpenAI.gpt-4o-mini"
    )

    print()
    print("=" * 80)
    print("STEP 5: Set Default Variation")
    print("=" * 80)
    print()

    bootstrap.set_default_variation("transcript-extraction-unified")

    print()
    print("=" * 80)
    print("✨ BOOTSTRAP COMPLETE!")
    print("=" * 80)
    print()
    print("Created:")
    print(f"  • 1 AI Config: transcript-extraction-unified")
    print(f"  • {len(created_tools)} of {len(tool_mapping)} extraction tools")
    print(f"  • 1 variation with those tools attached")
    print()
    if len(created_tools) < len(tool_mapping):
        missing = sorted(set(tool_mapping) - set(created_tools))
        print(f"⚠️  Missing tools: {', '.join(missing)}. Re-run this script.")
    else:
        print("The model classifies each transcript's call_category; the pipeline extracts with that category's tool schema.")

if __name__ == "__main__":
    main()

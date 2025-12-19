/**
 * Variation Mapping Configuration
 * Maps call categories (from classification) to extraction variations (A-F)
 */

export type VariationLetter = "A" | "B" | "C" | "D" | "E" | "F";

export const CATEGORY_TO_VARIATION: Record<string, VariationLetter> = {
  // Prospecting / TOFU → Variation A
  prospecting_outbound: "A",
  prospecting_emea: "A",
  top_of_funnel_all: "A",
  tofu_converted_pipeline: "A",
  outbound_under_5_min: "A",

  // Discovery / Qualification → Variation B
  early_stage_post_rko: "B",
  emea_early_stage: "B",
  qualification_booked: "B",

  // Demo / Presentation → Variation C
  further_stages_connected: "C",
  deal_deck_adoption: "C",
  click_through_demo: "C",

  // Technical / SE → Variation E
  solutions_engineering: "E",
  technology_migrations: "E",
  professional_services: "E",

  // Customer Success / QBR → Variation F
  customer_success: "F",
  qbr_calls: "F",

  // Research / Feedback → Variation B
  product_research: "B",
  genai: "B",
  enablement_library: "B",
  value_framework: "B",

  // Internal → Variation B
  internal_certification: "B",

  // Other → Variation B (default)
  other: "B",
};

export interface VariationMetadata {
  name: string;
  description: string;
  model: string;
  cost_per_call: number;
  field_count: number;
  use_cases: string[];
}

export const VARIATION_METADATA: Record<VariationLetter, VariationMetadata> = {
  A: {
    name: "Prospecting / TOFU",
    description: "Early outreach, cold calls, first contact",
    model: "google/gemini-2.0-flash-exp",
    cost_per_call: 0.001,
    field_count: 43,
    use_cases: [
      "Cold outreach",
      "First touch prospecting",
      "Gatekeeper conversations",
      "Quick qualification",
    ],
  },
  B: {
    name: "Discovery / Qualification",
    description: "Needs assessment, BANT qualification",
    model: "google/gemini-2.0-flash-thinking-exp-01-21",
    cost_per_call: 0.01,
    field_count: 48,
    use_cases: [
      "Discovery calls",
      "Needs assessment",
      "BANT qualification",
      "Pain point identification",
    ],
  },
  C: {
    name: "Demo / Presentation",
    description: "Product demonstrations, technical showcases",
    model: "anthropic/claude-3-7-sonnet-latest",
    cost_per_call: 0.03,
    field_count: 58,
    use_cases: [
      "Product demos",
      "Feature walkthroughs",
      "Technical presentations",
      "Proof of concept discussions",
    ],
  },
  D: {
    name: "Proposal / Negotiation",
    description: "Pricing discussions, commercial terms",
    model: "anthropic/claude-3-7-sonnet-latest",
    cost_per_call: 0.03,
    field_count: 53,
    use_cases: [
      "Pricing discussions",
      "Contract negotiations",
      "Commercial terms",
      "Discount requests",
    ],
  },
  E: {
    name: "Technical / Solutions Engineering",
    description: "Architecture reviews, technical deep-dives",
    model: "anthropic/claude-3-7-sonnet-latest",
    cost_per_call: 0.03,
    field_count: 63,
    use_cases: [
      "Technical architecture review",
      "Integration planning",
      "Security discussions",
      "Implementation scoping",
    ],
  },
  F: {
    name: "Customer Success / QBR",
    description: "Existing customer check-ins, renewals",
    model: "google/gemini-2.0-flash-thinking-exp-01-21",
    cost_per_call: 0.01,
    field_count: 53,
    use_cases: [
      "Quarterly business reviews",
      "Renewal discussions",
      "Expansion opportunities",
      "Customer health checks",
    ],
  },
};

export function getVariationForCategory(callCategory: string): VariationLetter {
  return CATEGORY_TO_VARIATION[callCategory] || "B";
}

export function getVariationMetadata(variation: VariationLetter): VariationMetadata {
  return VARIATION_METADATA[variation];
}

export function estimateCost(variation: VariationLetter, callCount: number): number {
  const metadata = getVariationMetadata(variation);
  return metadata.cost_per_call * callCount;
}

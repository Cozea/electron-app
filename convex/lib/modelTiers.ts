/**
 * Model Tiers Configuration
 *
 * Defines the model catalog, tiers, and credit calculation logic
 * per CrossCode Pricing Spec v3.
 *
 * Model Tiers:
 * - Fast: 1 input / 2 output credits per 1K tokens
 * - Standard: 5 input / 10 output credits per 1K tokens
 * - Powerful: 25 input / 50 output credits per 1K tokens
 */

export type ModelTier = "fast" | "standard" | "powerful"
export type Provider = "anthropic" | "openai" | "google"

export interface TierRates {
  inputCreditsPerK: number
  outputCreditsPerK: number
}

export interface ModelInfo {
  id: string
  displayName: string
  provider: Provider
  tier: ModelTier
  // Provider-specific model ID (for API calls)
  providerModelId: string
  // Whether this model is available (can be disabled per plan)
  isAvailable: boolean
}

// Credit rates per 1K tokens by tier
export const TIER_RATES: Record<ModelTier, TierRates> = {
  fast: {
    inputCreditsPerK: 1,
    outputCreditsPerK: 2,
  },
  standard: {
    inputCreditsPerK: 5,
    outputCreditsPerK: 10,
  },
  powerful: {
    inputCreditsPerK: 25,
    outputCreditsPerK: 50,
  },
}

// Model catalog - maps our model IDs to provider model IDs and tiers
export const MODEL_CATALOG: Record<string, ModelInfo> = {
  // ============================================
  // FAST TIER (1 input / 2 output per 1K)
  // Available: Pro and above (or BYOK)
  // ============================================
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    provider: "anthropic",
    tier: "fast",
    providerModelId: "claude-haiku-4-5-20251001",
    isAvailable: true,
  },
  "gemini-3-flash": {
    id: "gemini-3-flash",
    displayName: "Gemini 3 Flash",
    provider: "google",
    tier: "fast",
    providerModelId: "gemini-3-flash-preview",
    isAvailable: true,
  },

  // ============================================
  // STANDARD TIER (5 input / 10 output per 1K)
  // Available: Pro and above (or BYOK)
  // ============================================
  "gpt-5.1": {
    id: "gpt-5.1",
    displayName: "GPT-5.1",
    provider: "openai",
    tier: "standard",
    providerModelId: "gpt-5.1",
    isAvailable: true,
  },
  "gpt-5.1-mini": {
    id: "gpt-5.1-mini",
    displayName: "GPT-5.1 Mini",
    provider: "openai",
    tier: "standard",
    providerModelId: "gpt-5-mini",
    isAvailable: true,
  },
  "claude-sonnet-4-5": {
    id: "claude-sonnet-4-5",
    displayName: "Claude Sonnet 4.5",
    provider: "anthropic",
    tier: "standard",
    providerModelId: "claude-sonnet-4-5-20250929",
    isAvailable: true,
  },

  // ============================================
  // POWERFUL TIER (25 input / 50 output per 1K)
  // Available: Max and above (or BYOK if allowed)
  // ============================================
  "gpt-5.2": {
    id: "gpt-5.2",
    displayName: "GPT-5.2",
    provider: "openai",
    tier: "powerful",
    providerModelId: "gpt-5.2",
    isAvailable: true,
  },
  "claude-opus-4-5": {
    id: "claude-opus-4-5",
    displayName: "Claude Opus 4.5",
    provider: "anthropic",
    tier: "powerful",
    providerModelId: "claude-opus-4-5-20251101",
    isAvailable: true,
  },
  "gemini-3-pro": {
    id: "gemini-3-pro",
    displayName: "Gemini 3 Pro",
    provider: "google",
    tier: "powerful",
    providerModelId: "gemini-3-pro-preview",
    isAvailable: true,
  },
}

// Plan-based tier access
export const PLAN_TIER_ACCESS: Record<string, ModelTier[]> = {
  free: [], // BYOK only - no managed tiers
  pro: ["fast", "standard"],
  max: ["fast", "standard", "powerful"],
  team: ["fast", "standard", "powerful"],
  enterprise: ["fast", "standard", "powerful"],
}

// Plan credits per month
export const PLAN_CREDITS: Record<string, number> = {
  free: 0,
  pro: 5000,
  max: 15000,
  team: 10000, // Per seat
  enterprise: 0, // Custom
}

// Overage rates (cents per credit)
export const OVERAGE_RATES: Record<string, number> = {
  free: 0, // No overage allowed
  pro: 1.0, // $0.01/credit
  max: 0.8, // $0.008/credit
  team: 0.6, // $0.006/credit
  enterprise: 0, // Custom
}

// Credit pack definitions
export const CREDIT_PACKS = {
  starter: { credits: 1000, priceCents: 1200, expirationMonths: 12 },
  plus: { credits: 5000, priceCents: 5000, expirationMonths: 12 },
  pro: { credits: 15000, priceCents: 12000, expirationMonths: 12 },
  max: { credits: 50000, priceCents: 35000, expirationMonths: 12 },
} as const

export type CreditPackType = keyof typeof CREDIT_PACKS

/**
 * Get the model tier for a given model ID
 */
export function getModelTier(modelId: string): ModelTier {
  const model = MODEL_CATALOG[modelId]
  if (model) {
    return model.tier
  }

  // Fallback: try to infer from model name patterns
  const lowerModelId = modelId.toLowerCase()

  if (lowerModelId.includes("haiku") || lowerModelId.includes("flash") || lowerModelId.includes("mini")) {
    return "fast"
  }

  if (lowerModelId.includes("opus") || lowerModelId.includes("pro") || lowerModelId.includes("5.2")) {
    return "powerful"
  }

  // Default to standard tier for unknown models
  return "standard"
}

/**
 * Get the provider for a given model ID
 */
export function getModelProvider(modelId: string): Provider {
  const model = MODEL_CATALOG[modelId]
  if (model) {
    return model.provider
  }

  // Fallback: infer from model name
  const lowerModelId = modelId.toLowerCase()

  if (lowerModelId.includes("claude") || lowerModelId.includes("anthropic")) {
    return "anthropic"
  }

  if (lowerModelId.includes("gpt") || lowerModelId.includes("openai")) {
    return "openai"
  }

  if (lowerModelId.includes("gemini") || lowerModelId.includes("google")) {
    return "google"
  }

  // Default to OpenAI for unknown models
  return "openai"
}

/**
 * Get the provider-specific model ID for API calls
 */
export function getProviderModelId(modelId: string): string {
  const model = MODEL_CATALOG[modelId]
  return model?.providerModelId ?? modelId
}

/**
 * Calculate credits for a given request
 *
 * Formula: ceil(inputTokens/1000) * inputRate + ceil(outputTokens/1000) * outputRate
 *
 * Uses ceiling to ensure micro-requests don't become effectively free.
 */
export function calculateCredits(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const tier = getModelTier(modelId)
  const rates = TIER_RATES[tier]

  const inputCredits = Math.ceil(inputTokens / 1000) * rates.inputCreditsPerK
  const outputCredits = Math.ceil(outputTokens / 1000) * rates.outputCreditsPerK

  return inputCredits + outputCredits
}

/**
 * Calculate credits with detailed breakdown
 */
export function calculateCreditsDetailed(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): {
  total: number
  inputCredits: number
  outputCredits: number
  tier: ModelTier
  rates: TierRates
} {
  const tier = getModelTier(modelId)
  const rates = TIER_RATES[tier]

  const inputCredits = Math.ceil(inputTokens / 1000) * rates.inputCreditsPerK
  const outputCredits = Math.ceil(outputTokens / 1000) * rates.outputCreditsPerK

  return {
    total: inputCredits + outputCredits,
    inputCredits,
    outputCredits,
    tier,
    rates,
  }
}

/**
 * Get the overage rate for a plan (cents per credit)
 */
export function getOverageRate(plan: string): number {
  return OVERAGE_RATES[plan] ?? 0
}

/**
 * Check if a plan allows overage
 */
export function planAllowsOverage(plan: string): boolean {
  return plan !== "free" && OVERAGE_RATES[plan] > 0
}

/**
 * Check if a model tier is accessible for a given plan
 */
export function isTierAccessible(plan: string, tier: ModelTier): boolean {
  const allowedTiers = PLAN_TIER_ACCESS[plan] ?? []
  return allowedTiers.includes(tier)
}

/**
 * Check if a specific model is accessible for a given plan
 */
export function isModelAccessible(plan: string, modelId: string): boolean {
  const tier = getModelTier(modelId)
  return isTierAccessible(plan, tier)
}

/**
 * Get all models accessible for a given plan
 */
export function getAccessibleModels(plan: string): ModelInfo[] {
  const allowedTiers = PLAN_TIER_ACCESS[plan] ?? []

  return Object.values(MODEL_CATALOG).filter(
    (model) => model.isAvailable && allowedTiers.includes(model.tier)
  )
}

/**
 * Get models grouped by tier for display
 */
export function getModelsByTier(): Record<ModelTier, ModelInfo[]> {
  const result: Record<ModelTier, ModelInfo[]> = {
    fast: [],
    standard: [],
    powerful: [],
  }

  for (const model of Object.values(MODEL_CATALOG)) {
    if (model.isAvailable) {
      result[model.tier].push(model)
    }
  }

  return result
}

/**
 * Get the monthly credit allocation for a plan
 */
export function getPlanCredits(plan: string, seatCount?: number): number {
  const baseCredits = PLAN_CREDITS[plan] ?? 0

  if (plan === "team" && seatCount) {
    return baseCredits * seatCount
  }

  return baseCredits
}

/**
 * Estimate credits for a request (before execution)
 * Uses conservative estimates for output tokens
 */
export function estimateCredits(
  modelId: string,
  inputTokens: number,
  estimatedOutputTokens: number = 500
): number {
  return calculateCredits(modelId, inputTokens, estimatedOutputTokens)
}

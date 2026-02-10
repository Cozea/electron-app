export interface ModelOption {
  id: string
  name: string
  chef: string
  chefSlug: string
  tier: string
  providers: string[]
}

// Model catalog per CrossCode Pricing Spec v3
// Tiers: Fast (1/2 credits), Standard (5/10 credits), Powerful (25/50 credits)
export const DEFAULT_MODELS: ModelOption[] = [
  // ============================================
  // FAST TIER - 1 input / 2 output credits per 1K tokens
  // ============================================
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'fast',
    providers: ['anthropic'],
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'fast',
    providers: ['google'],
  },
  // ============================================
  // STANDARD TIER - 5 input / 10 output credits per 1K tokens
  // ============================================
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'standard',
    providers: ['openai'],
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'standard',
    providers: ['anthropic'],
  },
  // ============================================
  // POWERFUL TIER - 25 input / 50 output credits per 1K tokens
  // ============================================
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'powerful',
    providers: ['openai'],
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'powerful',
    providers: ['anthropic'],
  },
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'powerful',
    providers: ['google'],
  },
]


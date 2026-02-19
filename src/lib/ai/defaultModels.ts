export interface ModelOption {
  id: string
  name: string
  chef: string
  chefSlug: string
  tier: string
  providers: string[]
}

// Curated model catalog used for initial UI defaults.
export const DEFAULT_MODELS: ModelOption[] = [
  // Fast tier
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'fast',
    providers: ['google'],
  },
  // Standard tier
  {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT-5.1-Codex-Mini',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'standard',
    providers: ['openai'],
  },
  // Powerful tier
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3-Codex',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'powerful',
    providers: ['openai'],
  },
  {
    id: 'gpt-5.2-codex',
    name: 'GPT-5.2-Codex',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'powerful',
    providers: ['openai'],
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT-5.1-Codex-Max',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'powerful',
    providers: ['openai'],
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'powerful',
    providers: ['openai'],
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

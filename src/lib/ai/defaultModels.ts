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
  // Standard tier
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'standard',
    providers: ['anthropic'],
  },
  {
    id: 'grok-code-fast-1',
    name: 'Grok Code Fast 1',
    chef: 'xAI',
    chefSlug: 'xai',
    tier: 'standard',
    providers: ['xai'],
  },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT-5.1-Codex-Mini',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'standard',
    providers: ['openai'],
  },
  {
    id: 'copilot-gpt-4.1',
    name: 'GitHub Copilot GPT-4.1',
    chef: 'GitHub Copilot',
    chefSlug: 'github-copilot',
    tier: 'standard',
    providers: ['github-copilot'],
  },
  {
    id: 'gitlab-duo-agentic',
    name: 'GitLab Duo Agentic Chat',
    chef: 'GitLab',
    chefSlug: 'gitlab',
    tier: 'standard',
    providers: ['gitlab'],
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
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'powerful',
    providers: ['anthropic'],
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
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
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'powerful',
    providers: ['google'],
  },
  {
    id: 'gemini-3.1-pro-customtools',
    name: 'Gemini 3.1 Pro (Custom Tools)',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'powerful',
    providers: ['google'],
  },
  {
    id: 'grok-4-fast',
    name: 'Grok 4 Fast',
    chef: 'xAI',
    chefSlug: 'xai',
    tier: 'powerful',
    providers: ['xai'],
  },
  {
    id: 'grok-4-1',
    name: 'Grok 4.1',
    chef: 'xAI',
    chefSlug: 'xai',
    tier: 'powerful',
    providers: ['xai'],
  },
]

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
    id: 'anthropic/claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'fast',
    providers: ['anthropic'],
  },
  {
    id: 'google/gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'fast',
    providers: ['google'],
  },
  // Standard tier
  {
    id: 'anthropic/claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'standard',
    providers: ['anthropic'],
  },
  {
    id: 'xai/grok-code-fast-1',
    name: 'Grok Code Fast 1',
    chef: 'xAI',
    chefSlug: 'xai',
    tier: 'standard',
    providers: ['xai'],
  },
  {
    id: 'openai/gpt-5.2-codex-mini',
    name: 'GPT-5.2-Codex-Mini',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'standard',
    providers: ['openai'],
  },
  {
    id: 'github-copilot/gpt-4.1',
    name: 'GitHub Copilot GPT-4.1',
    chef: 'GitHub Copilot',
    chefSlug: 'github-copilot',
    tier: 'standard',
    providers: ['github-copilot'],
  },
  {
    id: 'gitlab/duo-chat-sonnet-4-5',
    name: 'GitLab Duo Agentic Chat',
    chef: 'GitLab',
    chefSlug: 'gitlab',
    tier: 'standard',
    providers: ['gitlab'],
  },
  // Powerful tier
  {
    id: 'openai/gpt-5.3-codex',
    name: 'GPT-5.3-Codex',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'powerful',
    providers: ['openai'],
  },
  {
    id: 'openai/gpt-5.2-codex',
    name: 'GPT-5.2-Codex',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'powerful',
    providers: ['openai'],
  },
  {
    id: 'openai/gpt-5.2-codex-max',
    name: 'GPT-5.2-Codex-Max',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'powerful',
    providers: ['openai'],
  },
  {
    id: 'openai/gpt-5.2',
    name: 'GPT-5.2',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'powerful',
    providers: ['openai'],
  },
  {
    id: 'anthropic/claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'powerful',
    providers: ['anthropic'],
  },
  {
    id: 'anthropic/claude-opus-4-6-20260215',
    name: 'Claude Opus 4.6',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'powerful',
    providers: ['anthropic'],
  },
  {
    id: 'google/gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'powerful',
    providers: ['google'],
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'powerful',
    providers: ['google'],
  },
  {
    id: 'xai/grok-4-fast',
    name: 'Grok 4 Fast',
    chef: 'xAI',
    chefSlug: 'xai',
    tier: 'powerful',
    providers: ['xai'],
  },
  {
    id: 'xai/grok-4-1',
    name: 'Grok 4.1',
    chef: 'xAI',
    chefSlug: 'xai',
    tier: 'powerful',
    providers: ['xai'],
  },
]

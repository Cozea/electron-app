import { getCachedModelSummary } from '@/lib/ai/modelCatalogClient'
import type { ModelOption } from '@/lib/ai/modelOptions'
import { inferProviderFromModelId } from '@/lib/ai/providerAuth'

function getProviderDisplayName(providerId: string): string {
  const defaults: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    xai: 'xAI',
    moonshotai: 'Moonshot AI',
    moonshot: 'Moonshot AI',
    'github-copilot': 'GitHub Copilot',
    gitlab: 'GitLab',
    'amazon-bedrock': 'Amazon Bedrock',
    'google-vertex': 'Google Vertex',
    'google-vertex-anthropic': 'Google Vertex Anthropic',
    azure: 'Azure OpenAI',
    'azure-cognitive-services': 'Azure Cognitive Services',
    'sap-ai-core': 'SAP AI Core',
  }
  if (defaults[providerId]) return defaults[providerId]

  return providerId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatModelName(modelId: string): string {
  const rawName = modelId.includes('/') ? modelId.split('/').pop() ?? modelId : modelId
  return rawName
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^[a-z]+$/i.test(part)) {
        return part.charAt(0).toUpperCase() + part.slice(1)
      }
      return part.toUpperCase() === part ? part : part
    })
    .join(' ')
}

export function buildProvisionalModelOption(modelId: string): ModelOption | null {
  const normalizedModelId = modelId.trim()
  if (!normalizedModelId) return null

  const cached = getCachedModelSummary(normalizedModelId)
  const provider = cached?.provider ?? inferProviderFromModelId(normalizedModelId)
  if (!provider) return null

  return {
    id: normalizedModelId,
    name: cached?.displayName ?? formatModelName(normalizedModelId),
    chef: getProviderDisplayName(provider),
    chefSlug: provider,
    tier: cached?.tier ?? 'standard',
    providers: [provider],
    limit: cached?.limit,
  }
}

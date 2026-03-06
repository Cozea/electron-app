import type { ProviderAuthProvider } from '@shared/electronApiTypes'
import {
  isManagedProviderInApp,
  isProviderEnabledInApp,
} from '@shared/aiProviderAvailability'

function parseScopedProviderFromModelId(modelId: string): ProviderAuthProvider | null {
  const trimmed = modelId.trim()
  const separatorIndex = trimmed.indexOf('/')
  if (separatorIndex <= 0) return null

  const providerId = trimmed.slice(0, separatorIndex).trim().toLowerCase()
  if (!providerId) return null

  return providerId as ProviderAuthProvider
}

export function inferProviderFromModelId(modelId: string): ProviderAuthProvider | null {
  const scopedProvider = parseScopedProviderFromModelId(modelId)
  if (scopedProvider) return scopedProvider

  const normalized = modelId.toLowerCase()
  if (normalized.includes('copilot')) return 'github-copilot'
  if (normalized.includes('gitlab')) return 'gitlab'
  if (normalized.includes('grok')) return 'xai'
  if (normalized.includes('kimi') || normalized.includes('moonshot')) return 'moonshotai'
  if (normalized.includes('gpt')) return 'openai'
  if (normalized.includes('claude')) return 'anthropic'
  if (normalized.includes('gemini')) return 'google'
  return null
}

export function isManagedProvider(provider: ProviderAuthProvider | null | undefined): boolean {
  return isManagedProviderInApp(provider)
}

export async function buildEncodedProviderAuthHeader(args: {
  provider: ProviderAuthProvider
  modelId: string
  organizationId: string
}): Promise<{ header?: string; error?: string; managed?: boolean }> {
  if (!isProviderEnabledInApp(args.provider)) {
    return { error: 'This provider is temporarily disabled in the app.' }
  }

  if (isManagedProvider(args.provider)) {
    return { managed: true }
  }

  if (!window.electronAPI?.providerAuth) {
    return { error: 'Local provider auth is unavailable in this environment.' }
  }

  const result = await window.electronAPI.providerAuth.getRequestAuth({
    provider: args.provider,
    modelId: args.modelId,
    organizationId: args.organizationId,
  })

  if (!result.success || !result.envelope) {
    return { error: result.error || 'Provider is not connected on this device.' }
  }

  try {
    const encoded = btoa(JSON.stringify(result.envelope))
    return { header: encoded }
  } catch {
    return { error: 'Failed to encode provider auth envelope.' }
  }
}

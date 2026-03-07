import type { ProviderAuthProvider } from '@shared/electronApiTypes'
import {
  isManagedProviderInApp,
  isProviderEnabledInApp,
} from '@shared/aiProviderAvailability'

export const LOCAL_PROVIDER_AUTH_READY_SENTINEL = '__cozea_local_provider_ready__'

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

export function isLocalProviderAuthReadyHeader(value: string | null | undefined): boolean {
  return value === LOCAL_PROVIDER_AUTH_READY_SENTINEL
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

  const statuses = await window.electronAPI.providerAuth.getStatus(args.provider)
  const status =
    statuses.find((entry) => entry.provider === args.provider) ||
    statuses[0]

  if (!status?.connected) {
    return { error: status?.lastError || 'Provider is not connected on this device.' }
  }

  if (typeof status.expiresAt === 'number' && status.expiresAt <= Date.now() + 5_000) {
    return { error: 'Provider connection expired. Reconnect to continue.' }
  }

  void args.modelId
  void args.organizationId
  return { header: LOCAL_PROVIDER_AUTH_READY_SENTINEL }
}

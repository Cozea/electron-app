import type { ProviderAuthProvider } from '@shared/electronApiTypes'

export function inferProviderFromModelId(modelId: string): ProviderAuthProvider | null {
  const normalized = modelId.toLowerCase()
  if (normalized.includes('gpt')) return 'openai'
  if (normalized.includes('gemini')) return 'google'
  return null
}

export async function buildEncodedProviderAuthHeader(args: {
  provider: ProviderAuthProvider
  modelId: string
  organizationId: string
}): Promise<{ header?: string; error?: string }> {
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

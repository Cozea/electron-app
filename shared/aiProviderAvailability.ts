// Temporary provider gate while non-Google managed keys are depleted.
// Set this to false to restore the full provider list in the app.
export const ENABLE_GOOGLE_ONLY_PROVIDER_MODE = true

const DEFAULT_MANAGED_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'moonshotai',
  'moonshot',
] as const

function normalizeProviderId(providerId: string | null | undefined): string {
  return typeof providerId === 'string' ? providerId.trim().toLowerCase() : ''
}

export function isProviderEnabledInApp(providerId: string | null | undefined): boolean {
  const normalized = normalizeProviderId(providerId)
  if (!normalized) return false
  if (!ENABLE_GOOGLE_ONLY_PROVIDER_MODE) return true
  return normalized === 'google'
}

export function getManagedProviderIdsForApp(): string[] {
  if (ENABLE_GOOGLE_ONLY_PROVIDER_MODE) {
    return ['google']
  }
  return [...DEFAULT_MANAGED_PROVIDER_IDS]
}

export function isManagedProviderInApp(providerId: string | null | undefined): boolean {
  const normalized = normalizeProviderId(providerId)
  if (!normalized) return false
  return getManagedProviderIdsForApp().includes(normalized)
}

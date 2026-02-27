const PROVIDER_LOGO_BASE_URL = 'https://models.dev/logos'

export function getProviderLogoUrl(providerId: string): string {
  const normalized = providerId.trim().toLowerCase()
  if (!normalized) return `${PROVIDER_LOGO_BASE_URL}/opencode.svg`
  return `${PROVIDER_LOGO_BASE_URL}/${encodeURIComponent(normalized)}.svg`
}

export function getProviderLogoMap(providerIds: readonly string[]): Record<string, string> {
  const entries = providerIds
    .filter((providerId) => typeof providerId === 'string' && providerId.trim().length > 0)
    .map((providerId) => [providerId, getProviderLogoUrl(providerId)] as const)

  return Object.fromEntries(entries)
}

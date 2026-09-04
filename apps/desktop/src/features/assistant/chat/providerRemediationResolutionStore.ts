const PROVIDER_REMEDIATION_RESOLUTION_PREFIX = "cozea:provider-remediation-resolved:"

function storageKey(persistenceKey: string): string {
  return `${PROVIDER_REMEDIATION_RESOLUTION_PREFIX}${persistenceKey}`
}

export function isProviderRemediationResolved(persistenceKey: string | undefined): boolean {
  if (!persistenceKey || typeof window === "undefined") return false

  try {
    return window.sessionStorage.getItem(storageKey(persistenceKey)) === "true"
  } catch {
    return false
  }
}

export function markProviderRemediationResolved(persistenceKey: string | undefined): void {
  if (!persistenceKey || typeof window === "undefined") return

  try {
    window.sessionStorage.setItem(storageKey(persistenceKey), "true")
  } catch {
    // Keep the successful local state even when session storage is unavailable.
  }
}

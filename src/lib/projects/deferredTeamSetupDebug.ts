export function isDeferredTeamSetupDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem('deferredTeamSetupDebug') === '1'
}

export function logDeferredTeamSetupDebug(event: string, payload?: unknown): void {
  if (!isDeferredTeamSetupDebugEnabled()) {
    return
  }

  console.info(`[DeferredTeamSetup] ${event}`, payload)
}

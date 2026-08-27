function canUseGitOpenDebug(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

export function isGitOpenDebugEnabled(): boolean {
  if (!canUseGitOpenDebug()) {
    return false
  }

  return window.localStorage.getItem('gitOpenDebug') === '1'
}

export function logGitOpenDebug(_event: string, _payload: Record<string, unknown>): void {
  if (!isGitOpenDebugEnabled()) {
    return
  }

  // console.info(`[GitOpenDebug] ${_event}`, _payload)
}

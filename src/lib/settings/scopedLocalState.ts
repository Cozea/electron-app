function getScopedStorageKey(prefix: string, scopeKey: string): string {
  return `${prefix}:${scopeKey}`
}

export function readScopedJsonValue<T>(
  prefix: string,
  scopeKey: string,
  fallback: T
): T {
  if (typeof window === 'undefined') return fallback

  try {
    const raw = window.localStorage.getItem(getScopedStorageKey(prefix, scopeKey))
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeScopedJsonValue<T>(
  prefix: string,
  scopeKey: string,
  value: T
): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(getScopedStorageKey(prefix, scopeKey), JSON.stringify(value))
  } catch {
    // Ignore local persistence failures to keep the settings UI responsive.
  }
}

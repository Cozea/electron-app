const SETTINGS_DEEPLINK_KEY = 'settings'

function decodeRouteValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeHash(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash
}

function readRouteFromHash(hash: string): string | null {
  const rawHash = normalizeHash(hash)
  if (!rawHash) return null

  if (rawHash.startsWith('/settings/') || rawHash.startsWith('settings/')) {
    return decodeRouteValue(rawHash)
  }

  if (rawHash.startsWith(`${SETTINGS_DEEPLINK_KEY}=`)) {
    return decodeRouteValue(rawHash.slice(SETTINGS_DEEPLINK_KEY.length + 1))
  }

  if (!rawHash.includes('=')) {
    return null
  }

  const params = new URLSearchParams(rawHash)
  const value = params.get(SETTINGS_DEEPLINK_KEY)
  if (!value) return null
  return decodeRouteValue(value)
}

export function getSettingsRouteFromLocation(location: Pick<Location, 'search' | 'hash'>): string | null {
  const searchParams = new URLSearchParams(location.search)
  const fromQuery = searchParams.get(SETTINGS_DEEPLINK_KEY)
  if (fromQuery) {
    return decodeRouteValue(fromQuery)
  }

  return readRouteFromHash(location.hash)
}

function buildHashWithRoute(existingHash: string, route: string): string {
  const rawHash = normalizeHash(existingHash)

  if (!rawHash || !rawHash.includes('=')) {
    return `${SETTINGS_DEEPLINK_KEY}=${encodeURIComponent(route)}`
  }

  const params = new URLSearchParams(rawHash)
  params.set(SETTINGS_DEEPLINK_KEY, route)
  return params.toString()
}

function clearRouteFromHash(existingHash: string): string {
  const rawHash = normalizeHash(existingHash)
  if (!rawHash) return ''

  if (
    rawHash.startsWith('/settings/') ||
    rawHash.startsWith('settings/') ||
    rawHash.startsWith(`${SETTINGS_DEEPLINK_KEY}=`)
  ) {
    return ''
  }

  if (!rawHash.includes('=')) {
    return rawHash
  }

  const params = new URLSearchParams(rawHash)
  if (!params.has(SETTINGS_DEEPLINK_KEY)) {
    return rawHash
  }

  params.delete(SETTINGS_DEEPLINK_KEY)
  return params.toString()
}

export function writeSettingsRouteToUrl(route: string | null): void {
  if (typeof window === 'undefined') return

  const currentUrl = new URL(window.location.href)
  currentUrl.searchParams.delete(SETTINGS_DEEPLINK_KEY)

  const nextHash = route
    ? buildHashWithRoute(currentUrl.hash, route)
    : clearRouteFromHash(currentUrl.hash)

  currentUrl.hash = nextHash ? `#${nextHash}` : ''

  const nextRelativeUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
  const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`

  if (nextRelativeUrl !== currentRelativeUrl) {
    window.history.replaceState(window.history.state, '', nextRelativeUrl)
  }
}

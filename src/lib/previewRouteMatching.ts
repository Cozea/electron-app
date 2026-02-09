interface PreviewRouteLike {
  path: string
  name?: string
}

const HOME_PATH_ALIASES = new Set(['/home', '/index', '/landing', '/start'])
const HOME_NAME_PATTERN = /\b(home|index|landing|start)\b/i

function normalizePathValue(pathValue: string): string | null {
  const trimmed = pathValue.trim()
  if (!trimmed) return null

  let normalized = trimmed
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    try {
      normalized = new URL(trimmed).pathname || '/'
    } catch {
      normalized = trimmed
    }
  }

  normalized = normalized.split('#')[0]?.split('?')[0] ?? normalized
  if (!normalized.startsWith('/')) normalized = `/${normalized}`
  normalized = normalized.replace(/\/{2,}/g, '/')
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, '')
  }
  return normalized || '/'
}

function extractHashRoute(url: string): string | null {
  try {
    const parsed = new URL(url)
    const hash = parsed.hash.startsWith('#!') ? parsed.hash.slice(2) : parsed.hash.slice(1)
    if (!hash.startsWith('/')) return null
    return normalizePathValue(hash)
  } catch {
    return null
  }
}

function isLikelyHomeRoute(route: PreviewRouteLike): boolean {
  const normalizedPath = normalizePathValue(route.path)
  if (!normalizedPath) return false
  if (normalizedPath === '/') return true
  if (HOME_PATH_ALIASES.has(normalizedPath)) return true
  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.length !== 1) return false
  return Boolean(route.name && HOME_NAME_PATTERN.test(route.name))
}

function findDirectOrBasenameMatch(
  routes: PreviewRouteLike[],
  normalizedTargetPath: string
): number | null {
  const normalizedRoutes = routes.map((route) => normalizePathValue(route.path))
  const directIndex = normalizedRoutes.findIndex((path) => path === normalizedTargetPath)
  if (directIndex >= 0) return directIndex

  const basenameMatches = normalizedRoutes
    .map((path, index) => ({ path, index }))
    .filter(({ path }) => {
      if (!path || path === '/') return false
      if (!normalizedTargetPath.endsWith(path)) return false
      if (normalizedTargetPath === path) return true
      const boundaryIndex = normalizedTargetPath.length - path.length - 1
      return normalizedTargetPath[boundaryIndex] === '/'
    })
    .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))

  if (basenameMatches.length > 0) {
    return basenameMatches[0]?.index ?? null
  }

  return null
}

export function resolveNavigationPathFromBridge(payload: {
  pathname?: string | null
  url?: string | null
}): string | null {
  if (payload.url) {
    const hashRoute = extractHashRoute(payload.url)
    if (hashRoute) return hashRoute
  }
  return payload.pathname ? normalizePathValue(payload.pathname) : null
}

export function findBestPreviewRouteIndex(
  routes: PreviewRouteLike[],
  navigationPath: string
): number | null {
  const normalizedTargetPath = normalizePathValue(navigationPath)
  if (!normalizedTargetPath) return null

  const directOrBasenameMatch = findDirectOrBasenameMatch(routes, normalizedTargetPath)
  if (directOrBasenameMatch !== null) return directOrBasenameMatch

  const normalizedRoutes = routes.map((route) => normalizePathValue(route.path))

  if (normalizedTargetPath === '/') {
    const rootIndex = normalizedRoutes.findIndex((path) => path === '/')
    if (rootIndex >= 0) return rootIndex

    const aliasIndex = normalizedRoutes.findIndex((path) => path !== null && HOME_PATH_ALIASES.has(path))
    if (aliasIndex >= 0) return aliasIndex

    const likelyHomeIndex = routes.findIndex((route) => isLikelyHomeRoute(route))
    return likelyHomeIndex >= 0 ? likelyHomeIndex : null
  }

  if (HOME_PATH_ALIASES.has(normalizedTargetPath)) {
    const rootIndex = normalizedRoutes.findIndex((path) => path === '/')
    if (rootIndex >= 0) return rootIndex
  }

  return null
}

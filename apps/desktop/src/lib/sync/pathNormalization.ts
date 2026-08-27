interface VersionedPathEntry {
  path: string
  uploadedAt?: number
  version?: number
}

const ABSOLUTE_WINDOWS_PATH = /^[A-Za-z]:\//
const PATH_MARKERS = [
  'src/',
  'app/',
  'pages/',
  'components/',
  'public/',
  'prisma/',
  'convex/',
  'server/',
  'electron/',
  'shared/',
  'scripts/',
  'styles/',
  'lib/',
]
const ROOT_FILE_MARKERS = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'tsconfig.json',
  'README.md',
  '.gitignore',
  'next.config.js',
  'next.config.mjs',
  'vite.config.ts',
  'vite.config.js',
]

function normalizeSlashes(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').trim()
}

export function isAbsolutePathLike(pathValue: string): boolean {
  const normalized = normalizeSlashes(pathValue)
  return normalized.startsWith('/') || ABSOLUTE_WINDOWS_PATH.test(normalized)
}

function sanitizeRelativeSegments(pathValue: string): string {
  const segments = pathValue.split('/')
  const normalized: string[] = []

  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      normalized.pop()
      continue
    }
    normalized.push(segment)
  }

  return normalized.join('/')
}

export function normalizeRelativePath(pathValue: string): string {
  let normalized = normalizeSlashes(pathValue)
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2)
  }
  normalized = normalized.replace(/^\/+/, '')
  return sanitizeRelativeSegments(normalized)
}

function detectAbsoluteRoot(paths: string[]): string | null {
  const absolute = paths
    .map((value) => normalizeSlashes(value))
    .filter((value) => isAbsolutePathLike(value))

  if (absolute.length === 0) return null

  const isWindows = ABSOLUTE_WINDOWS_PATH.test(absolute[0])
  const rootToken = isWindows ? absolute[0].slice(0, 2).toLowerCase() : '/'

  const segmentLists = absolute
    .filter((value) => (isWindows ? ABSOLUTE_WINDOWS_PATH.test(value) : value.startsWith('/')))
    .map((value) => {
      if (isWindows) {
        const drive = value.slice(0, 2).toLowerCase()
        if (drive !== rootToken) return null
        return value.slice(3).split('/').filter(Boolean)
      }
      return value.slice(1).split('/').filter(Boolean)
    })
    .filter((segments): segments is string[] => Array.isArray(segments))

  if (segmentLists.length === 0) return null

  let prefix = [...segmentLists[0]]
  for (let i = 1; i < segmentLists.length; i += 1) {
    const current = segmentLists[i]
    const max = Math.min(prefix.length, current.length)
    let idx = 0
    while (idx < max && prefix[idx].toLowerCase() === current[idx].toLowerCase()) {
      idx += 1
    }
    prefix = prefix.slice(0, idx)
    if (prefix.length === 0) break
  }

  if (prefix.length === 0) return null
  return isWindows ? `${absolute[0].slice(0, 2)}/${prefix.join('/')}` : `/${prefix.join('/')}`
}

function pathStartsWith(pathValue: string, prefix: string): boolean {
  const normalizedPath = normalizeSlashes(pathValue)
  const normalizedPrefix = normalizeSlashes(prefix)

  if (ABSOLUTE_WINDOWS_PATH.test(normalizedPath) || ABSOLUTE_WINDOWS_PATH.test(normalizedPrefix)) {
    const pathLower = normalizedPath.toLowerCase()
    const prefixLower = normalizedPrefix.toLowerCase()
    return pathLower === prefixLower || pathLower.startsWith(`${prefixLower}/`)
  }

  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`)
}

function guessRelativePathFromAbsolute(pathValue: string): string {
  const normalized = normalizeSlashes(pathValue)
  const lower = normalized.toLowerCase()

  for (const marker of ROOT_FILE_MARKERS) {
    const suffix = `/${marker.toLowerCase()}`
    if (lower.endsWith(suffix)) {
      return marker
    }
  }

  let bestIndex = Number.POSITIVE_INFINITY
  let bestPath = ''
  for (const marker of PATH_MARKERS) {
    const idx = lower.indexOf(`/${marker}`)
    if (idx !== -1 && idx < bestIndex) {
      bestIndex = idx
      bestPath = normalized.slice(idx + 1)
    }
  }

  if (bestPath) {
    return normalizeRelativePath(bestPath)
  }

  const fileName = normalized.split('/').filter(Boolean).pop() ?? ''
  return normalizeRelativePath(fileName)
}

function normalizeCloudPath(pathValue: string, absoluteRoot: string | null): string {
  const normalized = normalizeSlashes(pathValue)
  if (!isAbsolutePathLike(normalized)) {
    return normalizeRelativePath(normalized)
  }

  if (absoluteRoot && pathStartsWith(normalized, absoluteRoot)) {
    const suffix = normalized.slice(normalizeSlashes(absoluteRoot).length).replace(/^\/+/, '')
    const relative = normalizeRelativePath(suffix)
    if (relative) return relative
  }

  return guessRelativePathFromAbsolute(normalized)
}

function prefersNewerEntry(
  current: VersionedPathEntry,
  next: VersionedPathEntry
): boolean {
  const currentAbsolute = isAbsolutePathLike(current.path)
  const nextAbsolute = isAbsolutePathLike(next.path)

  if (currentAbsolute !== nextAbsolute) {
    return !nextAbsolute
  }

  const currentUploadedAt = typeof current.uploadedAt === 'number' ? current.uploadedAt : -1
  const nextUploadedAt = typeof next.uploadedAt === 'number' ? next.uploadedAt : -1
  if (nextUploadedAt !== currentUploadedAt) {
    return nextUploadedAt > currentUploadedAt
  }

  const currentVersion = typeof current.version === 'number' ? current.version : -1
  const nextVersion = typeof next.version === 'number' ? next.version : -1
  return nextVersion > currentVersion
}

export function normalizeCloudPathSet(paths: Iterable<string>): Set<string> {
  const pathValues = Array.from(paths)
  const absoluteRoot = detectAbsoluteRoot(pathValues)
  const normalized = pathValues
    .map((value) => normalizeCloudPath(value, absoluteRoot))
    .filter((value) => value.length > 0)
  return new Set(normalized)
}

export function normalizeProjectFilePath(pathValue: string): string {
  const absoluteRoot = detectAbsoluteRoot([pathValue])
  return normalizeCloudPath(pathValue, absoluteRoot)
}

export function normalizeCloudEntries<T extends VersionedPathEntry>(
  entries: T[]
): Array<{ entry: T; normalizedPath: string }> {
  const absoluteRoot = detectAbsoluteRoot(entries.map((entry) => entry.path))
  const deduped = new Map<string, T>()

  for (const entry of entries) {
    const normalizedPath = normalizeCloudPath(entry.path, absoluteRoot)
    if (!normalizedPath) continue

    const current = deduped.get(normalizedPath)
    if (!current || prefersNewerEntry(current, entry)) {
      deduped.set(normalizedPath, entry)
    }
  }

  return Array.from(deduped.entries()).map(([normalizedPath, entry]) => ({
    entry,
    normalizedPath,
  }))
}

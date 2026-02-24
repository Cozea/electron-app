export type ProjectPath = string & { readonly __brand: 'ProjectPath' }

export interface ProjectPathNormalizationOptions {
  maxLength?: number
}

const DEFAULT_MAX_LENGTH = 4096

export function normalizeProjectPath(
  rawPath: string,
  options: ProjectPathNormalizationOptions = {}
): ProjectPath | null {
  if (typeof rawPath !== 'string') return null

  const maxLength = Number.isFinite(options.maxLength)
    ? Math.max(1, Number(options.maxLength))
    : DEFAULT_MAX_LENGTH

  const trimmed = rawPath.trim()
  if (!trimmed) return null

  const slashNormalized = trimmed.replace(/\\/g, '/')
  if (slashNormalized.length > maxLength) return null

  // Reject absolute paths (unix/windows).
  if (slashNormalized.startsWith('/')) return null
  if (/^[a-zA-Z]:\//.test(slashNormalized)) return null

  const segments = slashNormalized
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')

  if (segments.length === 0) return null

  for (const segment of segments) {
    if (segment === '..') return null
    if (segment.includes('\0')) return null
  }

  const normalized = segments.join('/')
  if (!normalized || normalized.length > maxLength) return null

  return normalized as ProjectPath
}

export function assertProjectPath(
  rawPath: string,
  options: ProjectPathNormalizationOptions = {}
): ProjectPath {
  const normalized = normalizeProjectPath(rawPath, options)
  if (!normalized) {
    throw new Error(`Invalid project path: ${rawPath}`)
  }
  return normalized
}

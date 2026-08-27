import path from 'node:path'

const pathCache = new Map<string, string>()

function normalizeUniquePathEntries(entries: string[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []

  for (const rawEntry of entries) {
    const entry = rawEntry.trim()
    if (!entry) continue
    const normalized = path.normalize(entry)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    ordered.push(normalized)
  }

  return ordered
}

export function buildRuntimePath(prefixEntries: string[], fallbackPath?: string): string {
  const cacheKey = `${prefixEntries.join('|')}::${fallbackPath ?? process.env.PATH ?? ''}`
  const cached = pathCache.get(cacheKey)
  if (cached) return cached

  const entries = normalizeUniquePathEntries([
    ...prefixEntries,
    fallbackPath ?? process.env.PATH ?? '',
  ].join(path.delimiter).split(path.delimiter))

  const value = entries.join(path.delimiter)
  pathCache.set(cacheKey, value)
  return value
}

export function createRuntimeEnv(prefixEntries: string[], baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sourceEnv = baseEnv ?? process.env
  const runtimePath = buildRuntimePath(prefixEntries, sourceEnv.PATH)
  return {
    ...sourceEnv,
    PATH: runtimePath,
  }
}


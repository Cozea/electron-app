import path from 'node:path'

export type AutoConflictKind =
  | 'lockfile'
  | 'generated'
  | 'structured-json'
  | 'binary'
  | 'text'
  | 'unknown'

export interface ConflictPathContents {
  baseContent: string | null
  oursContent: string | null
  theirsContent: string | null
}

export function classifyConflictPath(
  filePath: string,
  contents: ConflictPathContents
): AutoConflictKind {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase()
  const basename = path.basename(normalizedPath)

  if (
    basename === 'package-lock.json' ||
    basename === 'pnpm-lock.yaml' ||
    basename === 'yarn.lock' ||
    basename === 'cargo.lock'
  ) {
    return 'lockfile'
  }

  if (
    normalizedPath.startsWith('dist/') ||
    normalizedPath.startsWith('build/') ||
    normalizedPath.startsWith('.next/') ||
    normalizedPath.startsWith('coverage/') ||
    normalizedPath.endsWith('.map') ||
    normalizedPath.endsWith('.min.js') ||
    normalizedPath.includes('.generated.') ||
    normalizedPath.includes('.gen.')
  ) {
    return 'generated'
  }

  const ext = path.extname(normalizedPath)
  if (
    ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.mp3', '.mp4', '.mov', '.woff', '.woff2', '.ttf', '.eot', '.wasm'].includes(ext) ||
    hasBinarySignature(contents.oursContent) ||
    hasBinarySignature(contents.theirsContent)
  ) {
    return 'binary'
  }

  if (ext === '.json' || basename === 'package.json' || basename.endsWith('.json')) {
    return 'structured-json'
  }

  if (
    ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.html', '.md', '.mdx', '.txt', '.yaml', '.yml', '.toml', '.env', '.gitignore'].includes(ext) ||
    basename === 'dockerfile' ||
    basename === 'makefile'
  ) {
    return 'text'
  }

  return 'unknown'
}

export function hasBinarySignature(content: string | null): boolean {
  if (!content) {
    return false
  }
  return content.includes('\u0000')
}

export function tryMergeJsonConflict(
  baseContent: string | null,
  oursContent: string | null,
  theirsContent: string | null
): string | null {
  try {
    const base = baseContent != null && baseContent.length > 0 ? JSON.parse(baseContent) : undefined
    const ours = oursContent != null && oursContent.length > 0 ? JSON.parse(oursContent) : undefined
    const theirs = theirsContent != null && theirsContent.length > 0 ? JSON.parse(theirsContent) : undefined
    const merged = mergeJsonValue(base, ours, theirs)
    if (!merged.success) {
      return null
    }
    return `${JSON.stringify(merged.value, null, 2)}\n`
  } catch {
    return null
  }
}

function mergeJsonValue(
  base: unknown,
  ours: unknown,
  theirs: unknown
): { success: boolean; value?: unknown } {
  if (jsonValuesEqual(ours, theirs)) {
    return { success: true, value: ours }
  }
  if (jsonValuesEqual(ours, base)) {
    return { success: true, value: theirs }
  }
  if (jsonValuesEqual(theirs, base)) {
    return { success: true, value: ours }
  }

  if (isPlainObject(base) || isPlainObject(ours) || isPlainObject(theirs)) {
    if (!isPlainObject(ours) || !isPlainObject(theirs)) {
      return { success: false }
    }
    const baseObject = isPlainObject(base) ? base : {}
    const merged: Record<string, unknown> = {}
    const keys = new Set([
      ...Object.keys(baseObject),
      ...Object.keys(ours),
      ...Object.keys(theirs),
    ])
    for (const key of keys) {
      const next = mergeJsonValue(
        (baseObject as Record<string, unknown>)[key],
        (ours as Record<string, unknown>)[key],
        (theirs as Record<string, unknown>)[key]
      )
      if (!next.success) {
        return { success: false }
      }
      if (next.value !== undefined) {
        merged[key] = next.value
      }
    }
    return { success: true, value: merged }
  }

  if (Array.isArray(ours) || Array.isArray(theirs) || Array.isArray(base)) {
    if (!Array.isArray(ours) || !Array.isArray(theirs)) {
      return { success: false }
    }
    return { success: false }
  }

  return { success: false }
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

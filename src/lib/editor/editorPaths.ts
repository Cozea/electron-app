interface ResolvedProjectFilePath {
  canonicalPath: string
  relativePath: string
}

function stripTrailingSeparators(path: string): string {
  if (path === '/') return path
  if (/^[A-Za-z]:\/$/.test(path)) return path
  return path.replace(/\/+$/, '')
}

function collapseSegments(path: string): string {
  const isWindowsDrive = /^[A-Za-z]:\//.test(path)
  const drivePrefix = isWindowsDrive ? path.slice(0, 2) : ''
  const hasRoot = path.startsWith('/') || isWindowsDrive
  const rawSegments = path.slice(isWindowsDrive ? 2 : 0).split('/')
  const segments: string[] = []

  for (const segment of rawSegments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop()
      } else if (!hasRoot) {
        segments.push(segment)
      }
      continue
    }
    segments.push(segment)
  }

  const prefix = isWindowsDrive ? `${drivePrefix}/` : hasRoot ? '/' : ''
  const joined = `${prefix}${segments.join('/')}`
  if (!joined) return hasRoot ? prefix || '/' : '.'
  return stripTrailingSeparators(joined)
}

export function normalizeEditorPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  if (!normalized) return ''
  return collapseSegments(normalized)
}

export function isAbsoluteEditorPath(path: string): boolean {
  const normalized = normalizeEditorPath(path)
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
}

export function joinProjectFilePath(projectRoot: string, filePath: string): string {
  const normalizedRoot = normalizeEditorPath(projectRoot)
  const normalizedFilePath = normalizeEditorPath(filePath).replace(/^\/+/, '')
  return normalizeEditorPath(`${normalizedRoot}/${normalizedFilePath}`)
}

export function resolveProjectFilePath(
  filePath: string,
  projectRoot: string
): ResolvedProjectFilePath {
  const normalizedRoot = normalizeEditorPath(projectRoot)
  const canonicalPath = isAbsoluteEditorPath(filePath)
    ? normalizeEditorPath(filePath)
    : joinProjectFilePath(normalizedRoot, filePath)

  const rootPrefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`
  if (canonicalPath !== normalizedRoot && !canonicalPath.startsWith(rootPrefix)) {
    throw new Error('File path is outside the current project directory')
  }

  return {
    canonicalPath,
    relativePath:
      canonicalPath === normalizedRoot
        ? ''
        : canonicalPath.slice(rootPrefix.length),
  }
}

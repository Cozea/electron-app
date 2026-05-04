function decodePathValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function normalizeProjectSourceReference(reference: string): string {
  let normalized = decodePathValue(reference.trim()).replace(/\\/g, '/')

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(normalized)) {
    try {
      normalized = decodePathValue(new URL(normalized).pathname)
    } catch {
      // Keep the original value if URL parsing fails.
    }
  }

  const suffixIndex = normalized.search(/[?#]/)
  if (suffixIndex >= 0) {
    normalized = normalized.slice(0, suffixIndex)
  }

  if (normalized.startsWith('/@fs/')) {
    normalized = normalized.slice('/@fs'.length)
  }

  if (/^\/[A-Za-z]:\//.test(normalized)) {
    normalized = normalized.slice(1)
  }

  if (normalized.startsWith('@/')) {
    normalized = `src/${normalized.slice(2)}`
  } else if (normalized.startsWith('~/')) {
    normalized = `src/${normalized.slice(2)}`
  } else if (normalized.startsWith('/src/')) {
    normalized = normalized.slice(1)
  }

  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, '')
  }

  return normalized
}

export function getProjectSourceFileName(reference: string): string {
  const normalized = normalizeProjectSourceReference(reference)
  return normalized.split('/').pop() ?? normalized
}

export function isBareProjectSourceReference(reference: string): boolean {
  const normalized = normalizeProjectSourceReference(reference).replace(/^\/+/, '')
  return normalized.length > 0 && !normalized.includes('/')
}

export function toProjectRelativeSourcePath(reference: string, workspaceId: string): string | null {
  const normalizedReference = normalizeProjectSourceReference(reference)
  const normalizedProjectPath = normalizeProjectSourceReference(workspaceId)

  if (!normalizedReference || !normalizedProjectPath) {
    return null
  }

  if (normalizedReference === normalizedProjectPath) {
    return ''
  }

  if (normalizedReference.startsWith(`${normalizedProjectPath}/`)) {
    return normalizedReference.slice(normalizedProjectPath.length + 1)
  }

  if (/^[A-Za-z]:\//.test(normalizedReference)) {
    return null
  }

  return normalizedReference.replace(/^\/+/, '')
}

export async function resolveProjectSourcePath(reference: string, workspaceId: string): Promise<string | null> {
  const directPath = toProjectRelativeSourcePath(reference, workspaceId)

  const listResult = await window.electronAPI.project.listFiles({ workspaceId })
  if (!listResult.success) {
    return null
  }
  const files = listResult.files ?? []

  if (!directPath) {
    return null
  }

  const normalizedDirectPath = normalizeProjectSourceReference(directPath)
  const exactPathMatch = files.find(
    (file) => normalizeProjectSourceReference(file.path) === normalizedDirectPath
  )
  if (exactPathMatch) {
    return normalizeProjectSourceReference(exactPathMatch.path)
  }

  if (!isBareProjectSourceReference(reference)) {
    const directWithoutExtension = normalizedDirectPath.replace(/\.(tsx|jsx|ts|js|vue|astro|svelte)$/i, '')
    const suffixMatches = files.filter((file) => {
      const normalizedPath = normalizeProjectSourceReference(file.path)
      return (
        normalizedPath === normalizedDirectPath ||
        normalizedPath === directWithoutExtension ||
        normalizedPath.startsWith(`${directWithoutExtension}.`) ||
        normalizedPath.startsWith(`${directWithoutExtension}/index.`)
      )
    })
    if (suffixMatches.length === 1) {
      return normalizeProjectSourceReference(suffixMatches[0].path)
    }
  }

  const requestedFileName = getProjectSourceFileName(reference)
  const exactCaseMatches = files.filter(
    (file) => getProjectSourceFileName(file.path) === requestedFileName
  )
  if (exactCaseMatches.length === 1) {
    return normalizeProjectSourceReference(exactCaseMatches[0].path)
  }

  const lowerCaseName = requestedFileName.toLowerCase()
  const caseInsensitiveMatches = files.filter(
    (file) => getProjectSourceFileName(file.path).toLowerCase() === lowerCaseName
  )
  if (caseInsensitiveMatches.length === 1) {
    return normalizeProjectSourceReference(caseInsensitiveMatches[0].path)
  }

  return null
}

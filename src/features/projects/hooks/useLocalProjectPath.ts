import { useCallback, useEffect, useMemo, useState } from 'react'

interface UseLocalProjectPathOptions {
  initialPath?: string | null
  lookupOnMount?: boolean
  preferInitialPath?: boolean
  projectId?: string | null
  projectSlug?: string | null
}

interface UseLocalProjectPathResult {
  localPath: string | null
  refreshLocalPath: () => Promise<string | null>
}

const projectPathCache = new Map<string, string>()

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Prefer an explicit UI/navigation path, then a Convex-synced member `localPath`,
 * before falling back to Electron `getLocalPath` resolution.
 */
export function mergeProjectLocalPathHints(
  primary: string | null | undefined,
  cloudHint: string | null | undefined
): string | null {
  if (primary?.trim()) {
    return normalizeProjectPath(primary.trim())
  }
  if (cloudHint?.trim()) {
    return normalizeProjectPath(cloudHint.trim())
  }
  return null
}

function getProjectPathCacheKeys(projectId?: string | null, projectSlug?: string | null): string[] {
  const keys: string[] = []
  if (projectId) {
    keys.push(`id:${projectId}`)
  }
  if (projectSlug) {
    keys.push(`slug:${projectSlug}`)
  }
  return keys
}

function readCachedProjectPath(projectId?: string | null, projectSlug?: string | null): string | null {
  for (const key of getProjectPathCacheKeys(projectId, projectSlug)) {
    const cachedValue = projectPathCache.get(key)
    if (cachedValue) {
      return cachedValue
    }
  }
  return null
}

function writeCachedProjectPath(
  projectPath: string | null,
  projectId?: string | null,
  projectSlug?: string | null
): void {
  const keys = getProjectPathCacheKeys(projectId, projectSlug)
  if (keys.length === 0) {
    return
  }

  if (!projectPath) {
    for (const key of keys) {
      projectPathCache.delete(key)
    }
    return
  }

  const normalizedPath = normalizeProjectPath(projectPath)
  for (const key of keys) {
    projectPathCache.set(key, normalizedPath)
  }
}

function resolveSeededProjectPath(options: {
  normalizedInitialPath: string | null
  preferInitialPath: boolean
  projectId?: string | null
  projectSlug?: string | null
}): string | null {
  const cachedPath = readCachedProjectPath(options.projectId, options.projectSlug)
  if (options.preferInitialPath && options.normalizedInitialPath) {
    return options.normalizedInitialPath
  }
  return cachedPath ?? options.normalizedInitialPath
}

async function loadLocalProjectPath(
  projectId?: string | null,
  projectSlug?: string | null
): Promise<string | null> {
  if (!projectId && !projectSlug) {
    return null
  }

  try {
    const resolvedPath = await window.electronAPI.project.getLocalPath({
      slug: projectSlug ?? '',
      projectId: projectId ?? undefined,
    })

    return resolvedPath ? normalizeProjectPath(resolvedPath) : null
  } catch {
    return null
  }
}

export function primeLocalProjectPath(
  projectId: string | null | undefined,
  projectPath: string | null | undefined,
  projectSlug?: string | null
): void {
  writeCachedProjectPath(projectPath ?? null, projectId ?? null, projectSlug)
}

export function useLocalProjectPath({
  initialPath = null,
  lookupOnMount = true,
  preferInitialPath = false,
  projectId = null,
  projectSlug = null,
}: UseLocalProjectPathOptions): UseLocalProjectPathResult {
  const normalizedInitialPath = useMemo(
    () => (initialPath ? normalizeProjectPath(initialPath) : null),
    [initialPath]
  )

  const [localPath, setLocalPath] = useState<string | null>(() => {
    return resolveSeededProjectPath({
      normalizedInitialPath,
      preferInitialPath,
      projectId,
      projectSlug,
    })
  })

  useEffect(() => {
    const seededPath = resolveSeededProjectPath({
      normalizedInitialPath,
      preferInitialPath,
      projectId,
      projectSlug,
    })
    setLocalPath(seededPath)
    writeCachedProjectPath(seededPath, projectId, projectSlug)

    if (seededPath || !lookupOnMount || (!projectId && !projectSlug)) {
      return
    }

    let cancelled = false

    void loadLocalProjectPath(projectId, projectSlug).then((resolvedPath) => {
      if (cancelled) {
        return
      }
      setLocalPath(resolvedPath)
      writeCachedProjectPath(resolvedPath, projectId, projectSlug)
    })

    return () => {
      cancelled = true
    }
  }, [lookupOnMount, normalizedInitialPath, preferInitialPath, projectId, projectSlug])

  const refreshLocalPath = useCallback(async () => {
    const resolvedPath = await loadLocalProjectPath(projectId, projectSlug)
    setLocalPath(resolvedPath)
    writeCachedProjectPath(resolvedPath, projectId, projectSlug)
    return resolvedPath
  }, [projectId, projectSlug])

  return {
    localPath,
    refreshLocalPath,
  }
}

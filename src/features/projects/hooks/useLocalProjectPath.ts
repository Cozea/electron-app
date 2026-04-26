import { useCallback, useEffect, useMemo, useState } from 'react'

interface UseLocalProjectPathOptions {
  initialPath?: string | null
  lookupOnMount?: boolean
  preferInitialPath?: boolean
  verifySeededPath?: boolean
  projectId?: string | null
  projectSlug?: string | null
  cloudPathHint?: string | null
  attachedPathHint?: string | null
}

interface UseLocalProjectPathResult {
  localPath: string | null
  refreshLocalPath: () => Promise<string | null>
}

interface ScopedLocalProjectPathState {
  identityKey: string
  localPath: string | null
}

const projectPathCache = new Map<string, string>()
const SUPPRESSED_PROJECT_PATHS_STORAGE_KEY = "cozea:suppressed-project-paths:v1"

interface SuppressedProjectPathState {
  version: 1
  paths: Record<string, string>
}

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Prefer an explicit UI/navigation path, then a verified local registry entry,
 * while treating cloud/member and attached-import paths as lookup hints rather than
 * trusted state to render immediately.
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

function readSuppressedProjectPathState(): SuppressedProjectPathState {
  if (typeof window === "undefined") {
    return { version: 1, paths: {} }
  }

  try {
    const rawValue = window.localStorage.getItem(SUPPRESSED_PROJECT_PATHS_STORAGE_KEY)
    if (!rawValue) {
      return { version: 1, paths: {} }
    }

    const parsedValue = JSON.parse(rawValue) as Partial<SuppressedProjectPathState>
    return {
      version: 1,
      paths:
        parsedValue.version === 1 && parsedValue.paths && typeof parsedValue.paths === "object"
          ? parsedValue.paths
          : {},
    }
  } catch {
    return { version: 1, paths: {} }
  }
}

function writeSuppressedProjectPathState(state: SuppressedProjectPathState): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(
    SUPPRESSED_PROJECT_PATHS_STORAGE_KEY,
    JSON.stringify(state),
  )
}

function readSuppressedProjectPath(projectId?: string | null, projectSlug?: string | null): string | null {
  const state = readSuppressedProjectPathState()
  for (const key of getProjectPathCacheKeys(projectId, projectSlug)) {
    const suppressedPath = state.paths[key]
    if (suppressedPath) {
      return suppressedPath
    }
  }
  return null
}

function clearSuppressedProjectPath(projectId?: string | null, projectSlug?: string | null): void {
  const keys = getProjectPathCacheKeys(projectId, projectSlug)
  if (keys.length === 0) {
    return
  }

  const state = readSuppressedProjectPathState()
  let mutated = false
  for (const key of keys) {
    if (!(key in state.paths)) {
      continue
    }
    delete state.paths[key]
    mutated = true
  }

  if (mutated) {
    writeSuppressedProjectPathState(state)
  }
}

function writeSuppressedProjectPath(
  projectPath: string | null,
  projectId?: string | null,
  projectSlug?: string | null,
): void {
  const keys = getProjectPathCacheKeys(projectId, projectSlug)
  if (keys.length === 0) {
    return
  }

  const state = readSuppressedProjectPathState()
  const normalizedProjectPath = projectPath ? normalizeProjectPath(projectPath) : null

  let mutated = false
  for (const key of keys) {
    if (!normalizedProjectPath) {
      if (key in state.paths) {
        delete state.paths[key]
        mutated = true
      }
      continue
    }

    if (state.paths[key] !== normalizedProjectPath) {
      state.paths[key] = normalizedProjectPath
      mutated = true
    }
  }

  if (mutated) {
    writeSuppressedProjectPathState(state)
  }
}

function readCachedProjectPath(projectId?: string | null, projectSlug?: string | null): string | null {
  const suppressedPath = readSuppressedProjectPath(projectId, projectSlug)
  for (const key of getProjectPathCacheKeys(projectId, projectSlug)) {
    const cachedValue = projectPathCache.get(key)
    if (cachedValue && cachedValue !== suppressedPath) {
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
  clearSuppressedProjectPath(projectId, projectSlug)
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

function buildLocalProjectPathIdentityKey(options: {
  normalizedInitialPath: string | null
  preferInitialPath: boolean
  projectId?: string | null
  projectSlug?: string | null
  normalizedCloudPathHint?: string | null
  normalizedAttachedPathHint?: string | null
}): string {
  return [
    options.projectId ?? '',
    options.projectSlug ?? '',
    options.normalizedInitialPath ?? '',
    options.preferInitialPath ? '1' : '0',
    options.normalizedCloudPathHint ?? '',
    options.normalizedAttachedPathHint ?? '',
  ].join('::')
}

async function loadLocalProjectPath(
  projectId?: string | null,
  projectSlug?: string | null,
  cloudPathHint?: string | null,
  attachedPathHint?: string | null,
): Promise<string | null> {
  if (!projectId && !projectSlug) {
    return null
  }

  try {
    const resolvedPath = await window.electronAPI.project.getLocalPath({
      slug: projectSlug ?? '',
      projectId: projectId ?? undefined,
      localPathHint: cloudPathHint ?? undefined,
      attachedPathHint: attachedPathHint ?? undefined,
    })

    const normalizedResolvedPath = resolvedPath ? normalizeProjectPath(resolvedPath) : null
    const suppressedPath = readSuppressedProjectPath(projectId, projectSlug)
    return normalizedResolvedPath && normalizedResolvedPath === suppressedPath
      ? null
      : normalizedResolvedPath
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

export function suppressLocalProjectPath(
  projectId: string | null | undefined,
  projectPath: string | null | undefined,
  projectSlug?: string | null,
): void {
  if (!projectPath) {
    clearSuppressedProjectPath(projectId ?? null, projectSlug)
    return
  }

  writeSuppressedProjectPath(projectPath, projectId ?? null, projectSlug)
  writeCachedProjectPath(null, projectId ?? null, projectSlug)
}

export function useLocalProjectPath({
  initialPath = null,
  lookupOnMount = true,
  preferInitialPath = false,
  verifySeededPath = false,
  projectId = null,
  projectSlug = null,
  cloudPathHint = null,
  attachedPathHint = null,
}: UseLocalProjectPathOptions): UseLocalProjectPathResult {
  const normalizedInitialPath = useMemo(
    () => (initialPath ? normalizeProjectPath(initialPath) : null),
    [initialPath]
  )
  const normalizedCloudPathHint = useMemo(
    () => (cloudPathHint ? normalizeProjectPath(cloudPathHint) : null),
    [cloudPathHint],
  )
  const normalizedAttachedPathHint = useMemo(
    () => (attachedPathHint ? normalizeProjectPath(attachedPathHint) : null),
    [attachedPathHint],
  )
  const identityKey = useMemo(
    () =>
      buildLocalProjectPathIdentityKey({
        normalizedInitialPath,
        preferInitialPath,
        projectId,
        projectSlug,
        normalizedCloudPathHint,
        normalizedAttachedPathHint,
      }),
    [
      normalizedAttachedPathHint,
      normalizedCloudPathHint,
      normalizedInitialPath,
      preferInitialPath,
      projectId,
      projectSlug,
    ]
  )
  const seededPath = useMemo(
    () =>
      resolveSeededProjectPath({
        normalizedInitialPath,
        preferInitialPath,
        projectId,
        projectSlug,
      }),
    [normalizedInitialPath, preferInitialPath, projectId, projectSlug]
  )

  const [scoped, setScoped] = useState<ScopedLocalProjectPathState>(() => ({
    identityKey,
    localPath: seededPath,
  }))

  useEffect(() => {
    setScoped((current) => {
      if (current.identityKey === identityKey && current.localPath === seededPath) {
        return current
      }

      return {
        identityKey,
        localPath: seededPath,
      }
    })
    writeCachedProjectPath(seededPath, projectId, projectSlug)

    if ((seededPath && !verifySeededPath) || !lookupOnMount || (!projectId && !projectSlug)) {
      return
    }

    let cancelled = false

    void loadLocalProjectPath(
      projectId,
      projectSlug,
      normalizedCloudPathHint,
      normalizedAttachedPathHint,
    ).then((resolvedPath) => {
      if (cancelled) {
        return
      }
      setScoped((current) => {
        if (current.identityKey !== identityKey) {
          return current
        }

        return {
          identityKey,
          localPath: resolvedPath,
        }
      })
      writeCachedProjectPath(resolvedPath, projectId, projectSlug)
    })

    return () => {
      cancelled = true
    }
  }, [
    identityKey,
    lookupOnMount,
    normalizedAttachedPathHint,
    normalizedCloudPathHint,
    projectId,
    projectSlug,
    seededPath,
    verifySeededPath,
  ])

  const refreshLocalPath = useCallback(async () => {
    const resolvedPath = await loadLocalProjectPath(
      projectId,
      projectSlug,
      normalizedCloudPathHint,
      normalizedAttachedPathHint,
    )
    setScoped((current) => {
      if (current.identityKey !== identityKey) {
        return current
      }

      return {
        identityKey,
        localPath: resolvedPath,
      }
    })
    writeCachedProjectPath(resolvedPath, projectId, projectSlug)
    return resolvedPath
  }, [
    identityKey,
    normalizedAttachedPathHint,
    normalizedCloudPathHint,
    projectId,
    projectSlug,
  ])

  const localPath = scoped.identityKey === identityKey ? scoped.localPath : seededPath

  return {
    localPath,
    refreshLocalPath,
  }
}

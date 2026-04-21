import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { resolveKnownProjectPath } from './projectPathResolution'

interface ProjectPathRegistryEntry {
  path: string
  updatedAt: number
  verifiedAt: number
  source: 'manual' | 'cloud-hint' | 'attached-import' | 'slug-resolution'
}

interface ProjectPathRegistryState {
  version: 1
  projects: Record<string, ProjectPathRegistryEntry>
}

const REGISTRY_FILE_NAME = 'project-path-registry.json'
const projectPathCache = new Map<string, ProjectPathRegistryEntry>()

function getRegistryPath(): string {
  return path.join(app.getPath('userData'), REGISTRY_FILE_NAME)
}

function normalizeProjectId(projectId: string): string {
  return projectId.trim()
}

function normalizeExistingDirectory(projectPath: string | null | undefined): string | null {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    return null
  }

  try {
    const resolvedPath = path.resolve(projectPath.trim())
    if (!fs.existsSync(resolvedPath)) {
      return null
    }

    const stats = fs.statSync(resolvedPath)
    if (!stats.isDirectory()) {
      return null
    }

    return resolvedPath
  } catch {
    return null
  }
}

function readRegistryState(): ProjectPathRegistryState {
  const registryPath = getRegistryPath()
  try {
    if (!fs.existsSync(registryPath)) {
      return {
        version: 1,
        projects: {},
      }
    }

    const raw = fs.readFileSync(registryPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ProjectPathRegistryState> | null
    const projects =
      parsed?.projects && typeof parsed.projects === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.projects).filter(([, value]) => (
              !!value &&
              typeof value === 'object' &&
              typeof (value as ProjectPathRegistryEntry).path === 'string' &&
              (value as ProjectPathRegistryEntry).path.trim().length > 0
            )),
          )
        : {}

    return {
      version: 1,
      projects: projects as Record<string, ProjectPathRegistryEntry>,
    }
  } catch {
    return {
      version: 1,
      projects: {},
    }
  }
}

function writeRegistryState(state: ProjectPathRegistryState): void {
  const registryPath = getRegistryPath()
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, JSON.stringify(state, null, 2))
}

function dedupeProjectPaths(state: ProjectPathRegistryState): boolean {
  const latestProjectIdByPath = new Map<string, string>()
  let changed = false

  for (const [projectId, entry] of Object.entries(state.projects)) {
    const resolvedPath = path.resolve(entry.path)
    const existingProjectId = latestProjectIdByPath.get(resolvedPath)
    if (!existingProjectId) {
      latestProjectIdByPath.set(resolvedPath, projectId)
      continue
    }

    const existingEntry = state.projects[existingProjectId]
    if (!existingEntry) {
      latestProjectIdByPath.set(resolvedPath, projectId)
      continue
    }

    if (entry.updatedAt >= existingEntry.updatedAt) {
      delete state.projects[existingProjectId]
      latestProjectIdByPath.set(resolvedPath, projectId)
      changed = true
      continue
    }

    delete state.projects[projectId]
    changed = true
  }

  return changed
}

function normalizeRegistryEntry(entry: ProjectPathRegistryEntry): ProjectPathRegistryEntry | null {
  const normalizedPath = normalizeExistingDirectory(entry.path)
  if (!normalizedPath) {
    return null
  }

  return {
    path: normalizedPath,
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
    verifiedAt: Number.isFinite(entry.verifiedAt) ? entry.verifiedAt : Date.now(),
    source:
      entry.source === 'manual' ||
      entry.source === 'cloud-hint' ||
      entry.source === 'attached-import' ||
      entry.source === 'slug-resolution'
        ? entry.source
        : 'manual',
  }
}

function readRegisteredProjectPathEntry(projectId: string): ProjectPathRegistryEntry | null {
  const normalizedProjectId = normalizeProjectId(projectId)
  if (!normalizedProjectId) {
    return null
  }

  const cachedEntry = projectPathCache.get(normalizedProjectId)
  if (cachedEntry) {
    const normalizedCachedEntry = normalizeRegistryEntry(cachedEntry)
    if (normalizedCachedEntry) {
      projectPathCache.set(normalizedProjectId, normalizedCachedEntry)
      return normalizedCachedEntry
    }

    projectPathCache.delete(normalizedProjectId)
  }

  const state = readRegistryState()
  if (dedupeProjectPaths(state)) {
    writeRegistryState(state)
  }

  const entry = state.projects[normalizedProjectId]
  if (!entry) {
    return null
  }

  const normalizedEntry = normalizeRegistryEntry(entry)
  if (!normalizedEntry) {
    delete state.projects[normalizedProjectId]
    writeRegistryState(state)
    return null
  }

  if (
    normalizedEntry.path !== entry.path ||
    normalizedEntry.verifiedAt !== entry.verifiedAt ||
    normalizedEntry.updatedAt !== entry.updatedAt ||
    normalizedEntry.source !== entry.source
  ) {
    state.projects[normalizedProjectId] = normalizedEntry
    writeRegistryState(state)
  }

  projectPathCache.set(normalizedProjectId, normalizedEntry)
  return normalizedEntry
}

export function readRegisteredProjectPath(projectId: string): string | null {
  return readRegisteredProjectPathEntry(projectId)?.path ?? null
}

export function rememberProjectPath(
  projectId: string,
  projectPath: string,
  options?: {
    source?: ProjectPathRegistryEntry['source']
  },
): string {
  const normalizedProjectId = normalizeProjectId(projectId)
  const resolvedPath = normalizeExistingDirectory(projectPath)
  if (!normalizedProjectId) {
    throw new Error('projectId is required')
  }
  if (!resolvedPath) {
    throw new Error('projectPath must reference an existing directory')
  }

  const now = Date.now()
  const state = readRegistryState()
  state.projects[normalizedProjectId] = {
    path: resolvedPath,
    updatedAt: now,
    verifiedAt: now,
    source: options?.source ?? 'manual',
  }
  dedupeProjectPaths(state)
  writeRegistryState(state)
  projectPathCache.set(normalizedProjectId, state.projects[normalizedProjectId]!)
  return resolvedPath
}

export function clearRegisteredProjectPath(projectId: string): void {
  const normalizedProjectId = normalizeProjectId(projectId)
  if (!normalizedProjectId) return

  const state = readRegistryState()
  if (!(normalizedProjectId in state.projects)) {
    return
  }

  delete state.projects[normalizedProjectId]
  projectPathCache.delete(normalizedProjectId)
  writeRegistryState(state)
}

export function resolveCanonicalProjectPath(options: {
  projectId?: string | null
  slug?: string | null
  projectsDirectory?: string | null
  localPathHint?: string | null
  attachedPathHint?: string | null
}): string | null {
  const normalizedProjectId = normalizeProjectId(options.projectId ?? '')
  const resolvedAttachedPath = normalizeExistingDirectory(options.attachedPathHint)
  if (resolvedAttachedPath) {
    if (normalizedProjectId) {
      rememberProjectPath(normalizedProjectId, resolvedAttachedPath, {
        source: 'attached-import',
      })
    }
    return resolvedAttachedPath
  }

  if (normalizedProjectId) {
    const registeredPath = readRegisteredProjectPathEntry(normalizedProjectId)?.path
    if (registeredPath) {
      return registeredPath
    }
  }

  const candidates: Array<{
    path: string | null | undefined
    source: ProjectPathRegistryEntry['source']
  }> = [
    { path: options.localPathHint, source: 'cloud-hint' },
  ]

  for (const candidate of candidates) {
    const resolvedCandidatePath = normalizeExistingDirectory(candidate.path)
    if (!resolvedCandidatePath) {
      continue
    }

    if (normalizedProjectId) {
      rememberProjectPath(normalizedProjectId, resolvedCandidatePath, {
        source: candidate.source,
      })
    }
    return resolvedCandidatePath
  }

  const normalizedSlug = options.slug?.trim()
  const projectsDirectory = options.projectsDirectory?.trim()
  if (!normalizedSlug || !projectsDirectory) {
    return null
  }

  const resolvedKnownPath = resolveKnownProjectPath(projectsDirectory, {
    slug: normalizedSlug,
    projectId: normalizedProjectId || undefined,
  })

  if (!resolvedKnownPath) {
    return null
  }

  if (normalizedProjectId) {
    rememberProjectPath(normalizedProjectId, resolvedKnownPath, {
      source: 'slug-resolution',
    })
  }

  return resolvedKnownPath
}

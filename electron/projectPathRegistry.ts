import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface ProjectPathRegistryEntry {
  path: string
  updatedAt: number
}

interface ProjectPathRegistryState {
  version: 1
  projects: Record<string, ProjectPathRegistryEntry>
}

const REGISTRY_FILE_NAME = 'project-path-registry.json'

function getRegistryPath(): string {
  return path.join(app.getPath('userData'), REGISTRY_FILE_NAME)
}

function normalizeProjectId(projectId: string): string {
  return projectId.trim()
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

export function readRegisteredProjectPath(projectId: string): string | null {
  const normalizedProjectId = normalizeProjectId(projectId)
  if (!normalizedProjectId) return null

  const state = readRegistryState()
  const entry = state.projects[normalizedProjectId]
  if (!entry?.path) {
    return null
  }

  const resolvedPath = path.resolve(entry.path)
  if (!fs.existsSync(resolvedPath)) {
    delete state.projects[normalizedProjectId]
    writeRegistryState(state)
    return null
  }

  return resolvedPath
}

export function rememberProjectPath(projectId: string, projectPath: string): string {
  const normalizedProjectId = normalizeProjectId(projectId)
  const resolvedPath = path.resolve(projectPath)
  if (!normalizedProjectId) {
    throw new Error('projectId is required')
  }

  const state = readRegistryState()
  state.projects[normalizedProjectId] = {
    path: resolvedPath,
    updatedAt: Date.now(),
  }
  writeRegistryState(state)
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
  writeRegistryState(state)
}

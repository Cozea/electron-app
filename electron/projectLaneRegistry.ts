import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface ProjectLaneDescriptor {
  id: string
  name: string
  branch: string
  projectPath: string
  isCollab: boolean
  createdAt: number
  updatedAt: number
}

export interface ProjectLaneState {
  activeLaneId: string | null
  collabLaneId: string
  lanes: ProjectLaneDescriptor[]
}

interface ProjectLaneRegistryProjectState {
  activeLaneId: string | null
  collabLaneId: string
  lanes: Record<string, ProjectLaneDescriptor>
}

interface ProjectLaneRegistryState {
  version: 1
  projects: Record<string, ProjectLaneRegistryProjectState>
}

const REGISTRY_FILE_NAME = 'project-lane-registry.json'
const COLLAB_LANE_ID = 'collab'

function getRegistryPath(): string {
  return path.join(app.getPath('userData'), REGISTRY_FILE_NAME)
}

function normalizeProjectId(projectId: string): string {
  return projectId.trim()
}

function normalizeLaneId(laneId: string): string {
  return laneId.trim()
}

function sanitizeLaneName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function createLaneId(branch: string, isCollab: boolean): string {
  if (isCollab) return COLLAB_LANE_ID
  const sanitized = sanitizeLaneName(branch)
  return `lane:${sanitized || 'branch'}`
}

function readRegistryState(): ProjectLaneRegistryState {
  const registryPath = getRegistryPath()

  try {
    if (!fs.existsSync(registryPath)) {
      return { version: 1, projects: {} }
    }

    const raw = fs.readFileSync(registryPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ProjectLaneRegistryState> | null
    const projects =
      parsed?.projects && typeof parsed.projects === 'object'
        ? parsed.projects
        : {}

    return {
      version: 1,
      projects: projects as Record<string, ProjectLaneRegistryProjectState>,
    }
  } catch {
    return { version: 1, projects: {} }
  }
}

function writeRegistryState(state: ProjectLaneRegistryState): void {
  const registryPath = getRegistryPath()
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, JSON.stringify(state, null, 2))
}

function dedupeProjectLanePaths(state: ProjectLaneRegistryState): boolean {
  const latestOwnerByPath = new Map<string, { projectId: string; updatedAt: number }>()
  let changed = false

  for (const [projectId, projectState] of Object.entries(state.projects)) {
    for (const lane of Object.values(projectState.lanes)) {
      if (!lane?.projectPath) {
        continue
      }

      const resolvedPath = path.resolve(lane.projectPath)
      const existingOwner = latestOwnerByPath.get(resolvedPath)
      if (!existingOwner || lane.updatedAt >= existingOwner.updatedAt) {
        latestOwnerByPath.set(resolvedPath, { projectId, updatedAt: lane.updatedAt })
      }
    }
  }

  for (const [projectId, projectState] of Object.entries(state.projects)) {
    const nextLanes = Object.fromEntries(
      Object.entries(projectState.lanes).filter(([, lane]) => {
        if (!lane?.projectPath) {
          return false
        }

        const resolvedPath = path.resolve(lane.projectPath)
        const owner = latestOwnerByPath.get(resolvedPath)
        return owner?.projectId === projectId
      }),
    )

    if (Object.keys(nextLanes).length === Object.keys(projectState.lanes).length) {
      continue
    }

    changed = true
    if (Object.keys(nextLanes).length === 0) {
      delete state.projects[projectId]
      continue
    }

    state.projects[projectId] = {
      ...projectState,
      lanes: nextLanes,
      activeLaneId: nextLanes[projectState.activeLaneId ?? ''] ? projectState.activeLaneId : null,
      collabLaneId: nextLanes[projectState.collabLaneId]
        ? projectState.collabLaneId
        : Object.keys(nextLanes)[0]!,
    }
  }

  return changed
}

function serializeProjectState(
  projectState: ProjectLaneRegistryProjectState | undefined,
): ProjectLaneState | null {
  if (!projectState) return null

  const nextLanes = Object.values(projectState.lanes)
    .filter((lane) => {
      if (!lane?.projectPath) return false
      const resolvedPath = path.resolve(lane.projectPath)
      return fs.existsSync(resolvedPath)
    })
    .map((lane) => ({
      ...lane,
      projectPath: path.resolve(lane.projectPath),
    }))
    .sort((left, right) => {
      if (left.isCollab !== right.isCollab) return left.isCollab ? -1 : 1
      return right.updatedAt - left.updatedAt
    })

  if (nextLanes.length === 0) return null

  const nextLaneIds = new Set(nextLanes.map((lane) => lane.id))
  const nextCollabLaneId = nextLaneIds.has(projectState.collabLaneId)
    ? projectState.collabLaneId
    : nextLanes.find((lane) => lane.isCollab)?.id ?? nextLanes[0]!.id
  const nextActiveLaneId =
    projectState.activeLaneId && nextLaneIds.has(projectState.activeLaneId)
      ? projectState.activeLaneId
      : nextCollabLaneId

  return {
    activeLaneId: nextActiveLaneId,
    collabLaneId: nextCollabLaneId,
    lanes: nextLanes,
  }
}

function readProjectState(projectId: string): {
  state: ProjectLaneRegistryState
  projectState: ProjectLaneRegistryProjectState | undefined
} {
  const normalizedProjectId = normalizeProjectId(projectId)
  const state = readRegistryState()
  return {
    state,
    projectState: normalizedProjectId ? state.projects[normalizedProjectId] : undefined,
  }
}

export function readProjectLaneState(projectId: string): ProjectLaneState | null {
  const normalizedProjectId = normalizeProjectId(projectId)
  if (!normalizedProjectId) return null

  const { state } = readProjectState(normalizedProjectId)
  if (dedupeProjectLanePaths(state)) {
    writeRegistryState(state)
  }
  const nextProjectState = state.projects[normalizedProjectId]
  const serialized = serializeProjectState(nextProjectState)

  if (!serialized && nextProjectState) {
    delete state.projects[normalizedProjectId]
    writeRegistryState(state)
  }

  return serialized
}

export function ensureProjectCollabLane(args: {
  projectId: string
  projectPath: string
  branch: string
}): ProjectLaneState {
  const normalizedProjectId = normalizeProjectId(args.projectId)
  const resolvedProjectPath = path.resolve(args.projectPath)
  const normalizedBranch = args.branch.trim() || 'main'

  if (!normalizedProjectId) {
    throw new Error('projectId is required')
  }

  const state = readRegistryState()
  const existingProjectState = state.projects[normalizedProjectId]
  const now = Date.now()
  const collabLane: ProjectLaneDescriptor = {
    id: COLLAB_LANE_ID,
    name: 'Collab',
    branch: normalizedBranch,
    projectPath: resolvedProjectPath,
    isCollab: true,
    createdAt: existingProjectState?.lanes[COLLAB_LANE_ID]?.createdAt ?? now,
    updatedAt: now,
  }

  const nextProjectState: ProjectLaneRegistryProjectState = {
    activeLaneId: existingProjectState?.activeLaneId ?? COLLAB_LANE_ID,
    collabLaneId: COLLAB_LANE_ID,
    lanes: {
      ...(existingProjectState?.lanes ?? {}),
      [COLLAB_LANE_ID]: collabLane,
    },
  }

  state.projects[normalizedProjectId] = nextProjectState
  dedupeProjectLanePaths(state)
  writeRegistryState(state)

  return serializeProjectState(state.projects[normalizedProjectId]) as ProjectLaneState
}

export function upsertProjectLane(args: {
  projectId: string
  branch: string
  projectPath: string
  name?: string
  isCollab?: boolean
  laneId?: string
}): ProjectLaneState {
  const normalizedProjectId = normalizeProjectId(args.projectId)
  if (!normalizedProjectId) {
    throw new Error('projectId is required')
  }

  const normalizedBranch = args.branch.trim()
  if (!normalizedBranch) {
    throw new Error('branch is required')
  }

  const resolvedProjectPath = path.resolve(args.projectPath)
  const laneId = normalizeLaneId(
    args.laneId ?? createLaneId(normalizedBranch, args.isCollab === true),
  )

  const state = readRegistryState()
  const existingProjectState = state.projects[normalizedProjectId]
  const now = Date.now()
  const existingLane = existingProjectState?.lanes[laneId]
  const nextLane: ProjectLaneDescriptor = {
    id: laneId,
    name: args.name?.trim() || normalizedBranch,
    branch: normalizedBranch,
    projectPath: resolvedProjectPath,
    isCollab: args.isCollab === true,
    createdAt: existingLane?.createdAt ?? now,
    updatedAt: now,
  }

  const nextProjectState: ProjectLaneRegistryProjectState = {
    activeLaneId: existingProjectState?.activeLaneId ?? (nextLane.isCollab ? COLLAB_LANE_ID : laneId),
    collabLaneId: existingProjectState?.collabLaneId ?? COLLAB_LANE_ID,
    lanes: {
      ...(existingProjectState?.lanes ?? {}),
      [laneId]: nextLane,
    },
  }

  state.projects[normalizedProjectId] = nextProjectState
  dedupeProjectLanePaths(state)
  writeRegistryState(state)

  return serializeProjectState(state.projects[normalizedProjectId]) as ProjectLaneState
}

export function setActiveProjectLane(args: {
  projectId: string
  laneId: string
}): ProjectLaneState {
  const normalizedProjectId = normalizeProjectId(args.projectId)
  const normalizedLaneId = normalizeLaneId(args.laneId)

  if (!normalizedProjectId) {
    throw new Error('projectId is required')
  }

  if (!normalizedLaneId) {
    throw new Error('laneId is required')
  }

  const state = readRegistryState()
  const existingProjectState = state.projects[normalizedProjectId]

  if (!existingProjectState?.lanes[normalizedLaneId]) {
    throw new Error('lane not found')
  }

  const nextProjectState: ProjectLaneRegistryProjectState = {
    ...existingProjectState,
    activeLaneId: normalizedLaneId,
  }

  state.projects[normalizedProjectId] = nextProjectState
  writeRegistryState(state)

  return serializeProjectState(nextProjectState) as ProjectLaneState
}

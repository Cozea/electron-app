import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"

const STORAGE_KEY = "cozea:project-branch-sessions:v1"
const COLLAB_LANE_ID = "collab"

interface StoredProjectBranchSession {
  projectId: string
  activeBranch: string | null
  collabBranch: string
  projectPath: string | null
  updatedAt: number
}

interface StoredProjectBranchSessionState {
  version: 1
  projects: Record<string, StoredProjectBranchSession>
}

function normalizeProjectId(projectId: string | null | undefined): string | null {
  const trimmed = projectId?.trim()
  return trimmed ? trimmed : null
}

function normalizeBranch(value: string | null | undefined, fallback = "main"): string {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function normalizeProjectPath(projectPath: string | null | undefined): string | null {
  const trimmed = projectPath?.trim()
  return trimmed ? trimmed : null
}

function buildInitialState(): StoredProjectBranchSessionState {
  return {
    version: 1,
    projects: {},
  }
}

function readState(): StoredProjectBranchSessionState {
  if (typeof window === "undefined") {
    return buildInitialState()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return buildInitialState()
    }

    const parsed = JSON.parse(raw) as Partial<StoredProjectBranchSessionState> | null
    if (!parsed || parsed.version !== 1 || !parsed.projects || typeof parsed.projects !== "object") {
      return buildInitialState()
    }

    return {
      version: 1,
      projects: parsed.projects as Record<string, StoredProjectBranchSession>,
    }
  } catch {
    return buildInitialState()
  }
}

function writeState(state: StoredProjectBranchSessionState): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function buildBranchSessionLaneId(branch: string, collabBranch: string): string {
  if (normalizeBranch(branch) === normalizeBranch(collabBranch)) {
    return COLLAB_LANE_ID
  }

  const sanitized = branch
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `branch:${sanitized || "local"}`
}

export function readProjectBranchSession(projectId: string | null | undefined): StoredProjectBranchSession | null {
  const normalizedProjectId = normalizeProjectId(projectId)
  if (!normalizedProjectId) {
    return null
  }

  return readState().projects[normalizedProjectId] ?? null
}

export function rememberProjectBranchSession(args: {
  projectId: string
  branch: string
  collabBranch: string
  projectPath: string | null
}): StoredProjectBranchSession {
  const normalizedProjectId = normalizeProjectId(args.projectId)
  if (!normalizedProjectId) {
    throw new Error("projectId is required")
  }

  const nextSession: StoredProjectBranchSession = {
    projectId: normalizedProjectId,
    activeBranch: normalizeBranch(args.branch, args.collabBranch),
    collabBranch: normalizeBranch(args.collabBranch),
    projectPath: normalizeProjectPath(args.projectPath),
    updatedAt: Date.now(),
  }

  const state = readState()
  state.projects[normalizedProjectId] = nextSession
  writeState(state)
  return nextSession
}

export function buildProjectBranchLaneState(args: {
  projectId: string
  projectPath: string | null
  collabBranch: string
  activeBranch: string | null
}): ProjectLaneState | null {
  const normalizedProjectId = normalizeProjectId(args.projectId)
  const normalizedProjectPath = normalizeProjectPath(args.projectPath)
  if (!normalizedProjectId || !normalizedProjectPath) {
    return null
  }

  const normalizedCollabBranch = normalizeBranch(args.collabBranch)
  const normalizedActiveBranch = normalizeBranch(args.activeBranch, normalizedCollabBranch)
  const now = Date.now()

  const collabLane: ProjectLaneDescriptor = {
    id: COLLAB_LANE_ID,
    name: "Shared",
    branch: normalizedCollabBranch,
    projectPath: normalizedProjectPath,
    isCollab: true,
    createdAt: now,
    updatedAt: now,
  }

  const lanes: ProjectLaneDescriptor[] = [collabLane]
  let activeLaneId = collabLane.id

  if (normalizedActiveBranch !== normalizedCollabBranch) {
    const localLane: ProjectLaneDescriptor = {
      id: buildBranchSessionLaneId(normalizedActiveBranch, normalizedCollabBranch),
      name: normalizedActiveBranch,
      branch: normalizedActiveBranch,
      projectPath: normalizedProjectPath,
      isCollab: false,
      createdAt: now,
      updatedAt: now,
    }
    lanes.push(localLane)
    activeLaneId = localLane.id
  }

  return {
    activeLaneId,
    collabLaneId: collabLane.id,
    lanes,
  }
}

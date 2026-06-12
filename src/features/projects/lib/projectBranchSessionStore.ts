import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"

const STORAGE_KEY = "cozea:project-branch-sessions:v1"
const COLLAB_LANE_ID = "collab"
const LOCAL_LANE_PREFIX = "branch:"

interface StoredProjectBranchSession {
  projectId: string
  activeBranch: string | null
  collabBranch: string
  workspaceId: string | null
  updatedAt: number
}

interface StoredProjectBranchSessionState {
  version: 2
  sessions: Record<string, StoredProjectBranchSession>
}

function normalizeProjectId(projectId: string | null | undefined): string | null {
  const trimmed = projectId?.trim()
  return trimmed ? trimmed : null
}

function normalizeBranch(value: string | null | undefined, fallback = "main"): string {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function normalizeProjectPath(workspaceId: string | null | undefined): string | null {
  const trimmed = workspaceId?.trim()
  return trimmed ? trimmed : null
}

function buildInitialState(): StoredProjectBranchSessionState {
  return {
    version: 2,
    sessions: {},
  }
}

function buildSessionStorageKey(
  projectId: string,
  workspaceId: string | null | undefined,
): string {
  const normalizedProjectId = normalizeProjectId(projectId)
  if (!normalizedProjectId) {
    throw new Error("projectId is required")
  }

  const normalizedProjectPath = normalizeProjectPath(workspaceId)
  return `${normalizedProjectId}::${normalizedProjectPath ?? "unbound"}`
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

    const parsed = JSON.parse(raw) as {
      version?: number
      sessions?: unknown
      projects?: unknown
    } | null
    if (!parsed || typeof parsed !== "object") {
      return buildInitialState()
    }

    if (
      parsed.version === 2 &&
      parsed.sessions &&
      typeof parsed.sessions === "object"
    ) {
      return {
        version: 2,
        sessions: parsed.sessions as Record<string, StoredProjectBranchSession>,
      }
    }

    const legacyProjects =
      parsed.version === 1 &&
      "projects" in parsed &&
      parsed.projects &&
      typeof parsed.projects === "object"
        ? (parsed.projects as Record<string, StoredProjectBranchSession>)
        : null

    if (!legacyProjects) {
      return buildInitialState()
    }

    const nextState = buildInitialState()
    for (const session of Object.values(legacyProjects)) {
      const normalizedProjectId = normalizeProjectId(session.projectId)
      if (!normalizedProjectId) {
        continue
      }

      nextState.sessions[
        buildSessionStorageKey(normalizedProjectId, session.workspaceId)
      ] = {
        ...session,
        projectId: normalizedProjectId,
        workspaceId: normalizeProjectPath(session.workspaceId),
      }
    }

    return nextState
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

  return `${LOCAL_LANE_PREFIX}${encodeURIComponent(normalizeBranch(branch, collabBranch))}`
}

export type LaneBranchResolution =
  | { kind: "resolved"; branch: string; remember: boolean }
  | { kind: "unresolved" }

interface GitStatusLike {
  success?: boolean
  isRepo?: boolean
  currentBranch?: string | null
}

/**
 * Decide which branch a workspace's lane state is built from. Lane ids derive
 * from `branch === collabBranch`, so the branch must never be guessed: a
 * fabricated fallback flips the workbench scope key and strands every open
 * tile under the previous key (the "came back to an empty workspace" bug).
 *
 * Only two answers are allowed to resolve a branch we'll act on:
 *  - a successful git status (fresh truth; the only case worth persisting), or
 *  - the stored branch session (last fresh truth).
 * A definitive "not a git repo" resolves to the collab lane — that is its
 * stable home, not a guess. Anything transient (IPC rejection, authorization
 * not ready, git error) with no prior knowledge stays unresolved and the
 * caller retries.
 */
export function resolveLaneBranchKnowledge(args: {
  statusResult: GitStatusLike | null | undefined
  storedBranch: string | null
  collabBranch: string
}): LaneBranchResolution {
  const { statusResult, storedBranch, collabBranch } = args

  const freshBranch = statusResult?.success ? statusResult.currentBranch?.trim() : null
  if (freshBranch) {
    return { kind: "resolved", branch: freshBranch, remember: true }
  }

  if (statusResult?.success && statusResult.isRepo === false) {
    return { kind: "resolved", branch: collabBranch, remember: false }
  }

  if (storedBranch?.trim()) {
    return { kind: "resolved", branch: storedBranch.trim(), remember: false }
  }

  // Repo with no readable branch (detached HEAD, unborn HEAD) and no history:
  // collab is as good as it gets, and it is stable for that repo state.
  if (statusResult?.success && statusResult.isRepo) {
    return { kind: "resolved", branch: collabBranch, remember: false }
  }

  return { kind: "unresolved" }
}

export function resolveBranchSessionLaneBranch(
  laneId: string | null | undefined,
  collabBranch: string,
): string | null {
  const normalizedLaneId = laneId?.trim()
  if (!normalizedLaneId) {
    return null
  }

  if (normalizedLaneId === COLLAB_LANE_ID) {
    return normalizeBranch(collabBranch)
  }

  if (!normalizedLaneId.startsWith(LOCAL_LANE_PREFIX)) {
    return null
  }

  const encodedBranch = normalizedLaneId.slice(LOCAL_LANE_PREFIX.length)
  if (!encodedBranch) {
    return null
  }

  try {
    return normalizeBranch(decodeURIComponent(encodedBranch), collabBranch)
  } catch {
    return null
  }
}

export function readProjectBranchSession(projectId: string | null | undefined): StoredProjectBranchSession | null {
  const normalizedProjectId = normalizeProjectId(projectId)
  if (!normalizedProjectId) {
    return null
  }

  const matchingSessions = Object.values(readState().sessions)
    .filter((session) => session.projectId === normalizedProjectId)
    .sort((left, right) => right.updatedAt - left.updatedAt)

  return matchingSessions[0] ?? null
}

export function readScopedProjectBranchSession(
  projectId: string | null | undefined,
  workspaceId: string | null | undefined,
): StoredProjectBranchSession | null {
  const normalizedProjectId = normalizeProjectId(projectId)
  if (!normalizedProjectId) {
    return null
  }

  return (
    readState().sessions[
      buildSessionStorageKey(normalizedProjectId, workspaceId)
    ] ?? null
  )
}

export function rememberProjectBranchSession(args: {
  projectId: string
  branch: string
  collabBranch: string
  workspaceId: string | null
}): StoredProjectBranchSession {
  const normalizedProjectId = normalizeProjectId(args.projectId)
  if (!normalizedProjectId) {
    throw new Error("projectId is required")
  }

  const nextSession: StoredProjectBranchSession = {
    projectId: normalizedProjectId,
    activeBranch: normalizeBranch(args.branch, args.collabBranch),
    collabBranch: normalizeBranch(args.collabBranch),
    workspaceId: normalizeProjectPath(args.workspaceId),
    updatedAt: Date.now(),
  }

  const state = readState()
  state.sessions[
    buildSessionStorageKey(normalizedProjectId, nextSession.workspaceId)
  ] = nextSession
  writeState(state)
  return nextSession
}

export function clearProjectBranchSession(
  projectId: string | null | undefined,
  workspaceId?: string | null,
): void {
  const normalizedProjectId = normalizeProjectId(projectId)
  if (!normalizedProjectId) {
    return
  }

  const state = readState()
  const normalizedProjectPath = normalizeProjectPath(workspaceId)

  if (normalizedProjectPath) {
    const scopedKey = buildSessionStorageKey(normalizedProjectId, normalizedProjectPath)
    if (!(scopedKey in state.sessions)) {
      return
    }
    delete state.sessions[scopedKey]
    writeState(state)
    return
  }

  let changed = false
  for (const [storageKey, session] of Object.entries(state.sessions)) {
    if (session.projectId !== normalizedProjectId) {
      continue
    }

    delete state.sessions[storageKey]
    changed = true
  }

  if (!changed) {
    return
  }

  writeState(state)
}

export function activateProjectBranchLane(args: {
  projectId: string
  laneId: string
  collabBranch: string
  workspaceId: string | null
}): StoredProjectBranchSession | null {
  const branch = resolveBranchSessionLaneBranch(args.laneId, args.collabBranch)
  if (!branch) {
    return null
  }

  return rememberProjectBranchSession({
    projectId: args.projectId,
    branch,
    collabBranch: args.collabBranch,
    workspaceId: args.workspaceId,
  })
}

export function buildProjectBranchLaneState(args: {
  projectId: string
  workspaceId: string | null
  collabBranch: string
  activeBranch: string | null
}): ProjectLaneState | null {
  const normalizedProjectId = normalizeProjectId(args.projectId)
  const normalizedProjectPath = normalizeProjectPath(args.workspaceId)
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
    workspaceId: normalizedProjectPath,
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
      workspaceId: normalizedProjectPath,
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

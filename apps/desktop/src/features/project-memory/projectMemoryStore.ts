import { create } from "zustand"

import type {
  ProjectMemoryGraph,
  ProjectMemoryNodeDetail,
  ProjectMemoryStatus,
} from "@shared/electronApiTypes"

/**
 * Mirror of the graph agents maintain on disk. Keyed by workspace::lane so a
 * project switch cannot show another project's memory, and so the dock header
 * and the tile body read the same truth.
 */

export interface ProjectMemoryUpdateState {
  agentName: string
  /** Which agent tile is doing the work, so its failure can be matched back. */
  targetTileId: string
  startedAt: number
  /** Build identity when the request was sent; a change means the agent finished. */
  baselineSignature: string
}

export interface ProjectMemoryRunState {
  updating: ProjectMemoryUpdateState | null
  status: ProjectMemoryStatus | null
  graph: ProjectMemoryGraph | null
  detail: ProjectMemoryNodeDetail | null
  selectedNodeId: string | null
  loading: boolean
  error: string | null
}

interface ProjectMemoryStoreState {
  byKey: Record<string, ProjectMemoryRunState>
}

export const DEFAULT_PROJECT_MEMORY_RUN: ProjectMemoryRunState = Object.freeze({
  updating: null,
  status: null,
  graph: null,
  detail: null,
  selectedNodeId: null,
  loading: false,
  error: null,
}) as ProjectMemoryRunState

const DEFAULT_LANE_ID = "collab"

export function buildProjectMemoryKey(workspaceId: string, laneId?: string | null): string {
  const trimmed = laneId?.trim()
  return `${workspaceId}::${trimmed && trimmed.length > 0 ? trimmed : DEFAULT_LANE_ID}`
}

export const useProjectMemoryStore = create<ProjectMemoryStoreState>()(() => ({ byKey: {} }))

function patch(key: string, update: Partial<ProjectMemoryRunState>): void {
  useProjectMemoryStore.setState((state) => ({
    byKey: {
      ...state.byKey,
      [key]: { ...(state.byKey[key] ?? DEFAULT_PROJECT_MEMORY_RUN), ...update },
    },
  }))
}

export function getProjectMemoryRun(key: string): ProjectMemoryRunState {
  return useProjectMemoryStore.getState().byKey[key] ?? DEFAULT_PROJECT_MEMORY_RUN
}

export function clearProjectMemoryForWorkspace(workspaceId: string): void {
  const normalized = workspaceId.trim()
  if (!normalized) return
  const prefix = `${normalized}::`
  useProjectMemoryStore.setState((state) => {
    const next = Object.fromEntries(
      Object.entries(state.byKey).filter(([key]) => !key.startsWith(prefix)),
    )
    return Object.keys(next).length === Object.keys(state.byKey).length ? state : { byKey: next }
  })
}

/** Reload status and graph for a workspace/lane. Safe to call repeatedly. */
export async function refreshProjectMemory(
  key: string,
  workspaceId: string,
  laneId: string | null,
): Promise<void> {
  const api = typeof window !== "undefined" ? window.electronAPI?.projectMemory : undefined
  if (!api) {
    patch(key, { loading: false, error: "Project memory is unavailable in this environment." })
    return
  }

  patch(key, { loading: true, error: null })
  try {
    const status = await api.getStatus({ workspaceId, laneId })
    if (!status.available) {
      patch(key, { status, graph: null, detail: null, loading: false })
      return
    }
    const graph = await api.getGraph({ workspaceId, laneId })
    patch(key, {
      status,
      graph,
      loading: false,
      error: graph ? null : "The graph file could not be read.",
    })
  } catch (error) {
    patch(key, {
      loading: false,
      error: error instanceof Error ? error.message : "Failed to read project memory.",
    })
  }
}

export async function selectProjectMemoryNode(
  key: string,
  workspaceId: string,
  laneId: string | null,
  nodeId: string | null,
): Promise<void> {
  if (!nodeId) {
    patch(key, { selectedNodeId: null, detail: null })
    return
  }

  patch(key, { selectedNodeId: nodeId })
  const api = typeof window !== "undefined" ? window.electronAPI?.projectMemory : undefined
  if (!api) return

  try {
    const detail = await api.getNodeDetail({ workspaceId, laneId, nodeId })
    // A slower response for a node the user already moved off must not
    // overwrite the newer selection.
    if (getProjectMemoryRun(key).selectedNodeId === nodeId) {
      patch(key, { detail })
    }
  } catch {
    patch(key, { detail: null })
  }
}

function signatureOf(status: ProjectMemoryStatus | null): string {
  return `${status?.builtAtCommit ?? ""}:${status?.generatedAt ?? 0}:${status?.nodeCount ?? 0}`
}

const POLL_INTERVAL_MS = 4000
/** Agents can take a while on a large repo; give up rather than spin forever. */
const UPDATE_TIMEOUT_MS = 15 * 60 * 1000
const pollTimers = new Map<string, ReturnType<typeof setInterval>>()

function stopPolling(key: string): void {
  const timer = pollTimers.get(key)
  if (timer) {
    clearInterval(timer)
    pollTimers.delete(key)
  }
}

/**
 * Mark an update in flight and watch the graph file for a new build. Completion
 * is observed rather than reported: the agent writes the graph on its own
 * schedule and has no channel back to this surface.
 */
export function startProjectMemoryUpdate(
  key: string,
  workspaceId: string,
  laneId: string | null,
  agentName: string,
  targetTileId: string,
): void {
  const current = getProjectMemoryRun(key)
  patch(key, {
    error: null,
    updating: {
      agentName,
      targetTileId,
      startedAt: Date.now(),
      baselineSignature: signatureOf(current.status),
    },
  })

  stopPolling(key)
  const timer = setInterval(() => {
    void (async () => {
      const run = getProjectMemoryRun(key)
      if (!run.updating) {
        stopPolling(key)
        return
      }
      if (Date.now() - run.updating.startedAt > UPDATE_TIMEOUT_MS) {
        stopPolling(key)
        patch(key, { updating: null })
        return
      }

      const api = typeof window !== "undefined" ? window.electronAPI?.projectMemory : undefined
      if (!api) return
      try {
        const status = await api.getStatus({ workspaceId, laneId })
        if (signatureOf(status) !== run.updating.baselineSignature) {
          stopPolling(key)
          patch(key, { updating: null })
          await refreshProjectMemory(key, workspaceId, laneId)
        }
      } catch {
        // Transient read failure; the next tick tries again.
      }
    })()
  }, POLL_INTERVAL_MS)
  pollTimers.set(key, timer)
}

export function cancelProjectMemoryUpdate(key: string): void {
  stopPolling(key)
  patch(key, { updating: null })
}

/**
 * The agent could not do it. Stop waiting and say why, rather than polling out
 * the full timeout for a build that will never arrive.
 */
export function failProjectMemoryUpdate(key: string, message: string): void {
  stopPolling(key)
  patch(key, { updating: null, error: message })
}

export function clearProjectMemoryError(key: string): void {
  patch(key, { error: null })
}

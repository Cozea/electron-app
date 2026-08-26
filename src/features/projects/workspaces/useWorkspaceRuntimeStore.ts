import { create } from "zustand"

import type { Id } from "../../../../convex/_generated/dataModel"
import {
  EMPTY_YJS_PROJECT_CONTEXT_VALUE,
  type YjsProjectContextValue,
} from "@/contexts/YjsProjectContextValue"
import type { ProjectSyncContextValue } from "@/features/projects/contexts/projectSyncShared"
import { buildWorkspaceIdentityKey, normalizeWorkspaceLaneId } from "@/features/projects/workspaces/workspaceIdentity"
import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"

export type WorkspaceRuntimeLifecycle =
  | "focused"
  | "background-hot"
  | "background-warm"
  | "background-frozen"
  | "closed"

const BACKGROUND_WARM_IDLE_MS = 2 * 60 * 1000
const BACKGROUND_FROZEN_IDLE_MS = 10 * 60 * 1000

export interface WorkspaceRuntimeConfig {
  workspaceId: string
  projectId: Id<"projects"> | null
  userId: Id<"users"> | null
  userName: string | null
  projectSlug: string | null
  laneId: string
  gitCwd: string | null
  lastSyncAt: number | null
  collaborationEnabled: boolean
  activeBranch: string | null
  sharedBranch: string | null
  documentScopeId: string | null
  workspaceRevision: number
}

export interface WorkspaceRuntimeSignals {
  hasConnectedCollab: boolean
  hasSyncActivity: boolean
  hasRunningTerminals: boolean
  hasRunningDevServer: boolean
  hasVisibleBrowserSurface: boolean
  hasNativePreview: boolean
  pendingSyncStatus: string | null
  lastActivityAt: number | null
  lifecycleReason: string
}

export interface WorkspaceRuntimeRecord {
  runtimeId: string
  workspaceId: string
  config: WorkspaceRuntimeConfig
  syncContext: ProjectSyncContextValue | null
  yjsContext: YjsProjectContextValue
  routeAttachmentCount: number
  lifecycle: WorkspaceRuntimeLifecycle
  signals: WorkspaceRuntimeSignals
  sessionKey: string | null
  sessionSnapshot: WorkbenchSessionSnapshot | null
  createdAt: number
  lastAttachedAt: number | null
  lastDetachedAt: number | null
}

interface WorkspaceRuntimeState {
  runtimes: Record<string, WorkspaceRuntimeRecord>
  suppressedProjectIds: Record<string, true>
  actions: {
    ensureRuntime: (config: WorkspaceRuntimeConfig) => string | null
    attachRuntime: (runtimeId: string) => void
    detachRuntime: (runtimeId: string) => void
    publishSyncContext: (runtimeId: string, value: ProjectSyncContextValue | null) => void
    publishYjsContext: (runtimeId: string, value: YjsProjectContextValue) => void
    clearPublishedContexts: (runtimeId: string) => void
    bindSessionSnapshot: (runtimeId: string, snapshot: WorkbenchSessionSnapshot | null) => void
    refreshLifecycles: () => void
    closeRuntime: (runtimeId: string) => void
    /** Hard-stop hosting for a deleted/removing project. Prevents focused-route revive. */
    suppressProject: (projectId: string) => void
  }
}

function readSignalState(
  record: Pick<
    WorkspaceRuntimeRecord,
    "config" | "syncContext" | "yjsContext" | "routeAttachmentCount" | "sessionSnapshot" | "lastAttachedAt" | "lastDetachedAt"
  >,
  now: number,
): Omit<WorkspaceRuntimeSignals, "lifecycleReason"> {
  const pendingSyncStatus = record.syncContext?.syncProgress.status ?? null
  const hasSyncActivity =
    pendingSyncStatus === "checking" ||
    pendingSyncStatus === "planning" ||
    pendingSyncStatus === "syncing"
  const hasConnectedCollab = record.yjsContext.isConnected
  const terminalBindingCount = Object.keys(record.sessionSnapshot?.terminalBindings ?? {}).length
  const hasRunningTerminals = terminalBindingCount > 0
  const hasRunningDevServer = Boolean(record.sessionSnapshot?.devServer.running)
  const hasVisibleBrowserSurface = Boolean(record.sessionSnapshot?.hasBrowserSurface)
  const hasNativePreview = Boolean(record.sessionSnapshot?.hasNativePreviewSession)
  // Do not stamp `now` for steady-state collab/sync — that forces lifecycle churn every refresh.
  const lastActivityAt = Math.max(
    record.lastAttachedAt ?? 0,
    record.lastDetachedAt ?? 0,
    record.sessionSnapshot?.lastFocusedAt ?? 0,
    record.sessionSnapshot?.lastBackgroundedAt ?? 0,
    record.syncContext?.lastSyncAt ?? 0,
    record.config.lastSyncAt ?? 0,
    hasSyncActivity ? now : 0,
  ) || null

  return {
    hasConnectedCollab,
    hasSyncActivity,
    hasRunningTerminals,
    hasRunningDevServer,
    hasVisibleBrowserSurface,
    hasNativePreview,
    pendingSyncStatus,
    lastActivityAt,
  }
}

function resolveLifecycle(
  record: Pick<
    WorkspaceRuntimeRecord,
    "config" | "syncContext" | "yjsContext" | "routeAttachmentCount" | "sessionSnapshot" | "lastAttachedAt" | "lastDetachedAt"
  >,
  now = Date.now(),
): Pick<WorkspaceRuntimeRecord, "lifecycle" | "signals"> {
  const signals = readSignalState(record, now)
  const backgroundAge = signals.lastActivityAt ? Math.max(0, now - signals.lastActivityAt) : Number.POSITIVE_INFINITY

  let lifecycle: WorkspaceRuntimeLifecycle
  let lifecycleReason: string

  if (record.routeAttachmentCount > 0) {
    lifecycle = "focused"
    lifecycleReason = "route-attached"
  } else if (
    signals.hasSyncActivity ||
    signals.hasConnectedCollab ||
    signals.hasRunningTerminals ||
    signals.hasRunningDevServer ||
    signals.hasNativePreview
  ) {
    lifecycle = "background-hot"
    lifecycleReason = signals.hasSyncActivity
      ? `sync-${signals.pendingSyncStatus ?? "active"}`
      : signals.hasConnectedCollab
        ? "collaboration-connected"
        : signals.hasRunningDevServer
          ? "dev-server-running"
          : signals.hasNativePreview
            ? "native-preview-running"
            : "terminals-retained"
  } else if (
    signals.hasVisibleBrowserSurface ||
    backgroundAge <= BACKGROUND_WARM_IDLE_MS ||
    record.config.collaborationEnabled
  ) {
    lifecycle = "background-warm"
    lifecycleReason = signals.hasVisibleBrowserSurface
      ? "browser-surface-retained"
      : backgroundAge <= BACKGROUND_WARM_IDLE_MS
        ? "recent-activity"
        : "collaboration-enabled"
  } else if (backgroundAge >= BACKGROUND_FROZEN_IDLE_MS) {
    lifecycle = "background-frozen"
    lifecycleReason = "idle-timeout"
  } else {
    lifecycle = "background-warm"
    lifecycleReason = "idle-cooldown"
  }

  return {
    lifecycle,
    signals: {
      ...signals,
      lifecycleReason,
    },
  }
}

function createRecord(runtimeId: string, config: WorkspaceRuntimeConfig): WorkspaceRuntimeRecord {
  const now = Date.now()
  const record: WorkspaceRuntimeRecord = {
    runtimeId,
    workspaceId: config.workspaceId,
    config,
    syncContext: null,
    yjsContext: EMPTY_YJS_PROJECT_CONTEXT_VALUE,
    routeAttachmentCount: 0,
    lifecycle: "background-warm",
    signals: {
      hasConnectedCollab: false,
      hasSyncActivity: false,
      hasRunningTerminals: false,
      hasRunningDevServer: false,
      hasVisibleBrowserSurface: false,
      hasNativePreview: false,
      pendingSyncStatus: null,
      lastActivityAt: now,
      lifecycleReason: "created",
    },
    sessionKey: null,
    sessionSnapshot: null,
    createdAt: now,
    lastAttachedAt: null,
    lastDetachedAt: null,
  }
  const nextState = resolveLifecycle(record, now)
  record.lifecycle = nextState.lifecycle
  record.signals = nextState.signals
  return record
}

function applyResolvedLifecycle(record: WorkspaceRuntimeRecord, now = Date.now()): WorkspaceRuntimeRecord {
  // Explicitly closed runtimes must stay closed until removed/recreated.
  if (record.lifecycle === "closed") {
    return record
  }
  const nextState = resolveLifecycle(record, now)
  return {
    ...record,
    lifecycle: nextState.lifecycle,
    signals: nextState.signals,
  }
}

export function resolveWorkspaceRuntimeId(input: {
  projectId: Id<"projects"> | null
  workspaceId: string | null
  laneId?: string | null
  workspaceRevision?: number
}): string | null {
  return buildWorkspaceIdentityKey(
    input.projectId ? String(input.projectId) : null,
    input.workspaceId,
    normalizeWorkspaceLaneId(input.laneId),
    input.workspaceRevision ?? 1,
  )
}

export const useWorkspaceRuntimeStore = create<WorkspaceRuntimeState>()((set, get) => ({
  runtimes: {},
  suppressedProjectIds: {},
  actions: {
    ensureRuntime: (config) => {
      const projectId = config.projectId ? String(config.projectId) : null
      if (projectId && get().suppressedProjectIds[projectId]) {
        return null
      }

      const runtimeId = resolveWorkspaceRuntimeId({
        projectId: config.projectId,
        workspaceId: config.workspaceId,
        laneId: config.laneId,
        workspaceRevision: config.workspaceRevision,
      })
      if (!runtimeId) {
        return null
      }

      set((state) => {
        const existing = state.runtimes[runtimeId] ?? null
        if (existing?.lifecycle === "closed") {
          // Do not revive an explicitly closed runtime via ensure.
          return state
        }
        const nextConfig: WorkspaceRuntimeConfig = {
          ...config,
          laneId: normalizeWorkspaceLaneId(config.laneId),
        }

        const nextRecord = existing
          ? applyResolvedLifecycle({
              ...existing,
              config: nextConfig,
            })
          : createRecord(runtimeId, nextConfig)

        return {
          runtimes: {
            ...state.runtimes,
            [runtimeId]: nextRecord,
          },
        }
      })

      return runtimeId
    },
    attachRuntime: (runtimeId) => {
      set((state) => {
        const record = state.runtimes[runtimeId]
        if (!record) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          routeAttachmentCount: record.routeAttachmentCount + 1,
          lastAttachedAt: Date.now(),
        })
        return {
          runtimes: {
            ...state.runtimes,
            [runtimeId]: nextRecord,
          },
        }
      })
    },
    detachRuntime: (runtimeId) => {
      set((state) => {
        const record = state.runtimes[runtimeId]
        if (!record) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          routeAttachmentCount: Math.max(0, record.routeAttachmentCount - 1),
          lastDetachedAt: Date.now(),
        })
        return {
          runtimes: {
            ...state.runtimes,
            [runtimeId]: nextRecord,
          },
        }
      })
    },
    publishSyncContext: (runtimeId, value) => {
      set((state) => {
        const record = state.runtimes[runtimeId]
        if (!record) return state
        if (record.syncContext === value) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          syncContext: value,
        })
        return {
          runtimes: {
            ...state.runtimes,
            [runtimeId]: nextRecord,
          },
        }
      })
    },
    publishYjsContext: (runtimeId, value) => {
      set((state) => {
        const record = state.runtimes[runtimeId]
        if (!record) return state
        if (record.yjsContext === value) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          yjsContext: value,
        })
        return {
          runtimes: {
            ...state.runtimes,
            [runtimeId]: nextRecord,
          },
        }
      })
    },
    clearPublishedContexts: (runtimeId) => {
      set((state) => {
        const record = state.runtimes[runtimeId]
        if (!record) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          syncContext: null,
          yjsContext: EMPTY_YJS_PROJECT_CONTEXT_VALUE,
        })
        return {
          runtimes: {
            ...state.runtimes,
            [runtimeId]: nextRecord,
          },
        }
      })
    },
    bindSessionSnapshot: (runtimeId, snapshot) => {
      set((state) => {
        const record = state.runtimes[runtimeId]
        if (!record) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          sessionKey: snapshot?.sessionKey?.trim() || null,
          sessionSnapshot: snapshot,
        })
        return {
          runtimes: {
            ...state.runtimes,
            [runtimeId]: nextRecord,
          },
        }
      })
    },
    refreshLifecycles: () => {
      set((state) => {
        let mutated = false
        const nextRuntimes: Record<string, WorkspaceRuntimeRecord> = {}

        for (const [runtimeId, record] of Object.entries(state.runtimes)) {
          if (record.lifecycle === "closed") {
            nextRuntimes[runtimeId] = record
            continue
          }

          const nextRecord = applyResolvedLifecycle(record)
          nextRuntimes[runtimeId] = nextRecord
          if (
            nextRecord.lifecycle !== record.lifecycle ||
            nextRecord.signals.lifecycleReason !== record.signals.lifecycleReason ||
            nextRecord.signals.lastActivityAt !== record.signals.lastActivityAt
          ) {
            mutated = true
          }
        }

        return mutated ? { runtimes: nextRuntimes } : state
      })
    },
    closeRuntime: (runtimeId) => {
      set((state) => {
        const record = state.runtimes[runtimeId]
        if (!record) return state
        return {
          runtimes: {
            ...state.runtimes,
            [runtimeId]: {
              ...record,
              lifecycle: "closed",
              routeAttachmentCount: 0,
              syncContext: null,
              yjsContext: EMPTY_YJS_PROJECT_CONTEXT_VALUE,
              sessionKey: null,
              sessionSnapshot: null,
              signals: {
                ...record.signals,
                hasConnectedCollab: false,
                hasSyncActivity: false,
                hasRunningTerminals: false,
                hasRunningDevServer: false,
                hasVisibleBrowserSurface: false,
                hasNativePreview: false,
                pendingSyncStatus: null,
                lifecycleReason: "closed-explicitly",
              },
            },
          },
        }
      })
    },
    suppressProject: (projectId) => {
      const normalizedProjectId = projectId.trim()
      if (!normalizedProjectId) return

      set((state) => {
        const nextRuntimes: Record<string, WorkspaceRuntimeRecord> = {}
        for (const [runtimeId, record] of Object.entries(state.runtimes)) {
          if (String(record.config.projectId ?? "") === normalizedProjectId) {
            continue
          }
          nextRuntimes[runtimeId] = record
        }
        return {
          suppressedProjectIds: {
            ...state.suppressedProjectIds,
            [normalizedProjectId]: true,
          },
          runtimes: nextRuntimes,
        }
      })
    },
  },
}))

export function getWorkspaceRuntimeRecord(
  runtimeId: string | null | undefined,
): WorkspaceRuntimeRecord | null {
  if (!runtimeId) {
    return null
  }

  return useWorkspaceRuntimeStore.getState().runtimes[runtimeId] ?? null
}

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
  localPath: string | null
  gitCwd: string | null
  lastSyncAt: number | null
  collaborationEnabled: boolean
  activeBranch: string | null
  sharedBranch: string | null
  documentScopeId: string | null
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
  actions: {
    ensureRuntime: (config: Omit<WorkspaceRuntimeConfig, "workspaceId">) => string | null
    attachRuntime: (workspaceId: string) => void
    detachRuntime: (workspaceId: string) => void
    publishSyncContext: (workspaceId: string, value: ProjectSyncContextValue | null) => void
    publishYjsContext: (workspaceId: string, value: YjsProjectContextValue) => void
    clearPublishedContexts: (workspaceId: string) => void
    bindSessionSnapshot: (workspaceId: string, snapshot: WorkbenchSessionSnapshot | null) => void
    refreshLifecycles: () => void
    closeRuntime: (workspaceId: string) => void
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
  const lastActivityAt = Math.max(
    record.lastAttachedAt ?? 0,
    record.lastDetachedAt ?? 0,
    record.sessionSnapshot?.lastFocusedAt ?? 0,
    record.sessionSnapshot?.lastBackgroundedAt ?? 0,
    record.syncContext?.lastSyncAt ?? 0,
    record.config.lastSyncAt ?? 0,
    hasSyncActivity ? now : 0,
    hasConnectedCollab ? now : 0,
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

function createRecord(config: WorkspaceRuntimeConfig): WorkspaceRuntimeRecord {
  const now = Date.now()
  const record: WorkspaceRuntimeRecord = {
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
  const nextState = resolveLifecycle(record, now)
  return {
    ...record,
    lifecycle: nextState.lifecycle,
    signals: nextState.signals,
  }
}

export function resolveWorkspaceRuntimeId(input: {
  projectId: Id<"projects"> | null
  laneId?: string | null
  localPath?: string | null
}): string | null {
  return buildWorkspaceIdentityKey(
    input.projectId ? String(input.projectId) : null,
    normalizeWorkspaceLaneId(input.laneId),
    input.localPath,
  )
}

export const useWorkspaceRuntimeStore = create<WorkspaceRuntimeState>()((set) => ({
  runtimes: {},
  actions: {
    ensureRuntime: (config) => {
      const workspaceId = resolveWorkspaceRuntimeId({
        projectId: config.projectId,
        laneId: config.laneId,
        localPath: config.localPath,
      })
      if (!workspaceId) {
        return null
      }

      set((state) => {
        const existing = state.runtimes[workspaceId] ?? null
        const nextConfig: WorkspaceRuntimeConfig = {
          ...config,
          workspaceId,
          laneId: normalizeWorkspaceLaneId(config.laneId),
        }

        const nextRecord = existing
          ? applyResolvedLifecycle({
              ...existing,
              config: nextConfig,
            })
          : createRecord(nextConfig)

        return {
          runtimes: {
            ...state.runtimes,
            [workspaceId]: nextRecord,
          },
        }
      })

      return workspaceId
    },
    attachRuntime: (workspaceId) => {
      set((state) => {
        const record = state.runtimes[workspaceId]
        if (!record) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          routeAttachmentCount: record.routeAttachmentCount + 1,
          lastAttachedAt: Date.now(),
        })
        return {
          runtimes: {
            ...state.runtimes,
            [workspaceId]: nextRecord,
          },
        }
      })
    },
    detachRuntime: (workspaceId) => {
      set((state) => {
        const record = state.runtimes[workspaceId]
        if (!record) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          routeAttachmentCount: Math.max(0, record.routeAttachmentCount - 1),
          lastDetachedAt: Date.now(),
        })
        return {
          runtimes: {
            ...state.runtimes,
            [workspaceId]: nextRecord,
          },
        }
      })
    },
    publishSyncContext: (workspaceId, value) => {
      set((state) => {
        const record = state.runtimes[workspaceId]
        if (!record) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          syncContext: value,
        })
        return {
          runtimes: {
            ...state.runtimes,
            [workspaceId]: nextRecord,
          },
        }
      })
    },
    publishYjsContext: (workspaceId, value) => {
      set((state) => {
        const record = state.runtimes[workspaceId]
        if (!record) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          yjsContext: value,
        })
        return {
          runtimes: {
            ...state.runtimes,
            [workspaceId]: nextRecord,
          },
        }
      })
    },
    clearPublishedContexts: (workspaceId) => {
      set((state) => {
        const record = state.runtimes[workspaceId]
        if (!record) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          syncContext: null,
          yjsContext: EMPTY_YJS_PROJECT_CONTEXT_VALUE,
        })
        return {
          runtimes: {
            ...state.runtimes,
            [workspaceId]: nextRecord,
          },
        }
      })
    },
    bindSessionSnapshot: (workspaceId, snapshot) => {
      set((state) => {
        const record = state.runtimes[workspaceId]
        if (!record) return state
        const nextRecord = applyResolvedLifecycle({
          ...record,
          sessionKey: snapshot?.sessionKey?.trim() || null,
          sessionSnapshot: snapshot,
        })
        return {
          runtimes: {
            ...state.runtimes,
            [workspaceId]: nextRecord,
          },
        }
      })
    },
    refreshLifecycles: () => {
      set((state) => {
        let mutated = false
        const nextRuntimes: Record<string, WorkspaceRuntimeRecord> = {}

        for (const [workspaceId, record] of Object.entries(state.runtimes)) {
          if (record.lifecycle === "closed") {
            nextRuntimes[workspaceId] = record
            continue
          }

          const nextRecord = applyResolvedLifecycle(record)
          nextRuntimes[workspaceId] = nextRecord
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
    closeRuntime: (workspaceId) => {
      set((state) => {
        const record = state.runtimes[workspaceId]
        if (!record) return state
        return {
          runtimes: {
            ...state.runtimes,
            [workspaceId]: {
              ...record,
              lifecycle: "closed",
              signals: {
                ...record.signals,
                lifecycleReason: "closed-explicitly",
              },
            },
          },
        }
      })
    },
  },
}))

export function getWorkspaceRuntimeRecord(
  workspaceId: string | null | undefined,
): WorkspaceRuntimeRecord | null {
  if (!workspaceId) {
    return null
  }

  return useWorkspaceRuntimeStore.getState().runtimes[workspaceId] ?? null
}

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  RadonLogEvent,
  RadonRuntimeEvent,
  RadonToolDescriptor,
} from '@shared/electronApiTypes'

const MAX_RUNTIME_EVENTS = 100
const MAX_RUNTIME_LOGS = 200

export interface ProjectRuntimeNavigationEntry {
  id: string
  displayName?: string
  canGoBack?: boolean
}

export interface ProjectRuntimeStateSnapshot {
  appReady: boolean
  lastRuntimeEventAt: number | null
  runtimeEvents: Array<RadonRuntimeEvent & { receivedAt: number }>
  logEvents: RadonLogEvent[]
  runtimePlugins: string[]
  toolsBySession: Record<string, RadonToolDescriptor[]>
  navigationHistory: ProjectRuntimeNavigationEntry[]
  navigationRouteList: unknown[]
  lastInspectResult: unknown | null
}

interface ProjectRuntimeStoreState {
  projects: Record<string, ProjectRuntimeStateSnapshot>
  recordRuntimeEvent: (projectPath: string, event: RadonRuntimeEvent) => void
  recordLogEvent: (projectPath: string, event: RadonLogEvent) => void
  setTools: (projectPath: string, sessionId: string, tools: RadonToolDescriptor[]) => void
  resetProject: (projectPath: string) => void
}

function createEmptySnapshot(): ProjectRuntimeStateSnapshot {
  return {
    appReady: false,
    lastRuntimeEventAt: null,
    runtimeEvents: [],
    logEvents: [],
    runtimePlugins: [],
    toolsBySession: {},
    navigationHistory: [],
    navigationRouteList: [],
    lastInspectResult: null,
  }
}

// Zustand uses useSyncExternalStore under the hood, so empty snapshots must keep
// a stable reference or React will detect a changing snapshot and rerender forever.
const EMPTY_RUNTIME_SNAPSHOT: ProjectRuntimeStateSnapshot = createEmptySnapshot()

function ensureProjectSnapshot(
  projects: Record<string, ProjectRuntimeStateSnapshot>,
  projectPath: string,
): ProjectRuntimeStateSnapshot {
  if (!projects[projectPath]) {
    projects[projectPath] = createEmptySnapshot()
  }
  return projects[projectPath]
}

export const useProjectRuntimeStore = create<ProjectRuntimeStoreState>()(
  immer((set) => ({
    projects: {},

    recordRuntimeEvent: (projectPath, event) => set((state) => {
      const snapshot = ensureProjectSnapshot(state.projects, projectPath)
      const receivedAt = Date.now()

      snapshot.lastRuntimeEventAt = receivedAt
      snapshot.runtimeEvents.unshift({
        ...event,
        receivedAt,
      })
      if (snapshot.runtimeEvents.length > MAX_RUNTIME_EVENTS) {
        snapshot.runtimeEvents = snapshot.runtimeEvents.slice(0, MAX_RUNTIME_EVENTS)
      }

      switch (event.type) {
        case 'appReady':
          snapshot.appReady = true
          break
        case 'fastRefreshStarted':
        case 'runtimeDisconnected':
          snapshot.appReady = false
          break
        case 'navigationChanged': {
          const payload = event.payload as { id?: unknown; displayName?: unknown; canGoBack?: unknown } | undefined
          if (typeof payload?.id === 'string') {
            snapshot.navigationHistory = [
              {
                id: payload.id,
                displayName: typeof payload.displayName === 'string' ? payload.displayName : undefined,
                canGoBack: typeof payload.canGoBack === 'boolean' ? payload.canGoBack : undefined,
              },
              ...snapshot.navigationHistory.filter((entry) => entry.id !== payload.id),
            ].slice(0, 50)
          }
          break
        }
        case 'navigationRouteListUpdated':
          snapshot.navigationRouteList = Array.isArray(event.payload) ? event.payload : []
          break
        case 'inspectData':
          snapshot.lastInspectResult = event.payload ?? null
          break
        case 'devtoolPluginsChanged': {
          const payload = event.payload as { plugins?: unknown } | undefined
          snapshot.runtimePlugins = Array.isArray(payload?.plugins)
            ? payload.plugins.filter((plugin): plugin is string => typeof plugin === 'string')
            : []
          break
        }
        default:
          break
      }
    }),

    recordLogEvent: (projectPath, event) => set((state) => {
      const snapshot = ensureProjectSnapshot(state.projects, projectPath)
      snapshot.logEvents.unshift(event)
      if (snapshot.logEvents.length > MAX_RUNTIME_LOGS) {
        snapshot.logEvents = snapshot.logEvents.slice(0, MAX_RUNTIME_LOGS)
      }
    }),

    setTools: (projectPath, sessionId, tools) => set((state) => {
      const snapshot = ensureProjectSnapshot(state.projects, projectPath)
      snapshot.toolsBySession[sessionId] = tools
    }),

    resetProject: (projectPath) => set((state) => {
      delete state.projects[projectPath]
    }),
  })),
)

export function selectProjectRuntimeState(
  projectPath: string | null | undefined,
): (state: ProjectRuntimeStoreState) => ProjectRuntimeStateSnapshot {
  return (state) => {
    if (!projectPath) {
      return EMPTY_RUNTIME_SNAPSHOT
    }
    return state.projects[projectPath] ?? EMPTY_RUNTIME_SNAPSHOT
  }
}

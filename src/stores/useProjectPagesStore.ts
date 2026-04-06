// @ts-nocheck
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { PreviewFailureReason } from '@shared/electronApiTypes'

// Console panel height constraints
const MIN_PANEL_HEIGHT = 100
const MAX_PANEL_HEIGHT = 500
const DEFAULT_PANEL_HEIGHT = 180

export interface PageRoute {
    name: string
    path: string
    file: string // Absolute path to file
    type: 'static' | 'dynamic'
    status: 'active' | 'error' | 'drained'
    description?: string // AI-generated description
}

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error' | 'unhealthy'
export type ServerLifecycleState = 'idle' | 'starting' | 'ready' | 'unhealthy' | 'stopped' | 'error'

export interface ServerLifecycle {
    runId: string | null
    state: ServerLifecycleState
    command: string | null
    devtoolsPort: number | null
    startedAt: number | null
    readyAt: number | null
    lastOutputAt: number | null
    stoppedAt: number | null
    unhealthyReason: string | null
    watchFolders: string[] | null
    expoEnvPreludeLineCount: number | null
}

export interface PreviewReadiness {
    runId: string | null
    reachable: boolean
    bridgeReady: boolean
    embedded: boolean
    lastCheckedAt: number | null
    lastFailureReason: PreviewFailureReason | null
    lastFailureMessage: string | null
}

export interface PreviewTimelineEvent {
    id: string
    at: number
    runId: string | null
    category: 'dev-server' | 'preview'
    type:
        | 'start_requested'
        | 'start_succeeded'
        | 'start_failed'
        | 'output'
        | 'ready_detected'
        | 'probe_succeeded'
        | 'probe_failed'
        | 'iframe_loaded'
        | 'bridge_inject_succeeded'
        | 'bridge_inject_failed'
        | 'bridge_ready'
        | 'bridge_timeout'
        | 'fallback_mode'
        | 'iframe_error'
        | 'stopped'
        | 'exited'
    message: string
    details?: Record<string, unknown>
}

const MAX_PREVIEW_TIMELINE_EVENTS = 120

const DEFAULT_SERVER_LIFECYCLE: ServerLifecycle = {
    runId: null,
    state: 'idle',
    command: null,
    devtoolsPort: null,
    startedAt: null,
    readyAt: null,
    lastOutputAt: null,
    stoppedAt: null,
    unhealthyReason: null,
    watchFolders: null,
    expoEnvPreludeLineCount: null,
}

const DEFAULT_PREVIEW_READINESS: PreviewReadiness = {
    runId: null,
    reachable: false,
    bridgeReady: false,
    embedded: false,
    lastCheckedAt: null,
    lastFailureReason: null,
    lastFailureMessage: null,
}

interface ProjectPagesState {
    routes: PageRoute[]
    serverStatus: ServerStatus
    serverPort: number | null
    serverPid: number | null
    serverLifecycle: ServerLifecycle
    previewReadiness: PreviewReadiness
    previewTimeline: PreviewTimelineEvent[]
    consolePanelHeight: number
    serverOutput: string[]
    latestDomSnapshot: string | null
    actions: {
        setRoutes: (routes: PageRoute[]) => void
        setServerStatus: (status: ServerStatus) => void
        setServerPort: (port: number | null) => void
        setServerPid: (pid: number | null) => void
        setLatestDomSnapshot: (snapshot: string | null) => void
        beginServerRun: (runId: string, command?: string | null) => void
        setServerLifecycle: (next: Partial<ServerLifecycle>) => void
        setPreviewReadiness: (next: Partial<PreviewReadiness>) => void
        resetPreviewReadiness: () => void
        addPreviewTimelineEvent: (event: Omit<PreviewTimelineEvent, 'id' | 'at'> & { at?: number }) => void
        clearPreviewTimeline: () => void
        setConsolePanelHeight: (height: number) => void
        resetConsolePanelHeight: () => void
        addServerOutput: (line: string) => void
        clearServerOutput: () => void
    }
}

export const useProjectPagesStore = create<ProjectPagesState>()(
    persist(
        (set) => ({
            routes: [],
            serverStatus: 'stopped',
            serverPort: null,
            serverPid: null,
            serverLifecycle: DEFAULT_SERVER_LIFECYCLE,
            previewReadiness: DEFAULT_PREVIEW_READINESS,
            previewTimeline: [],
            consolePanelHeight: DEFAULT_PANEL_HEIGHT,
            serverOutput: [],
            latestDomSnapshot: null,
            actions: {
                setRoutes: (routes) => set({ routes }),
                setServerStatus: (status) => set({ serverStatus: status }),
                setServerPort: (port) => set({ serverPort: port }),
                setServerPid: (pid) => set({ serverPid: pid }),
                setLatestDomSnapshot: (snapshot) => set({ latestDomSnapshot: snapshot }),
                beginServerRun: (runId, command = null) => set((state) => ({
                    serverLifecycle: {
                        ...state.serverLifecycle,
                        runId,
                        state: 'starting',
                        command,
                        devtoolsPort: null,
                        startedAt: Date.now(),
                        readyAt: null,
                        lastOutputAt: null,
                        stoppedAt: null,
                        unhealthyReason: null,
                        watchFolders: null,
                        expoEnvPreludeLineCount: null,
                    },
                    previewReadiness: {
                        ...DEFAULT_PREVIEW_READINESS,
                        runId,
                    },
                })),
                setServerLifecycle: (next) => set((state) => ({
                    serverLifecycle: {
                        ...state.serverLifecycle,
                        ...next,
                    },
                })),
                setPreviewReadiness: (next) => set((state) => ({
                    previewReadiness: {
                        ...state.previewReadiness,
                        ...next,
                    },
                })),
                resetPreviewReadiness: () => set((state) => ({
                    previewReadiness: {
                        ...DEFAULT_PREVIEW_READINESS,
                        runId: state.serverLifecycle.runId,
                    },
                })),
                addPreviewTimelineEvent: (event) => set((state) => {
                    const nextEvent: PreviewTimelineEvent = {
                        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        at: event.at ?? Date.now(),
                        ...event,
                    }
                    const merged = [...state.previewTimeline, nextEvent]
                    const trimmed = merged.length > MAX_PREVIEW_TIMELINE_EVENTS
                        ? merged.slice(merged.length - MAX_PREVIEW_TIMELINE_EVENTS)
                        : merged
                    return { previewTimeline: trimmed }
                }),
                clearPreviewTimeline: () => set({ previewTimeline: [] }),
                setConsolePanelHeight: (height) => set({
                    consolePanelHeight: Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, height))
                }),
                resetConsolePanelHeight: () => set({ consolePanelHeight: DEFAULT_PANEL_HEIGHT }),
                addServerOutput: (line) => set((state) => ({
                    serverOutput: [...state.serverOutput, line].slice(-1000) // Keep last 1000 lines
                })),
                clearServerOutput: () => set({ serverOutput: [] }),
            }
        }),
        {
            name: 'project-pages-store',
            storage: createJSONStorage(() => localStorage),
            // Only persist the console panel height
            partialize: (state) => ({ consolePanelHeight: state.consolePanelHeight }),
        }
    )
)

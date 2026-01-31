import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

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

interface ProjectPagesState {
    routes: PageRoute[]
    serverStatus: 'stopped' | 'starting' | 'running' | 'error'
    serverPort: number | null
    serverPid: number | null
    consolePanelHeight: number
    serverOutput: string[]
    /** When on the page view, whether the left Pages list panel is open. Default false so it stays closed. */
    pagesListOpen: boolean

    actions: {
        setRoutes: (routes: PageRoute[]) => void
        setServerStatus: (status: 'stopped' | 'starting' | 'running' | 'error') => void
        setServerPort: (port: number | null) => void
        setServerPid: (pid: number | null) => void
        setConsolePanelHeight: (height: number) => void
        resetConsolePanelHeight: () => void
        addServerOutput: (line: string) => void
        clearServerOutput: () => void
        setPagesListOpen: (open: boolean) => void
        togglePagesListOpen: () => void
    }
}

export const useProjectPagesStore = create<ProjectPagesState>()(
    persist(
        (set) => ({
            routes: [],
            serverStatus: 'stopped',
            serverPort: null,
            serverPid: null,
            consolePanelHeight: DEFAULT_PANEL_HEIGHT,
            serverOutput: [],
            pagesListOpen: false,

            actions: {
                setRoutes: (routes) => set({ routes }),
                setServerStatus: (status) => set({ serverStatus: status }),
                setServerPort: (port) => set({ serverPort: port }),
                setServerPid: (pid) => set({ serverPid: pid }),
                setConsolePanelHeight: (height) => set({
                    consolePanelHeight: Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, height))
                }),
                resetConsolePanelHeight: () => set({ consolePanelHeight: DEFAULT_PANEL_HEIGHT }),
                addServerOutput: (line) => set((state) => ({
                    serverOutput: [...state.serverOutput, line].slice(-1000) // Keep last 1000 lines
                })),
                clearServerOutput: () => set({ serverOutput: [] }),
                setPagesListOpen: (open) => set({ pagesListOpen: open }),
                togglePagesListOpen: () => set((s) => ({ pagesListOpen: !s.pagesListOpen })),
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

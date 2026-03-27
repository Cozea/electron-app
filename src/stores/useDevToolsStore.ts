// @ts-nocheck
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type ErrorSeverity = 'error' | 'warning' | 'info'
export type ErrorSource = 'console' | 'build' | 'runtime' | 'network'

export interface PreviewError {
  id: string
  message: string
  stack?: string
  severity: ErrorSeverity
  source: ErrorSource
  timestamp: Date
  file?: string
  line?: number
  column?: number
  url?: string
  dismissed: boolean
}

export interface SelectedElement {
  tagName: string
  className: string
  id?: string
  selector: string
  boundingRect: { x: number; y: number; width: number; height: number }
  computedStyles?: Record<string, string>
  htmlSnippet: string
}

interface DevToolsState {
  // Console errors from preview
  errors: PreviewError[]
  unreadErrorCount: number

  // Element selection mode
  isElementSelectMode: boolean
  selectedElement: SelectedElement | null

  // Bridge detection
  isBridgeDetected: boolean

  // Actions
  addError: (error: Omit<PreviewError, 'id' | 'timestamp' | 'dismissed'>) => void
  dismissError: (id: string) => void
  clearErrors: () => void
  markErrorsRead: () => void

  setElementSelectMode: (enabled: boolean) => void
  setSelectedElement: (element: SelectedElement | null) => void
  clearSelectedElement: () => void

  setBridgeDetected: (detected: boolean) => void
}

export const useDevToolsStore = create<DevToolsState>()(
  immer((set) => ({
    errors: [],
    unreadErrorCount: 0,
    isElementSelectMode: false,
    selectedElement: null,
    isBridgeDetected: false,

    addError: (error) => set((state) => {
      // Deduplicate: don't add if same message exists in last 5 errors
      const isDuplicate = state.errors.slice(0, 5).some(
        e => e.message === error.message && e.source === error.source
      )
      if (isDuplicate) return

      state.errors.unshift({
        ...error,
        id: crypto.randomUUID(),
        timestamp: new Date(),
        dismissed: false,
      })
      state.unreadErrorCount++
      // Keep last 100 errors
      if (state.errors.length > 100) {
        state.errors = state.errors.slice(0, 100)
      }
    }),

    dismissError: (id) => set((state) => {
      const error = state.errors.find(e => e.id === id)
      if (error && !error.dismissed) {
        error.dismissed = true
        if (state.unreadErrorCount > 0) state.unreadErrorCount--
      }
    }),

    clearErrors: () => set((state) => {
      state.errors = []
      state.unreadErrorCount = 0
    }),

    markErrorsRead: () => set((state) => {
      state.unreadErrorCount = 0
    }),

    setElementSelectMode: (enabled) => set((state) => {
      state.isElementSelectMode = enabled
      if (!enabled) {
        state.selectedElement = null
      }
    }),

    setSelectedElement: (element) => set((state) => {
      state.selectedElement = element
      state.isElementSelectMode = false
    }),

    clearSelectedElement: () => set((state) => {
      state.selectedElement = null
    }),

    setBridgeDetected: (detected) => set((state) => {
      state.isBridgeDetected = detected
    }),
  }))
)

// @ts-nocheck
import { create } from 'zustand'

export const PREVIEW_SCREENSHOT_REQUEST_EVENT = 'cozea:preview-screenshot-request'

/**
 * Current page context - tracks which page the user is viewing in the preview
 * This context is injected into AI requests invisibly (not shown in input)
 */
export interface PageContext {
  /** Route path, e.g., "/dashboard" */
  route: string
  /** Source file path, e.g., "src/app/dashboard/page.tsx" */
  filePath: string
  /** Component/page name, e.g., "Dashboard" */
  componentName: string
  /** Dev server port if running */
  serverPort?: number
  /** Timestamp of last context update */
  lastUpdated: number
}

/**
 * Context captured from the preview inspector (e.g. right-click on an element)
 * Injected into AI requests invisibly to help target the right code.
 */
export interface InspectedElementContext {
  selector: string
  tagName: string
  className?: string
  id?: string
  textContent?: string
  htmlSnippet?: string
  reactComponentStack?: string[]
  reactSource?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null
  capturedAt: number
}

export interface PreviewScreenshotControl {
  visible: boolean
  enabled: boolean
  capturing: boolean
}

interface PageContextState {
  /** Current page context, null if not viewing a page */
  currentPage: PageContext | null
  /** Last inspected element context, null if none */
  inspectedElement: InspectedElementContext | null
  /** Preview screenshot availability for chat attachment actions */
  previewScreenshot: PreviewScreenshotControl

  /** Set the current page context */
  setCurrentPage: (page: PageContext | null) => void
  /** Set the inspected element context */
  setInspectedElement: (inspected: InspectedElementContext | null) => void
  /** Set preview screenshot availability */
  setPreviewScreenshot: (previewScreenshot: PreviewScreenshotControl) => void

  /** Clear the current page context */
  clear: () => void
}

export const usePageContextStore = create<PageContextState>()((set) => ({
  currentPage: null,
  inspectedElement: null,
  previewScreenshot: {
    visible: false,
    enabled: false,
    capturing: false,
  },

  setCurrentPage: (page) => set((state) => {
    const prev = state.currentPage
    const pageChanged = !!prev && !!page && (prev.route !== page.route || prev.filePath !== page.filePath)
    return {
      currentPage: page,
      inspectedElement: pageChanged || page === null ? null : state.inspectedElement,
    }
  }),

  setInspectedElement: (inspected) => set({ inspectedElement: inspected }),

  setPreviewScreenshot: (previewScreenshot) => set({ previewScreenshot }),

  clear: () => set({
    currentPage: null,
    inspectedElement: null,
    previewScreenshot: {
      visible: false,
      enabled: false,
      capturing: false,
    },
  }),
}))

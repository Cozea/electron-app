import type { PreviewViewportSetting } from "@cozea/contracts/t3/preview"
import { create } from "zustand"

interface BrowserViewportStoreState {
  readonly byTabId: Record<string, PreviewViewportSetting>
  readonly set: (tabId: string, viewport: PreviewViewportSetting) => void
  readonly remove: (tabId: string) => void
}

export const useBrowserViewportStore = create<BrowserViewportStoreState>()((set) => ({
  byTabId: {},
  set: (tabId, viewport) => set((state) => ({ byTabId: { ...state.byTabId, [tabId]: viewport } })),
  remove: (tabId) =>
    set((state) => {
      if (!(tabId in state.byTabId)) return state
      const byTabId = { ...state.byTabId }
      delete byTabId[tabId]
      return { byTabId }
    }),
}))

export function readBrowserViewport(tabId: string): PreviewViewportSetting {
  return useBrowserViewportStore.getState().byTabId[tabId] ?? { _tag: "fill" }
}

export function commitBrowserViewport(
  tabId: string,
  viewport: PreviewViewportSetting,
): Promise<void> {
  useBrowserViewportStore.getState().set(tabId, viewport)
  return Promise.resolve()
}

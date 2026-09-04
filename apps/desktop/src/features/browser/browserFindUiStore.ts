import { create } from "zustand";

interface BrowserFindUiStore {
  readonly visibleByTabId: Record<string, boolean>;
  readonly setVisible: (runtimeTabId: string, visible: boolean) => void;
  readonly toggle: (runtimeTabId: string) => void;
}

export const useBrowserFindUiStore = create<BrowserFindUiStore>()((set) => ({
  visibleByTabId: {},
  setVisible: (runtimeTabId, visible) =>
    set((state) => ({
      visibleByTabId: { ...state.visibleByTabId, [runtimeTabId]: visible },
    })),
  toggle: (runtimeTabId) =>
    set((state) => ({
      visibleByTabId: {
        ...state.visibleByTabId,
        [runtimeTabId]: !state.visibleByTabId[runtimeTabId],
      },
    })),
}));

import type { CozeaBrowserSurfaceState } from "@shared/browserSurfaceTypes";
import { create } from "zustand";

interface BrowserSurfaceStateStore {
  readonly byTabId: Record<string, CozeaBrowserSurfaceState>;
  readonly apply: (runtimeTabId: string, state: CozeaBrowserSurfaceState) => void;
  readonly remove: (runtimeTabId: string) => void;
}

export const useBrowserSurfaceStateStore = create<BrowserSurfaceStateStore>()((set) => ({
  byTabId: {},
  apply: (runtimeTabId, next) =>
    set((current) => ({
      byTabId: { ...current.byTabId, [runtimeTabId]: next },
    })),
  remove: (runtimeTabId) =>
    set((current) => {
      if (!(runtimeTabId in current.byTabId)) return current;
      const { [runtimeTabId]: _removed, ...byTabId } = current.byTabId;
      return { byTabId };
    }),
}));

import { create } from "zustand";

/**
 * Which native browser surface holds keyboard focus, as reported by main.
 *
 * A click into a main-owned page moves focus inside Chromium without any DOM
 * event reaching the renderer, so this is the workbench's only way to know
 * that a browser is focused.
 */
interface BrowserSurfaceFocusStore {
  readonly focusedRuntimeTabId: string | null;
  readonly apply: (runtimeTabId: string, focused: boolean) => void;
}

export const useBrowserSurfaceFocusStore = create<BrowserSurfaceFocusStore>()((set) => ({
  focusedRuntimeTabId: null,
  apply: (runtimeTabId, focused) =>
    set((current) => {
      if (focused) {
        return current.focusedRuntimeTabId === runtimeTabId
          ? current
          : { focusedRuntimeTabId: runtimeTabId };
      }
      // Chromium does not promise blur-before-focus when focus moves between
      // two surfaces, so a late blur from the old one must not clear the new.
      return current.focusedRuntimeTabId === runtimeTabId ? { focusedRuntimeTabId: null } : current;
    }),
}));

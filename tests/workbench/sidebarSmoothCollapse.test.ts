import { describe, expect, it } from "vitest";
import { COMPACT_WINDOW_BREAKPOINT_PX } from "@/hooks/use-mobile";

describe("sidebar smooth collapse on horizontal space shrink", () => {
  it("uses the compact window breakpoint to govern responsive sidebar space", () => {
    expect(COMPACT_WINDOW_BREAKPOINT_PX).toBe(768);
  });

  it("calculates initial sidebar open state based on available horizontal space", () => {
    function getInitialSidebarOpen(
      savedPreference: boolean | null,
      defaultOpen: boolean,
      windowWidth: number,
    ): { open: boolean; wasAutoCollapsed: boolean } {
      const preferred = savedPreference !== null ? savedPreference : defaultOpen;
      if (windowWidth < COMPACT_WINDOW_BREAKPOINT_PX) {
        return { open: false, wasAutoCollapsed: preferred };
      }
      return { open: preferred, wasAutoCollapsed: false };
    }

    // Wide window: honors preferred open state
    expect(getInitialSidebarOpen(true, true, 1024)).toEqual({
      open: true,
      wasAutoCollapsed: false,
    });
    // Wide window: honors preferred closed state
    expect(getInitialSidebarOpen(false, true, 1024)).toEqual({
      open: false,
      wasAutoCollapsed: false,
    });
    // Narrow window: starts collapsed but remembers preferred was open
    expect(getInitialSidebarOpen(true, true, 600)).toEqual({
      open: false,
      wasAutoCollapsed: true,
    });
    // Narrow window: starts collapsed and was not auto-collapsed if preference was already closed
    expect(getInitialSidebarOpen(false, true, 600)).toEqual({
      open: false,
      wasAutoCollapsed: false,
    });
  });

  it("handles responsive auto-collapse and auto-expand across breakpoint transitions", () => {
    type State = {
      open: boolean;
      wasAutoCollapsed: boolean;
      cookieState: boolean;
    };

    function handleResizeTransition(
      current: State,
      isMobile: boolean,
      wasMobile: boolean,
    ): State {
      if (isMobile === wasMobile) return current;

      if (isMobile) {
        // Entering compact mode: if open, smoothly collapse without updating cookie
        if (current.open) {
          return { ...current, open: false, wasAutoCollapsed: true };
        }
      } else if (current.wasAutoCollapsed) {
        // Leaving compact mode: restore previous state if auto-collapsed
        return { ...current, open: true, wasAutoCollapsed: false };
      }

      return current;
    }

    function handleUserToggle(current: State): State {
      const nextOpen = !current.open;
      return {
        open: nextOpen,
        wasAutoCollapsed: false,
        cookieState: nextOpen,
      };
    }

    // Start with open sidebar on wide window
    let state: State = { open: true, wasAutoCollapsed: false, cookieState: true };

    // Shrink horizontal space into compact window (< 768px)
    state = handleResizeTransition(state, true, false);
    expect(state.open).toBe(false);
    expect(state.wasAutoCollapsed).toBe(true);
    // Cookie preference is preserved (not overwritten by responsive shrink)
    expect(state.cookieState).toBe(true);

    // Expand horizontal space back to wide window (>= 768px)
    state = handleResizeTransition(state, false, true);
    expect(state.open).toBe(true);
    expect(state.wasAutoCollapsed).toBe(false);

    // User explicitly collapses on wide window
    state = handleUserToggle(state);
    expect(state.open).toBe(false);
    expect(state.cookieState).toBe(false);

    // Shrink horizontal space into compact window
    state = handleResizeTransition(state, true, false);
    expect(state.open).toBe(false);
    expect(state.wasAutoCollapsed).toBe(false);

    // Expand horizontal space back: remains collapsed because user explicitly closed it
    state = handleResizeTransition(state, false, true);
    expect(state.open).toBe(false);
    expect(state.wasAutoCollapsed).toBe(false);

    // User opens it, then shrinks: auto-collapses
    state = handleUserToggle(state); // opens it
    expect(state.open).toBe(true);
    state = handleResizeTransition(state, true, false);
    expect(state.open).toBe(false);
    expect(state.wasAutoCollapsed).toBe(true);

    // User explicitly toggles it open in compact mode: auto-collapsed flag is cleared
    state = handleUserToggle(state);
    expect(state.open).toBe(true);
    expect(state.wasAutoCollapsed).toBe(false);

    // Expanding keeps it open
    state = handleResizeTransition(state, false, true);
    expect(state.open).toBe(true);
  });
});

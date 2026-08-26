import { create } from "zustand"

/**
 * Keep-alive registry for terminal views.
 *
 * An xterm instance (font atlas, scrollback, IPC output subscription) is
 * expensive to rebuild — re-creating it on every project switch cost ~170ms
 * of main-thread time per terminal tile. Instead, TerminalViewHost renders
 * one long-lived TerminalInstance per terminal into a stable detached <div>
 * (the "mount"), and tiles adopt that mount by reparenting it into their own
 * DOM. React never unmounts the instance; reparenting a canvas within the
 * same document preserves its contexts.
 *
 * Tiles call attachTerminalView/detachTerminalView; the host renders portals
 * for every registered view and parks detached mounts in a hidden container.
 */

export interface TerminalViewDescriptor {
  terminalId: string
  workspaceId: string | null
  /** GPU renderer + autofocus follow attachment. */
  attached: boolean
  focused: boolean
}

interface TerminalViewKeepAliveState {
  views: Record<string, TerminalViewDescriptor>
  attach: (input: {
    terminalId: string
    workspaceId: string | null
    focused: boolean
  }) => void
  detach: (terminalId: string) => void
  setFocused: (terminalId: string, focused: boolean) => void
  evict: (terminalId: string) => void
}

// Detached views we keep warm. Beyond this, oldest-detached are evicted
// (their xterm disposes; next visit rebuilds like before the keep-alive).
const MAX_DETACHED_VIEWS = 8

const mounts = new Map<string, HTMLDivElement>()
const detachedAt = new Map<string, number>()

export function getTerminalViewMount(terminalId: string): HTMLDivElement {
  let mount = mounts.get(terminalId)
  if (!mount) {
    mount = document.createElement("div")
    mount.className = "h-full min-h-0 terminal-keepalive-mount"
    mounts.set(terminalId, mount)
  }
  return mount
}

export function releaseTerminalViewMount(terminalId: string): void {
  const mount = mounts.get(terminalId)
  mount?.remove()
  mounts.delete(terminalId)
  detachedAt.delete(terminalId)
}

export const useTerminalViewKeepAlive = create<TerminalViewKeepAliveState>((set) => ({
  views: {},
  attach: ({ terminalId, workspaceId, focused }) =>
    set((state) => {
      detachedAt.delete(terminalId)
      const current = state.views[terminalId]
      if (
        current &&
        current.attached &&
        current.workspaceId === workspaceId &&
        current.focused === focused
      ) {
        return state
      }
      return {
        views: {
          ...state.views,
          [terminalId]: { terminalId, workspaceId, attached: true, focused },
        },
      }
    }),
  detach: (terminalId) =>
    set((state) => {
      const current = state.views[terminalId]
      if (!current) return state
      detachedAt.set(terminalId, Date.now())

      const views: Record<string, TerminalViewDescriptor> = {
        ...state.views,
        [terminalId]: { ...current, attached: false, focused: false },
      }

      // LRU-evict surplus detached views so GPU/CPU stays bounded.
      const detached = Object.values(views).filter((view) => !view.attached)
      if (detached.length > MAX_DETACHED_VIEWS) {
        detached
          .sort((a, b) => (detachedAt.get(a.terminalId) ?? 0) - (detachedAt.get(b.terminalId) ?? 0))
          .slice(0, detached.length - MAX_DETACHED_VIEWS)
          .forEach((view) => {
            delete views[view.terminalId]
            releaseTerminalViewMount(view.terminalId)
          })
      }

      return { views }
    }),
  setFocused: (terminalId, focused) =>
    set((state) => {
      const current = state.views[terminalId]
      if (!current || current.focused === focused) return state
      return {
        views: { ...state.views, [terminalId]: { ...current, focused } },
      }
    }),
  evict: (terminalId) =>
    set((state) => {
      if (!state.views[terminalId]) return state
      const views = { ...state.views }
      delete views[terminalId]
      releaseTerminalViewMount(terminalId)
      return { views }
    }),
}))

if (import.meta.env.DEV && typeof window !== "undefined") {
  // Exposed for render-performance/keep-alive diagnostics.
  ;(window as unknown as Record<string, unknown>).__terminalKeepAlive = useTerminalViewKeepAlive
}

/** Drops all cached views for a workspace (workspace closed / relinked). */
export function evictTerminalViewsForWorkspace(workspaceId: string | null): void {
  if (!workspaceId) return
  const { views, evict } = useTerminalViewKeepAlive.getState()
  for (const view of Object.values(views)) {
    if (view.workspaceId === workspaceId) {
      evict(view.terminalId)
    }
  }
}

/**
 * Adopt a terminal's live mount into a tile's DOM. Returns a cleanup that
 * parks the mount back in the keep-alive container (without unmounting the
 * React subtree rendered into it).
 */
export function adoptTerminalViewInto(target: HTMLElement, terminalId: string): () => void {
  const mount = getTerminalViewMount(terminalId)
  target.appendChild(mount)
  return () => {
    if (mount.parentElement === target) {
      parkTerminalViewMount(mount)
    }
  }
}

let parkingLot: HTMLDivElement | null = null

/** Hidden-but-measurable container so a parked xterm keeps valid metrics. */
export function getTerminalParkingLot(): HTMLDivElement {
  if (!parkingLot) {
    parkingLot = document.createElement("div")
    parkingLot.setAttribute("data-terminal-keepalive-lot", "")
    parkingLot.style.position = "fixed"
    parkingLot.style.left = "-10000px"
    parkingLot.style.top = "0"
    parkingLot.style.width = "800px"
    parkingLot.style.height = "480px"
    parkingLot.style.overflow = "hidden"
    parkingLot.style.pointerEvents = "none"
    document.body.appendChild(parkingLot)
  }
  return parkingLot
}

function parkTerminalViewMount(mount: HTMLDivElement): void {
  getTerminalParkingLot().appendChild(mount)
}

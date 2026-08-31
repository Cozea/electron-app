/**
 * Turns a storm of filesystem events into one reload.
 *
 * A single `bun run build` writes thousands of files. Reloading per event would restart
 * the view faster than it can paint and re-run preflight — which walks the tree — often
 * enough to starve the build itself. So changes coalesce into one trailing call after the
 * tree goes quiet.
 *
 * The timer and the watcher are both injected: a watcher whose correctness depends on
 * real time and real inotify is one nobody tests the edges of.
 */

export interface DevAppWatchHandle {
  close: () => void
}

export type DevAppWatch = (
  root: string,
  onChange: (relativePath: string) => void,
) => DevAppWatchHandle | null

export interface DevAppPreviewWatcherDeps {
  watch: DevAppWatch
  setTimer: (callback: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  quietMs?: number
}

/** Long enough to swallow a build's write storm, short enough to feel immediate. */
export const DEFAULT_QUIET_MS = 150

/**
 * Paths whose changes never mean the app changed.
 *
 * Watching them turns an ordinary git operation or an npm install into a reload loop,
 * and `node_modules` alone can be large enough that walking it dominates the debounce.
 */
const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  ".DS_Store",
])

export function isIgnoredChange(relativePath: string): boolean {
  if (relativePath.length === 0) return true
  return relativePath
    .split(/[/\\]/)
    .some((segment) => IGNORED_SEGMENTS.has(segment))
}

export class DevAppPreviewWatcher {
  private readonly deps: Required<DevAppPreviewWatcherDeps>
  private readonly handles = new Map<string, DevAppWatchHandle>()
  private readonly timers = new Map<string, unknown>()

  constructor(deps: DevAppPreviewWatcherDeps) {
    this.deps = { quietMs: DEFAULT_QUIET_MS, ...deps }
  }

  /** Watches a source, calling `onQuiet` once per burst of changes. */
  start(sourceId: string, root: string, onQuiet: () => void): boolean {
    this.stop(sourceId)
    const handle = this.deps.watch(root, (relativePath) => {
      if (isIgnoredChange(relativePath)) return
      this.schedule(sourceId, onQuiet)
    })
    if (!handle) return false
    this.handles.set(sourceId, handle)
    return true
  }

  private schedule(sourceId: string, onQuiet: () => void): void {
    const pending = this.timers.get(sourceId)
    // Trailing edge: each new change pushes the reload out, so the callback lands once
    // the tree has actually settled rather than partway through a build.
    if (pending !== undefined) this.deps.clearTimer(pending)
    this.timers.set(
      sourceId,
      this.deps.setTimer(() => {
        this.timers.delete(sourceId)
        onQuiet()
      }, this.deps.quietMs),
    )
  }

  stop(sourceId: string): void {
    const timer = this.timers.get(sourceId)
    if (timer !== undefined) {
      this.deps.clearTimer(timer)
      this.timers.delete(sourceId)
    }
    const handle = this.handles.get(sourceId)
    if (handle) {
      try {
        handle.close()
      } catch {
        // Already closed by the platform; nothing left to release.
      }
      this.handles.delete(sourceId)
    }
  }

  stopAll(): void {
    // Snapshot: stop() mutates the map being iterated.
    for (const sourceId of Array.from(this.handles.keys())) this.stop(sourceId)
    for (const sourceId of Array.from(this.timers.keys())) this.stop(sourceId)
  }

  isWatching(sourceId: string): boolean {
    return this.handles.has(sourceId)
  }
}

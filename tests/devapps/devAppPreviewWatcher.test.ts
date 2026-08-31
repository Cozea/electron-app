import { describe, expect, it, vi } from "vitest"

import {
  DevAppPreviewWatcher,
  isIgnoredChange,
  type DevAppWatch,
} from "../../apps/desktop/electron/services/DevAppPreviewWatcher"
import { hashSourcePath } from "../../apps/desktop/electron/services/devAppPreviewAdapters"

/** A controllable clock, so debounce behaviour is asserted rather than waited out. */
function makeHarness(options: { watchFails?: boolean } = {}) {
  let nextId = 1
  const timers = new Map<number, { fire: () => void; at: number }>()
  let now = 0

  const emitters = new Map<string, (relativePath: string) => void>()
  const closed: string[] = []

  const watch: DevAppWatch = (root, onChange) => {
    if (options.watchFails) return null
    emitters.set(root, onChange)
    return { close: () => closed.push(root) }
  }

  const watcher = new DevAppPreviewWatcher({
    watch,
    setTimer: (callback, ms) => {
      const id = nextId++
      timers.set(id, { fire: callback, at: now + ms })
      return id
    },
    clearTimer: (handle) => { timers.delete(handle as number) },
    quietMs: 100,
  })

  return {
    watcher,
    closed,
    change: (root: string, relativePath: string) => emitters.get(root)?.(relativePath),
    advance: (ms: number) => {
      now += ms
      for (const [id, timer] of Array.from(timers.entries())) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.fire()
        }
      }
    },
    pending: () => timers.size,
  }
}

describe("Preview watcher — one reload per burst", () => {
  it("does not reload until the tree goes quiet", () => {
    const { watcher, change, advance } = makeHarness()
    const onQuiet = vi.fn()
    watcher.start("src_1", "/proj/app", onQuiet)

    change("/proj/app", "src/a.ts")
    advance(99)
    expect(onQuiet).not.toHaveBeenCalled()
    advance(1)
    expect(onQuiet).toHaveBeenCalledTimes(1)
  })

  it("collapses a write storm into a single reload", () => {
    // A build writes thousands of files. Reloading per event would re-run preflight,
    // which walks the tree, often enough to starve the build.
    const { watcher, change, advance } = makeHarness()
    const onQuiet = vi.fn()
    watcher.start("src_1", "/proj/app", onQuiet)

    for (let i = 0; i < 500; i += 1) {
      change("/proj/app", `src/file-${i}.ts`)
      advance(10)
    }
    expect(onQuiet).not.toHaveBeenCalled()
    advance(100)
    expect(onQuiet).toHaveBeenCalledTimes(1)
  })

  it("reloads again for a change after the first settled", () => {
    const { watcher, change, advance } = makeHarness()
    const onQuiet = vi.fn()
    watcher.start("src_1", "/proj/app", onQuiet)

    change("/proj/app", "a.ts")
    advance(100)
    change("/proj/app", "b.ts")
    advance(100)
    expect(onQuiet).toHaveBeenCalledTimes(2)
  })
})

describe("Preview watcher — what is worth watching", () => {
  it("ignores paths whose changes never mean the app changed", () => {
    for (const path of [
      "node_modules/react/index.js",
      ".git/index",
      ".next/server/app.js",
      "src/.DS_Store",
      "packages/x/node_modules/y/z.js",
      "",
    ]) {
      expect(isIgnoredChange(path), path).toBe(true)
    }
  })

  it("watches ordinary source and the manifest itself", () => {
    for (const path of [
      "src/index.ts",
      "cozea-devapp.json",
      "worker/main.js",
      "public/logo.svg",
      "dist/bundle.js",
      "build/index.html",
      "out/index.html",
    ]) {
      expect(isIgnoredChange(path), path).toBe(false)
    }
  })

  it("does not schedule a reload for an ignored change", () => {
    const { watcher, change, advance } = makeHarness()
    const onQuiet = vi.fn()
    watcher.start("src_1", "/proj/app", onQuiet)
    change("/proj/app", "node_modules/react/index.js")
    advance(1000)
    expect(onQuiet).not.toHaveBeenCalled()
  })
})

describe("Preview watcher — lifecycle", () => {
  it("reports when the platform cannot watch, rather than pretending", () => {
    const { watcher } = makeHarness({ watchFails: true })
    expect(watcher.start("src_1", "/proj/app", vi.fn())).toBe(false)
    expect(watcher.isWatching("src_1")).toBe(false)
  })

  it("drops a pending reload when the source is stopped", () => {
    // Otherwise a closed tile's reload would fire into a session that no longer exists.
    const { watcher, change, advance } = makeHarness()
    const onQuiet = vi.fn()
    watcher.start("src_1", "/proj/app", onQuiet)
    change("/proj/app", "a.ts")
    watcher.stop("src_1")
    advance(1000)
    expect(onQuiet).not.toHaveBeenCalled()
  })

  it("closes the platform handle on stop", () => {
    const { watcher, closed } = makeHarness()
    watcher.start("src_1", "/proj/app", vi.fn())
    watcher.stop("src_1")
    expect(closed).toEqual(["/proj/app"])
  })

  it("replaces an existing watch rather than stacking two", () => {
    const { watcher, closed, change, advance } = makeHarness()
    const onQuiet = vi.fn()
    watcher.start("src_1", "/proj/app", onQuiet)
    watcher.start("src_1", "/proj/app", onQuiet)
    expect(closed).toEqual(["/proj/app"])
    change("/proj/app", "a.ts")
    advance(100)
    expect(onQuiet).toHaveBeenCalledTimes(1)
  })

  it("stops everything at once", () => {
    const { watcher } = makeHarness()
    watcher.start("src_1", "/proj/a", vi.fn())
    watcher.start("src_2", "/proj/b", vi.fn())
    watcher.stopAll()
    expect(watcher.isWatching("src_1")).toBe(false)
    expect(watcher.isWatching("src_2")).toBe(false)
  })

  it("survives a platform handle that throws on close", () => {
    const watcher = new DevAppPreviewWatcher({
      watch: () => ({ close: () => { throw new Error("already closed") } }),
      setTimer: () => 1,
      clearTimer: () => {},
    })
    watcher.start("src_1", "/proj/app", vi.fn())
    expect(() => watcher.stop("src_1")).not.toThrow()
  })
})

describe("Source ids", () => {
  it("is stable for a path", () => {
    expect(hashSourcePath("/Users/a/proj/app")).toBe(hashSourcePath("/Users/a/proj/app"))
  })

  it("differs for different paths", () => {
    expect(hashSourcePath("/Users/a/proj/app")).not.toBe(hashSourcePath("/Users/a/proj/app2"))
  })

  it("does not reveal the path it came from", () => {
    // Ids land in refs that are persisted and handed to agents.
    const id = hashSourcePath("/Users/admin/secret-client/app")
    expect(id).not.toContain("admin")
    expect(id).not.toContain("secret")
  })

  it("fits the ref grammar so it can be addressed", async () => {
    const { parseDevAppRef } = await import("@/features/devapps/registry/ref")
    const id = hashSourcePath("/Users/admin/proj/app")
    expect(parseDevAppRef(`cozea-devapp:dev/${id}`)).toEqual({ kind: "development", sourceId: id })
  })
})

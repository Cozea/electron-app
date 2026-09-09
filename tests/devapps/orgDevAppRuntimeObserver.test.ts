import { afterEach, describe, expect, it, vi } from "vitest"

import type { OrgDevAppRuntimeState } from "@shared/orgDevAppRuntime"
import { OrgDevAppRuntimeObserver } from "@/features/devapps/model/orgDevAppRuntimeObserver"

const identity = { contentHash: "hash", publicationId: "publication" }
const ready: OrgDevAppRuntimeState = {
  contentHash: "hash",
  status: "ready",
  originUrl: "http://127.0.0.1:3000",
  error: null,
  logs: [],
}

afterEach(() => vi.useRealTimers())

describe("OrgDevAppRuntimeObserver", () => {
  it("shares one in-flight request across consumers", async () => {
    vi.useFakeTimers()
    let resolveLoad!: (value: { success: true; state: OrgDevAppRuntimeState }) => void
    const load = vi.fn(() => new Promise<{ success: true; state: OrgDevAppRuntimeState }>((resolve) => {
      resolveLoad = resolve
    }))
    const observer = new OrgDevAppRuntimeObserver(load)
    const first = vi.fn()
    const second = vi.fn()
    const releaseFirst = observer.acquire(identity, false, first)
    const releaseSecond = observer.acquire(identity, true, second)

    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledOnce()
    resolveLoad({ success: true, state: ready })
    await Promise.resolve()
    expect(first).toHaveBeenLastCalledWith({ state: ready, error: null })
    expect(second).toHaveBeenLastCalledWith({ state: ready, error: null })

    releaseFirst()
    releaseSecond()
  })

  it("does not overlap a slow refresh", async () => {
    vi.useFakeTimers()
    let resolveLoad!: (value: { success: true; state: OrgDevAppRuntimeState }) => void
    const load = vi.fn(() => new Promise<{ success: true; state: OrgDevAppRuntimeState }>((resolve) => {
      resolveLoad = resolve
    }))
    const observer = new OrgDevAppRuntimeObserver(load)
    const release = observer.acquire(identity, true, vi.fn())

    await vi.advanceTimersByTimeAsync(10_000)
    expect(load).toHaveBeenCalledOnce()
    resolveLoad({ success: true, state: ready })
    await Promise.resolve()
    release()
  })
})

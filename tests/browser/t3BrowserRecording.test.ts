import type { ScopedThreadRef } from "@cozea/contracts/t3/environment"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { events, frameSubscription, onFrame, save, startScreencast, stopScreencast, surfaceState } =
  vi.hoisted(() => {
    const events: string[] = []
    interface Frame {
      readonly tabId: string
      readonly data: string
      readonly width: number
      readonly height: number
      readonly receivedAt: string
    }
    const frameSubscription: { listener: ((frame: Frame) => void) | null } = { listener: null }
    const surfaceState = { byTabId: {} as Record<string, unknown> }
    return {
      events,
      frameSubscription,
      onFrame: vi.fn((listener: (frame: Frame) => void) => {
        frameSubscription.listener = listener
        return () => {
          if (frameSubscription.listener === listener) frameSubscription.listener = null
        }
      }),
      save: vi.fn(async (tabId: string) => ({
        id: "recording-test",
        tabId,
        path: "/tmp/recording-test.webm",
        mimeType: "video/webm" as const,
        sizeBytes: 0,
        createdAt: "2026-06-26T00:00:00.000Z",
      })),
      startScreencast: vi.fn(async (tabId: string) => {
        events.push("start-screencast")
        const surface = surfaceState.byTabId[tabId] as
          | {
              readonly content?: { readonly width: number; readonly height: number }
              readonly rect?: { readonly width: number; readonly height: number }
            }
          | undefined
        const size = surface?.content ?? surface?.rect
        frameSubscription.listener?.({
          tabId,
          data: "initial-frame",
          width: size?.width ?? 1280,
          height: size?.height ?? 800,
          receivedAt: "2026-06-26T00:00:00.000Z",
        })
      }),
      stopScreencast: vi.fn(async () => undefined),
      surfaceState,
    }
  })

vi.mock("@/features/browser/browserSurfaceStore", () => ({
  useBrowserSurfaceStore: { getState: () => surfaceState },
}))

import {
  BROWSER_RECORDING_FIRST_FRAME_SIZE_TIMEOUT_MS,
  BROWSER_RECORDING_STARTUP_SETTLE_TIMEOUT_MS,
  BrowserRecordingConflictError,
  findActiveBrowserRecordingRuntimeTabId,
  readActiveBrowserRecordingTabIds,
  readActiveBrowserRecordingTargets,
  startBrowserRecording,
  stopBrowserRecording,
  useBrowserRecordingStore,
} from "@/features/browser/browserRecording"

class FakeMediaRecorder {
  static isTypeSupported(): boolean {
    return true
  }

  state: RecordingState = "inactive"
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  start(): void {
    this.state = "recording"
  }

  stop(): void {
    this.state = "inactive"
    for (const listener of this.listeners.get("stop") ?? []) {
      if (typeof listener === "function") listener(new Event("stop"))
      else listener.handleEvent(new Event("stop"))
    }
  }
}

const threadRef = (environmentId: string, threadId: string): ScopedThreadRef =>
  ({ environmentId, threadId }) as ScopedThreadRef

const emitRecordingFrame = (): void => {
  frameSubscription.listener?.({
    tabId: "recording-tab",
    data: "startup-frame",
    width: 800,
    height: 600,
    receivedAt: "2026-06-26T00:00:00.000Z",
  })
}

describe("pinned T3 browser recording lifecycle", () => {
  beforeEach(() => {
    events.length = 0
    frameSubscription.listener = null
    surfaceState.byTabId = {
      "recording-tab": {
        visible: true,
        rect: { x: 0, y: 0, width: 800, height: 600 },
        content: { x: 0, y: 0, width: 800, height: 600, scale: 1, scrollLeft: 0, scrollTop: 0 },
      },
    }
    vi.clearAllMocks()
    vi.stubGlobal("window", globalThis)
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: { preview: { recording: { onFrame, save, startScreencast, stopScreencast } } },
    })
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder)
    class ImmediateImage {
      private loadListener: EventListenerOrEventListenerObject | undefined
      addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        if (type === "load") this.loadListener = listener
      }
      set src(_value: string) {
        const event = new Event("load")
        if (typeof this.loadListener === "function") this.loadListener(event)
        else this.loadListener?.handleEvent(event)
      }
    }
    vi.stubGlobal("Image", ImmediateImage as unknown as typeof Image)
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        captureStream: () => ({}),
        getContext: () => ({ drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: "" }),
      }),
    })
  })

  afterEach(async () => {
    for (const tabId of readActiveBrowserRecordingTabIds()) await stopBrowserRecording(tabId)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("starts visible and hidden tabs without changing surface visibility", async () => {
    await startBrowserRecording("recording-tab")
    expect(startScreencast).toHaveBeenCalledWith("recording-tab")
    expect(useBrowserRecordingStore.getState().activeTabIds).toEqual(new Set(["recording-tab"]))
    await stopBrowserRecording("recording-tab")

    surfaceState.byTabId["recording-tab"] = {
      visible: false,
      rect: { x: 0, y: 0, width: 800, height: 600 },
      content: { x: 0, y: 0, width: 800, height: 600, scale: 1, scrollLeft: 0, scrollTop: 0 },
    }
    await startBrowserRecording("recording-tab")
    expect(startScreencast).toHaveBeenCalledTimes(2)
  })

  it("fails startup and cleans up instead of locking a fallback size", async () => {
    vi.useFakeTimers()
    startScreencast.mockImplementationOnce(async () => {
      events.push("start-screencast")
    })
    const startPromise = startBrowserRecording("recording-tab")
    const rejection = expect(startPromise).rejects.toMatchObject({
      operation: "wait-first-frame",
      tabId: "recording-tab",
    })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(BROWSER_RECORDING_FIRST_FRAME_SIZE_TIMEOUT_MS)
    await rejection
    expect(stopScreencast).toHaveBeenCalledWith("recording-tab")
    expect(readActiveBrowserRecordingTabIds()).toEqual(new Set())
  })

  it("fixes hidden dimensions from the first frame before MediaRecorder starts", async () => {
    const drawImage = vi.fn()
    const fillRect = vi.fn()
    let capturedStreamSize: { readonly width: number; readonly height: number } | undefined
    const canvas = {
      width: 0,
      height: 0,
      captureStream: () => {
        capturedStreamSize = { width: canvas.width, height: canvas.height }
        return {}
      },
      getContext: () => ({ drawImage, fillRect, fillStyle: "" }),
    }
    vi.stubGlobal("document", { createElement: () => canvas })
    surfaceState.byTabId = {}
    startScreencast.mockImplementationOnce(async (tabId: string) => {
      frameSubscription.listener?.({
        tabId,
        data: "captured-frame",
        width: 390,
        height: 844,
        receivedAt: "2026-06-26T00:00:00.000Z",
      })
    })
    await startBrowserRecording("recording-tab")
    expect(canvas).toMatchObject({ width: 390, height: 844 })
    expect(capturedStreamSize).toEqual({ width: 390, height: 844 })
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 390, 844)
    frameSubscription.listener?.({
      tabId: "recording-tab",
      data: "different-sized-frame",
      width: 1280,
      height: 720,
      receivedAt: "2026-06-26T00:00:01.000Z",
    })
    expect(canvas).toMatchObject({ width: 390, height: 844 })
    expect(fillRect).toHaveBeenLastCalledWith(0, 0, 390, 844)
  })

  it("draws newest decoded frames without regressing to a late older frame", async () => {
    const drawImage = vi.fn()
    class DeferredImage {
      static readonly instances: DeferredImage[] = []
      private loadListener: EventListenerOrEventListenerObject | undefined
      constructor() {
        DeferredImage.instances.push(this)
      }
      addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        if (type === "load") this.loadListener = listener
      }
      set src(_value: string) {}
      finishLoading(): void {
        const event = new Event("load")
        if (typeof this.loadListener === "function") this.loadListener(event)
        else this.loadListener?.handleEvent(event)
      }
    }
    vi.stubGlobal("Image", DeferredImage as unknown as typeof Image)
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        captureStream: () => ({}),
        getContext: () => ({ drawImage, fillRect: vi.fn(), fillStyle: "" }),
      }),
    })
    await startBrowserRecording("recording-tab")
    for (const data of ["second-frame", "third-frame"]) {
      frameSubscription.listener?.({
        tabId: "recording-tab",
        data,
        width: 800,
        height: 600,
        receivedAt: "2026-06-26T00:00:01.000Z",
      })
    }
    DeferredImage.instances[1]?.finishLoading()
    DeferredImage.instances[2]?.finishLoading()
    DeferredImage.instances[0]?.finishLoading()
    expect(drawImage).toHaveBeenCalledTimes(2)
  })

  it("records separate tabs concurrently and scopes inventory by assistant thread", async () => {
    const first = threadRef("environment-recording", "thread-recording-first")
    const second = threadRef("environment-recording", "thread-recording-second")
    surfaceState.byTabId["recording-tab-2"] = {
      visible: false,
      rect: { x: 0, y: 0, width: 390, height: 844 },
      content: { x: 0, y: 0, width: 390, height: 844, scale: 1, scrollLeft: 0, scrollTop: 0 },
    }
    await Promise.all([
      startBrowserRecording("recording-tab", first),
      startBrowserRecording("recording-tab-2", second),
    ])
    expect(startScreencast).toHaveBeenCalledTimes(2)
    expect(onFrame).toHaveBeenCalledOnce()
    expect(readActiveBrowserRecordingTabIds(first)).toEqual(new Set(["recording-tab"]))
    expect(readActiveBrowserRecordingTabIds(second)).toEqual(new Set(["recording-tab-2"]))
    await stopBrowserRecording("recording-tab")
    await stopBrowserRecording("recording-tab-2")
    expect(save).toHaveBeenCalledTimes(2)
  })

  it("keeps a recording addressable by runtime id across server epochs", async () => {
    const scoped = threadRef("environment-recording", "thread-recording-scoped")
    const runtimeTabId = "epoch-a:tab_1"
    surfaceState.byTabId = {
      [runtimeTabId]: {
        visible: false,
        rect: { x: 0, y: 0, width: 1280, height: 800 },
        content: { x: 0, y: 0, width: 1280, height: 800, scale: 1, scrollLeft: 0, scrollTop: 0 },
      },
    }
    await startBrowserRecording(runtimeTabId, scoped, "tab_1")
    expect(readActiveBrowserRecordingTargets(scoped)).toEqual([
      { runtimeTabId, serverTabId: "tab_1" },
    ])
    expect(findActiveBrowserRecordingRuntimeTabId(scoped, "tab_1")).toBe(runtimeTabId)
    await expect(startBrowserRecording("epoch-b:tab_1", scoped, "tab_1")).rejects.toBeInstanceOf(
      BrowserRecordingConflictError,
    )
  })

  it("rejects duplicate starts while starting and stopping", async () => {
    let finishStart: (() => void) | undefined
    startScreencast.mockImplementationOnce(async (tabId: string) => {
      frameSubscription.listener?.({
        tabId,
        data: "initial-frame",
        width: 800,
        height: 600,
        receivedAt: "2026-06-26T00:00:00.000Z",
      })
      await new Promise<void>((resolve) => {
        finishStart = resolve
      })
    })
    const firstStart = startBrowserRecording("recording-tab")
    await vi.waitFor(() => expect(startScreencast).toHaveBeenCalledOnce())
    await expect(startBrowserRecording("recording-tab")).rejects.toBeInstanceOf(
      BrowserRecordingConflictError,
    )
    finishStart?.()
    await firstStart

    let finishStop: (() => void) | undefined
    stopScreencast.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishStop = () => resolve(undefined)
        }),
    )
    const stopPromise = stopBrowserRecording("recording-tab")
    await vi.waitFor(() => expect(stopScreencast).toHaveBeenCalledOnce())
    await expect(startBrowserRecording("recording-tab")).rejects.toBeInstanceOf(
      BrowserRecordingConflictError,
    )
    finishStop?.()
    await stopPromise
  })

  it("shares an in-progress stop with duplicate callers", async () => {
    let finishStop: (() => void) | undefined
    stopScreencast.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishStop = () => resolve(undefined)
        }),
    )
    await startBrowserRecording("recording-tab")
    const firstStop = stopBrowserRecording("recording-tab")
    await vi.waitFor(() => expect(stopScreencast).toHaveBeenCalledOnce())
    const duplicateStop = stopBrowserRecording("recording-tab")
    finishStop?.()
    const [firstArtifact, duplicateArtifact] = await Promise.all([firstStop, duplicateStop])
    expect(duplicateArtifact).toEqual(firstArtifact)
    expect(stopScreencast).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledOnce()
  })

  it("finishes startup before stopping so the stop yields an artifact", async () => {
    let finishStart: (() => void) | undefined
    startScreencast.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => void (finishStart = resolve))
      emitRecordingFrame()
    })
    const startPromise = startBrowserRecording("recording-tab")
    await vi.waitFor(() => expect(startScreencast).toHaveBeenCalledOnce())
    const stopPromise = stopBrowserRecording("recording-tab")
    expect(stopScreencast).not.toHaveBeenCalled()
    finishStart?.()
    await startPromise
    await expect(stopPromise).resolves.toMatchObject({ tabId: "recording-tab" })
    expect(save).toHaveBeenCalledOnce()
  })

  it("does not release the slot until a startup-delayed stop settles", async () => {
    let finishStart: (() => void) | undefined
    startScreencast.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => void (finishStart = resolve))
      emitRecordingFrame()
    })
    const firstStart = startBrowserRecording("recording-tab")
    await vi.waitFor(() => expect(startScreencast).toHaveBeenCalledOnce())
    const stopPromise = stopBrowserRecording("recording-tab")
    await expect(startBrowserRecording("recording-tab")).rejects.toBeInstanceOf(
      BrowserRecordingConflictError,
    )
    finishStart?.()
    await firstStart
    await stopPromise
  })

  it("keeps the slot while a failed stop waits for startup", async () => {
    let finishStart: (() => void) | undefined
    startScreencast.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => void (finishStart = resolve))
      emitRecordingFrame()
    })
    stopScreencast.mockRejectedValueOnce(new Error("initial stop failed"))
    const firstStart = startBrowserRecording("recording-tab")
    await vi.waitFor(() => expect(startScreencast).toHaveBeenCalledOnce())
    const rejectedStop = expect(stopBrowserRecording("recording-tab")).rejects.toMatchObject({
      operation: "stop-screencast",
      tabId: "recording-tab",
    })
    await expect(startBrowserRecording("recording-tab")).rejects.toBeInstanceOf(
      BrowserRecordingConflictError,
    )
    finishStart?.()
    await firstStart
    await rejectedStop
    await startBrowserRecording("recording-tab")
  })

  it("times out a stop waiting for startup without freeing its slot", async () => {
    vi.useFakeTimers()
    let finishStart: (() => void) | undefined
    startScreencast.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => void (finishStart = resolve))
      emitRecordingFrame()
    })
    const startPromise = startBrowserRecording("recording-tab")
    const stopPromise = stopBrowserRecording("recording-tab")
    const rejection = expect(stopPromise).rejects.toMatchObject({
      operation: "wait-startup",
      tabId: "recording-tab",
    })
    await vi.advanceTimersByTimeAsync(BROWSER_RECORDING_STARTUP_SETTLE_TIMEOUT_MS)
    await rejection
    await expect(startBrowserRecording("recording-tab")).rejects.toBeInstanceOf(
      BrowserRecordingConflictError,
    )
    finishStart?.()
    await startPromise
    await expect(stopBrowserRecording("recording-tab")).resolves.toBeNull()
    expect(save).not.toHaveBeenCalled()
  })
})

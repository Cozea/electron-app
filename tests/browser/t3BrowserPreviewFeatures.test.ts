import type { PreviewAnnotationPayload } from "@cozea/contracts/t3/ipc"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  resizeBrowserViewportFromRail,
  resizeFreeformViewport,
  resolveBrowserDeviceViewportLayout,
  resolveFittedBrowserViewport,
  resolveBrowserViewportLayout,
  resolveResponsiveBrowserViewportSize,
} from "@/features/projects/browser/browserViewportLayout"
import {
  BROWSER_VIEWPORT_COMMIT_TIMEOUT_MS,
  commitBrowserViewportChange,
  runBrowserViewportMutation,
  subscribeBrowserViewportChange,
} from "@/features/projects/browser/browserViewportActions"
import {
  appendPreviewAnnotationPrompt,
  buildPreviewAnnotationPrompt,
  extractTrailingPreviewAnnotations,
} from "@/features/projects/browser/previewAnnotation"
import { agentBrowserCursorOpacity } from "@/features/projects/browser/agentBrowserCursorLogic"

describe("pinned T3 responsive browser viewport", () => {
  it("fills, centers, zooms, and frames the guest using renderer-local geometry", () => {
    expect(resolveBrowserViewportLayout({ width: 700, height: 500 }, { _tag: "fill" })).toEqual({
      canvasWidth: 700,
      canvasHeight: 500,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 700,
      viewportHeight: 500,
      viewportScale: 1,
      fillsPanel: true,
    })
    expect(
      resolveBrowserViewportLayout(
        { width: 800, height: 700 },
        { _tag: "freeform", width: 400, height: 300 },
        1.5,
      ),
    ).toMatchObject({ viewportX: 100, viewportY: 125, viewportWidth: 600, viewportHeight: 450 })
    expect(
      resolveBrowserDeviceViewportLayout(
        { width: 1200, height: 900 },
        { _tag: "freeform", width: 1180, height: 858 },
      ),
    ).toMatchObject({ viewportX: 10, viewportY: 32, viewportWidth: 1180, viewportHeight: 858 })
  })

  it("preserves CSS size, aspect ratio, and area limits while resizing", () => {
    expect(
      resizeFreeformViewport({ width: 800, height: 600 }, { x: 200, y: 0 }, 1, "east", 4 / 3),
    ).toEqual({ width: 1000, height: 750 })
    expect(
      resizeBrowserViewportFromRail(
        { width: 1120, height: 818 },
        { x: -100, y: -50 },
        { width: 1120, height: 818 },
        1,
        "southeast",
      ),
    ).toEqual({ width: 920, height: 718 })
    const large = resizeFreeformViewport({ width: 1920, height: 1080 }, { x: 2000, y: 2000 })
    expect(large.width * large.height).toBeLessThanOrEqual(3840 * 2160)
    expect(resolveResponsiveBrowserViewportSize({ width: 1200, height: 900 }, 2)).toEqual({
      width: 590,
      height: 429,
    })
  })

  it("uses the fixed viewport instead of stale fitted source dimensions", () => {
    expect(
      resolveFittedBrowserViewport(
        { _tag: "freeform", width: 900, height: 600 },
        { width: 1280, height: 800, scale: 1 },
      ),
    ).toEqual({ _tag: "freeform", width: 900, height: 600 })
  })
})

describe("pinned T3 viewport commit serialization", () => {
  afterEach(() => vi.useRealTimers())

  it("keeps visible commits behind earlier background mutations", async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: string[] = []
    const background = runBrowserViewportMutation("shared", async () => {
      calls.push("background")
      await pending
    })
    const unsubscribe = subscribeBrowserViewportChange("shared", async () => {
      calls.push("visible")
    })
    const visible = commitBrowserViewportChange("shared", {
      _tag: "freeform",
      width: 900,
      height: 700,
    })
    await vi.waitFor(() => expect(calls).toEqual(["background"]))
    release?.()
    await Promise.all([background, visible])
    expect(calls).toEqual(["background", "visible"])
    unsubscribe()
  })

  it("times out callers without letting a newer commit overtake the handler", async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    const delayed = new Promise<void>((resolve) => {
      release = resolve
    })
    const handler = vi
      .fn()
      .mockImplementationOnce(() => delayed)
      .mockResolvedValueOnce(undefined)
    const unsubscribe = subscribeBrowserViewportChange("timeout", handler)
    const first = commitBrowserViewportChange("timeout", {
      _tag: "freeform",
      width: 800,
      height: 600,
    })
    const rejected = expect(first).rejects.toThrow("Timed out committing the browser viewport")
    const second = commitBrowserViewportChange("timeout", {
      _tag: "freeform",
      width: 900,
      height: 700,
    })
    await vi.advanceTimersByTimeAsync(BROWSER_VIEWPORT_COMMIT_TIMEOUT_MS)
    await rejected
    expect(handler).toHaveBeenCalledTimes(1)
    release?.()
    await second
    expect(handler).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})

const annotation: PreviewAnnotationPayload = {
  id: "annotation_1",
  pageUrl: "http://localhost:3000",
  pageTitle: "Example",
  comment: "Make these cards feel related.",
  elements: [],
  regions: [{ id: "region_1", rect: { x: 10, y: 20, width: 100, height: 80 } }],
  strokes: [
    {
      id: "stroke_1",
      color: "#7c3aed",
      width: 4,
      points: [{ x: 10, y: 10 }],
      bounds: { x: 6, y: 6, width: 18, height: 18 },
    },
  ],
  styleChanges: [
    {
      targetId: "element_1",
      selector: ".card",
      property: "border-radius",
      previousValue: "4px",
      value: "16px",
    },
  ],
  screenshot: {
    dataUrl: "data:image/png;base64,AA==",
    width: 100,
    height: 80,
    cropRect: { x: 10, y: 20, width: 100, height: 80 },
  },
  createdAt: "2026-06-11T00:00:00.000Z",
}

describe("pinned T3 preview annotations and cursor", () => {
  it("preserves structured targets and extracts multiple sent annotations", () => {
    expect(buildPreviewAnnotationPrompt(annotation)).toContain("border-radius: 4px → 16px")
    const prompt = appendPreviewAnnotationPrompt(
      appendPreviewAnnotationPrompt("Fix this", annotation),
      { ...annotation, id: "annotation_2" },
    )
    expect(extractTrailingPreviewAnnotations(prompt)).toMatchObject({
      promptText: "Fix this",
      annotations: [{ id: "annotation_1" }, { id: "annotation_2" }],
    })
  })

  it("keeps the agent pointer visible briefly and dims it by controller afterward", () => {
    expect(agentBrowserCursorOpacity(true, "agent")).toBe(1)
    expect(agentBrowserCursorOpacity(false, "agent")).toBe(0.35)
    expect(agentBrowserCursorOpacity(false, "human")).toBe(0.18)
  })
})

import { describe, expect, it } from "vitest"

import { resolveBrowserRecordingStopTarget } from "@/features/browser/browserRecordingScope"

describe("pinned T3 browser recording target scope", () => {
  it("stops the only active recording when the implicit target changed", () => {
    expect(resolveBrowserRecordingStopTarget(new Set(["tab-recording"]), "tab-browsing")).toBe(
      "tab-recording",
    )
  })

  it("prefers an implicit target that is actively recording", () => {
    expect(
      resolveBrowserRecordingStopTarget(
        new Set(["tab-recording-a", "tab-recording-b"]),
        "tab-recording-b",
      ),
    ).toBe("tab-recording-b")
  })

  it("does not guess between multiple recordings", () => {
    expect(
      resolveBrowserRecordingStopTarget(
        new Set(["tab-recording-a", "tab-recording-b"]),
        "tab-browsing",
      ),
    ).toBeNull()
  })

  it("only accepts an explicitly requested active recording", () => {
    const activeTabIds = new Set(["tab-recording"])
    expect(resolveBrowserRecordingStopTarget(activeTabIds, "other", "tab-recording")).toBe(
      "tab-recording",
    )
    expect(resolveBrowserRecordingStopTarget(activeTabIds, "tab-recording", "other")).toBeNull()
  })

  it("returns null when no recording matches", () => {
    expect(resolveBrowserRecordingStopTarget(new Set(), "tab-browsing")).toBeNull()
  })
})

import { afterEach, describe, expect, it } from "vitest"

import {
  beginProjectSwitch,
  endProjectSwitch,
  markProjectSwitchPhase,
} from "@/lib/performance/projectSwitchMarks"

describe("projectSwitchMarks", () => {
  afterEach(() => {
    endProjectSwitch({ reason: "test-cleanup" })
  })

  it("records one measure from start to end", () => {
    performance.clearMarks()
    performance.clearMeasures()

    beginProjectSwitch({ to: "proj_a" })
    markProjectSwitchPhase("project-query")
    markProjectSwitchPhase("project-query")
    endProjectSwitch({ to: "proj_a" })

    const measures = performance.getEntriesByName("cozea:interaction:project-switch").filter(
      (entry) => entry.entryType === "measure",
    )
    expect(measures.length).toBe(1)
    const phaseMeasures = performance
      .getEntriesByName("cozea:interaction:project-switch:project-query")
      .filter((entry) => entry.entryType === "measure")
    expect(phaseMeasures.length).toBe(1)
  })

  it("ignores phases after the switch has ended", () => {
    performance.clearMarks()
    performance.clearMeasures()

    beginProjectSwitch({ to: "proj_a" })
    endProjectSwitch()
    markProjectSwitchPhase("dockview-ready")

    expect(
      performance
        .getEntriesByName("cozea:interaction:project-switch:dockview-ready")
        .filter((entry) => entry.entryType === "measure"),
    ).toHaveLength(0)
  })
})

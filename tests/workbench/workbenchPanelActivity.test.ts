import { describe, expect, it } from "vitest"

import {
  resolveWorkbenchPanelActivity,
  type WorkbenchPanelActivityState,
} from "@/features/workbench/useWorkbenchPanelActivityMode"

const dockVisible: WorkbenchPanelActivityState = {
  mode: "visible",
  visible: true,
  focused: true,
  retained: true,
}
const dockHidden: WorkbenchPanelActivityState = {
  mode: "hidden",
  visible: false,
  focused: false,
  retained: false,
}

describe("resolveWorkbenchPanelActivity", () => {
  it("passes dock state through while the workbench surface is visible", () => {
    expect(resolveWorkbenchPanelActivity(dockVisible, true, true)).toBe(dockVisible)
    expect(resolveWorkbenchPanelActivity(dockHidden, true, true)).toBe(dockHidden)
  })

  it("hides but retains the foreground workbench's visible panels behind an ordinary page", () => {
    expect(resolveWorkbenchPanelActivity(dockVisible, false, true)).toEqual({
      mode: "hidden",
      visible: false,
      focused: false,
      retained: true,
    })
  })

  it("does not retain a panel that is hidden inside its own dock", () => {
    expect(resolveWorkbenchPanelActivity(dockHidden, false, true).retained).toBe(false)
  })

  it("releases panels once another workbench takes the foreground", () => {
    expect(resolveWorkbenchPanelActivity(dockVisible, false, false)).toEqual(dockHidden)
  })
})

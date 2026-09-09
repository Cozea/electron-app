import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  clearLastAppRoute,
  getLastAppRoute,
  isSettingsModeRoute,
  saveLastAppRoute,
} from "@/lib/settings/settingsReturnRoute"
import {
  clearLastWorkbenchRoute,
  writeLastWorkbenchRoute,
} from "@/features/workbench/model/lastWorkbenchRoute"

describe("settings return route", () => {
  const workspaceSelectionId = "settings-return-test"

  beforeEach(() => {
    clearLastAppRoute()
    clearLastWorkbenchRoute(workspaceSelectionId)
  })

  afterEach(() => {
    clearLastAppRoute()
    clearLastWorkbenchRoute(workspaceSelectionId)
  })

  it("does not replace app history with settings routes", () => {
    expect(isSettingsModeRoute("/projects/settings/account")).toBe(true)
    saveLastAppRoute("/projects/store")
    saveLastAppRoute("/projects/settings/appearance")
    expect(getLastAppRoute(workspaceSelectionId)).toBe("/projects/store")
  })

  it("retains search parameters", () => {
    saveLastAppRoute("/projects/skills?view=builds")
    expect(getLastAppRoute(workspaceSelectionId)).toBe("/projects/skills?view=builds")
  })

  it("falls back to the durable workbench locator", () => {
    writeLastWorkbenchRoute({
      workspaceSelectionId,
      projectId: "project-a",
      laneId: "main",
      focusTileId: "tile-a",
      updatedAt: Date.now(),
    })
    expect(getLastAppRoute(workspaceSelectionId)).toBe(
      "/projects/p/project-a/workbench?lane=main&focusTile=tile-a",
    )
  })
})

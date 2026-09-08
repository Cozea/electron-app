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

describe("settingsReturnRoute", () => {
  const TEST_WORKSPACE_SELECTION_ID = "test-device-selection"

  beforeEach(() => {
    clearLastAppRoute()
    clearLastWorkbenchRoute(TEST_WORKSPACE_SELECTION_ID)
  })

  afterEach(() => {
    clearLastAppRoute()
    clearLastWorkbenchRoute(TEST_WORKSPACE_SELECTION_ID)
  })

  describe("isSettingsModeRoute", () => {
    it("identifies settings routes correctly", () => {
      expect(isSettingsModeRoute("/projects/settings/account")).toBe(true)
      expect(isSettingsModeRoute("/projects/settings/appearance")).toBe(true)
      expect(isSettingsModeRoute("/projects/settings/tooling")).toBe(true)
      expect(isSettingsModeRoute("/projects/settings/devapps")).toBe(true)
      expect(isSettingsModeRoute("/projects/settings/organizations")).toBe(true)
      expect(isSettingsModeRoute("/projects/workspace/general")).toBe(true)
      expect(isSettingsModeRoute("/projects/teams")).toBe(true)
      expect(isSettingsModeRoute("/settings/account")).toBe(true)
      expect(isSettingsModeRoute("/settings")).toBe(true)
    })

    it("identifies app content routes as non-settings", () => {
      expect(isSettingsModeRoute("/projects/store")).toBe(false)
      expect(isSettingsModeRoute("/projects/skills")).toBe(false)
      expect(isSettingsModeRoute("/projects/inbox")).toBe(false)
      expect(isSettingsModeRoute("/projects/p/proj_123/workbench")).toBe(false)
      expect(isSettingsModeRoute("/projects/p/proj_123/changes")).toBe(false)
      expect(isSettingsModeRoute("/projects")).toBe(false)
      expect(isSettingsModeRoute(null)).toBe(false)
      expect(isSettingsModeRoute(undefined)).toBe(false)
    })
  })

  describe("saveLastAppRoute and getLastAppRoute", () => {
    it("returns /projects by default when nothing is saved or active", () => {
      expect(getLastAppRoute(TEST_WORKSPACE_SELECTION_ID)).toBe("/projects")
    })

    it("remembers and returns /projects/store when navigated to settings from the DevApps Store", () => {
      saveLastAppRoute("/projects/store")

      // Attempting to save a settings route should not overwrite the app route
      saveLastAppRoute("/projects/settings/account")
      saveLastAppRoute("/projects/settings/appearance")
      saveLastAppRoute("/projects/settings/devapps")

      expect(getLastAppRoute(TEST_WORKSPACE_SELECTION_ID)).toBe("/projects/store")
    })

    it("remembers and returns /projects/skills with query parameters when navigated from Agent Skills", () => {
      saveLastAppRoute("/projects/skills?view=builds")

      saveLastAppRoute("/projects/settings/tooling")

      expect(getLastAppRoute(TEST_WORKSPACE_SELECTION_ID)).toBe("/projects/skills?view=builds")
    })

    it("remembers and returns workbench with parameters when navigated from a project workbench", () => {
      saveLastAppRoute("/projects/p/project_abc/workbench?lane=feat-1&focusTile=tile_99")

      saveLastAppRoute("/projects/settings/account")

      expect(getLastAppRoute(TEST_WORKSPACE_SELECTION_ID)).toBe(
        "/projects/p/project_abc/workbench?lane=feat-1&focusTile=tile_99",
      )
    })

    it("falls back to the last active workbench route when no app route is stored", () => {
      writeLastWorkbenchRoute({
        workspaceSelectionId: TEST_WORKSPACE_SELECTION_ID,
        projectId: "proj_saved",
        laneId: "main",
        focusTileId: "tile_1",
        updatedAt: Date.now(),
      })

      expect(getLastAppRoute(TEST_WORKSPACE_SELECTION_ID)).toBe(
        "/projects/p/proj_saved/workbench?lane=main&focusTile=tile_1",
      )
    })

    it("clears the route when requested", () => {
      saveLastAppRoute("/projects/store")
      expect(getLastAppRoute(TEST_WORKSPACE_SELECTION_ID)).toBe("/projects/store")

      clearLastAppRoute()
      expect(getLastAppRoute(TEST_WORKSPACE_SELECTION_ID)).toBe("/projects")
    })
  })
})

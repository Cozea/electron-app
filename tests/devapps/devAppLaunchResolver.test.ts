import { describe, expect, it } from "vitest"

import { resolveWorkbenchSelectionLaunchRequest } from "@/features/projects/lib/workbenchSelectionLaunch"

describe("resolveWorkbenchSelectionLaunchRequest", () => {
  it("resolves assistant apps to addTile requests with provider defaults", () => {
    expect(resolveWorkbenchSelectionLaunchRequest({ appId: "codex" })).toEqual({
      action: "addTile",
      tileType: "assistantChat",
      options: {
        title: "Codex",
        provider: "codex",
      },
    })
  })

  it("resolves singleton-capable surfaces to singleton tile actions", () => {
    expect(resolveWorkbenchSelectionLaunchRequest({ appId: "dev-server" })).toEqual({
      action: "openSingletonTile",
      tileType: "devServer",
      options: {
        title: "Dev Server",
      },
    })
  })

  it("resolves regular surface apps to addTile requests", () => {
    expect(resolveWorkbenchSelectionLaunchRequest({ appId: "browser" })).toEqual({
      action: "addTile",
      tileType: "browser",
      options: {
        title: "Browser",
      },
    })
  })

  it("resolves a private project release to an auto-starting Dev Server singleton", () => {
    expect(
      resolveWorkbenchSelectionLaunchRequest({
        appId: "project-devapp:publication_1",
        projectDevApp: {
          kind: "projectDevApp",
          tileType: "devServer",
          singleton: true,
          publicationId: "publication_1",
          releaseId: "release_2",
          releaseVersion: 2,
          projectId: "project_1",
          sourceWorkspaceId: "workspace_1",
          sourceLaneId: "lane_1",
          name: "Inventory Console",
          framework: "vite-react",
          devCommand: "bun run dev",
          devPort: 5173,
        },
      }),
    ).toEqual({
      action: "openSingletonTile",
      tileType: "devServer",
      options: {
        title: "Inventory Console",
        devAppId: "publication_1",
        devAppReleaseId: "release_2",
        devAppReleaseVersion: 2,
        devAppProjectId: "project_1",
        devAppWorkspaceId: "workspace_1",
        devAppLaneId: "lane_1",
        devAppFramework: "vite-react",
        devAppCommand: "bun run dev",
        devAppPort: 5173,
        autoStart: true,
      },
    })
  })

  it("rejects a project release paired with another publication id", () => {
    expect(() =>
      resolveWorkbenchSelectionLaunchRequest({
        appId: "project-devapp:publication_2",
        projectDevApp: {
          kind: "projectDevApp",
          tileType: "devServer",
          singleton: true,
          publicationId: "publication_1",
          releaseId: "release_1",
          releaseVersion: 1,
          projectId: "project_1",
          name: "Inventory Console",
          framework: "vite-react",
          devCommand: "bun run dev",
        },
      }),
    ).toThrow('Invalid project DevApp launch request for "project-devapp:publication_2"')
  })

  it("throws for unknown apps", () => {
    expect(() => resolveWorkbenchSelectionLaunchRequest({ appId: "nope" })).toThrow(
      'Unknown DevApp "nope"',
    )
  })
})

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

  it("resolves a published org DevApp to an isolated addTile, never Dev Server", () => {
    expect(
      resolveWorkbenchSelectionLaunchRequest({
        appId: "org-devapp:publication_1",
        publishedDevApp: {
          kind: "publishedDevApp",
          tileType: "orgDevApp",
          publicationId: "publication_1",
          organizationId: "org_1",
          organizationName: "Acme",
          releaseId: "release_2",
          releaseVersion: 2,
          name: "Inventory Console",
          framework: "vite-react",
          contentHash: "a".repeat(64),
          entryPath: "index.html",
        },
      }),
    ).toEqual({
      action: "addTile",
      tileType: "orgDevApp",
      options: {
        title: "Inventory Console",
        url: "",
        storageScope: "orgDevApp",
        devAppId: "publication_1",
        devAppReleaseId: "release_2",
        devAppReleaseVersion: 2,
        orgDevAppPublicationId: "publication_1",
        orgDevAppOrganizationId: "org_1",
        orgDevAppContentHash: "a".repeat(64),
        orgDevAppEntryPath: "index.html",
        orgDevAppLogoDataUrl: null,
      },
    })
  })

  it("rejects leftover localhost project DevApp launch requests", () => {
    expect(() =>
      resolveWorkbenchSelectionLaunchRequest({
        appId: "project-devapp:publication_1",
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
    ).toThrow("Localhost project DevApps are no longer a consumer launch path")
  })

  it("throws for unknown apps", () => {
    expect(() => resolveWorkbenchSelectionLaunchRequest({ appId: "nope" })).toThrow(
      'Unknown DevApp "nope"',
    )
  })
})

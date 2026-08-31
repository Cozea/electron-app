import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { partitionForDescriptor } from "../../shared/browserSurfaceSessions"
import type { BrowserSurfaceDescriptor } from "../../shared/browserSurfaceTypes"

/**
 * A partition is a storage isolation boundary: two surfaces sharing one share cookies,
 * localStorage, IndexedDB and service workers. These assert that unpublished code never
 * lands in a published app's.
 */

const base: BrowserSurfaceDescriptor = {
  runtimeTabId: "tab_1",
  tileId: "tile_1",
  workbenchSessionKey: "session_1",
  kind: "browser",
  title: "T",
  initialUrl: null,
  storageScope: "ephemeral",
}

const published = (publicationId: string): BrowserSurfaceDescriptor => ({
  ...base,
  kind: "orgDevApp",
  storageScope: "orgDevApp",
  publicationId,
})

const preview = (devSourceId: string): BrowserSurfaceDescriptor => ({
  ...base,
  kind: "devAppPreview",
  storageScope: "devAppPreview",
  devSourceId,
})

describe("Preview surfaces are isolated from published ones", () => {
  it("gives a preview its own partition", () => {
    expect(partitionForDescriptor(preview("a".repeat(32))))
      .toBe(`persist:cozea-devapp-preview.${"a".repeat(32)}`)
  })

  it("never collides with a published app's partition", () => {
    const sourceId = "b".repeat(32)
    expect(partitionForDescriptor(preview(sourceId)))
      .not.toBe(partitionForDescriptor(published(sourceId)))
  })

  it("cannot be reached by a publication named to look like a preview", () => {
    // publicationId is normalized to [A-Za-z0-9_-], so it can never produce the dot that
    // separates the preview namespace. This is the case a hyphen separator would miss.
    const sourceId = "c".repeat(32)
    for (const impersonation of [
      `preview.${sourceId}`,
      `preview-${sourceId}`,
      `preview${sourceId}`,
    ]) {
      expect(partitionForDescriptor(published(impersonation)), impersonation)
        .not.toBe(partitionForDescriptor(preview(sourceId)))
    }
  })

  it("keeps two different sources apart", () => {
    expect(partitionForDescriptor(preview("d".repeat(32))))
      .not.toBe(partitionForDescriptor(preview("e".repeat(32))))
  })

  it("falls back to an ephemeral partition when a preview has no source id", () => {
    // Never to a persisted one: an incomplete descriptor must not be handed storage that
    // outlives the tile.
    const partition = partitionForDescriptor({ ...preview(""), devSourceId: null })
    expect(partition.startsWith("persist:")).toBe(false)
  })

  it("leaves the existing partitions unchanged", () => {
    expect(partitionForDescriptor({ ...base, storageScope: "global" }))
      .toBe("persist:cozea-browser-global")
    expect(partitionForDescriptor({ ...base, storageScope: "workspace", workspaceId: "ws_1" }))
      .toBe("persist:cozea-browser-workspace-ws_1")
    expect(partitionForDescriptor(published("pub_1"))).toBe("persist:cozea-devapp-pub_1")
    expect(partitionForDescriptor(base)).toBe("cozea-browser-ephemeral-tile_1")
  })
})

describe("The surface service guards the preview session", () => {
  // Source assertions: the guard lives inside a stateful Electron service, so its
  // messages are checked here while the partition rule above is exercised directly.
  const source = fs.readFileSync(
    path.join(process.cwd(), "apps/desktop/electron/services/T3BrowserSurfaceService.ts"),
    "utf8",
  )

  it("refuses a non-preview surface asking for a preview session", () => {
    expect(source).toContain("Only a DevApp preview may use a DevApp preview session.")
  })

  it("requires a preview surface to carry a well-formed source id", () => {
    expect(source).toContain("A DevApp preview surface needs its own preview session.")
    expect(source).toMatch(/\^\[0-9a-f\]\{32\}\$/)
  })
})

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

  it("throws for unknown apps", () => {
    expect(() => resolveWorkbenchSelectionLaunchRequest({ appId: "nope" })).toThrow(
      'Unknown DevApp "nope"',
    )
  })
})

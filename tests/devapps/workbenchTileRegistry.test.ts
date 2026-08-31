import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { BUILTIN_DEV_APPS, getDevAppForSurfaceTileType } from "@/features/devapps/registry"
import {
  getWorkbenchDockDefinition,
  getWorkbenchTileDefinition,
  isBrowserBackedWorkbenchTile,
  RENDERABLE_WORKBENCH_TILE_TYPES,
  WORKBENCH_TILE_REGISTRY,
} from "@/features/projects/lib/workbenchTileRegistry"

const root = process.cwd()
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8")

describe("Workbench tile registry — one shell contract", () => {
  it("covers every persisted tile type and identifies every renderable type", () => {
    expect(Object.keys(WORKBENCH_TILE_REGISTRY).sort()).toEqual([
      "assistantChat",
      "browser",
      "devAppPreview",
      "devServer",
      "llama",
      "mobileSimulator",
      "orgDevApp",
      "selection",
      "tasks",
      "terminal",
    ])
    expect([...RENDERABLE_WORKBENCH_TILE_TYPES].sort()).toEqual(
      Object.entries(WORKBENCH_TILE_REGISTRY)
        .filter(([, definition]) => definition.dock !== null)
        .map(([type]) => type)
        .sort(),
    )
  })

  it("owns the complete development-preview Dockview policy", () => {
    expect(getWorkbenchTileDefinition("devAppPreview")).toMatchObject({
      defaultTitle: "DevApp (development)",
      tabLabel: "DevApp preview",
      manifestSource: "published",
      panelRenderer: "devAppPreview",
      dock: {
        renderer: "always",
        constraints: { minimumWidth: 320, minimumHeight: 220 },
        tabGroup: { label: "Preview", color: "preview" },
        browserBacked: true,
        headerControls: "registered",
      },
    })
    expect(isBrowserBackedWorkbenchTile({ type: "devAppPreview" })).toBe(true)
  })

  it("keeps browser policy structural instead of inferred from component names", () => {
    expect(isBrowserBackedWorkbenchTile({ type: "browser" })).toBe(true)
    expect(isBrowserBackedWorkbenchTile({ type: "devServer" })).toBe(true)
    expect(isBrowserBackedWorkbenchTile({ type: "orgDevApp" })).toBe(true)
    expect(isBrowserBackedWorkbenchTile({ type: "terminal" })).toBe(false)
    expect(isBrowserBackedWorkbenchTile({ type: "mobileSimulator" })).toBe(false)
    expect(getWorkbenchDockDefinition("changes")?.browserBacked).toBe(false)
  })
})

describe("Workbench tile registry — consumers do not compete", () => {
  it("drives Dockview, floating/popout, restoration, chrome, and component registration", () => {
    const dockview = read("apps/desktop/src/features/projects/lib/workbenchDockview.ts")
    const canvas = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchDockviewCanvas.tsx",
    )
    const runtime = read("apps/desktop/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts")
    const panels = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchDockPanels.tsx",
    )
    const chrome = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchTileChrome.tsx",
    )

    expect(dockview).toContain("getWorkbenchDockDefinition")
    expect(dockview).toContain("getWorkbenchTileDefinition")
    expect(canvas).toContain("isBrowserBackedWorkbenchTile")
    expect(canvas).not.toContain("function isBrowserBackedTile")
    expect(runtime).toContain("isBrowserBackedWorkbenchTile")
    expect(panels).toContain("RENDERABLE_WORKBENCH_TILE_TYPES")
    expect(panels).toContain("WORKBENCH_PANEL_RENDERERS[renderer]")
    expect(chrome).toContain("getWorkbenchTileDefinition(tileType)")
  })

  it("discovers self-contained built-ins instead of hand-listing their modules", () => {
    const registry = read("apps/desktop/src/features/devapps/registry/index.ts")
    expect(registry).toContain("import.meta.glob")
    expect(registry).toContain('"../apps/*/manifest.ts"')
    expect(registry).not.toMatch(/apps\/(browser|terminal|dev-server)\/manifest/)
    expect(BUILTIN_DEV_APPS).toHaveLength(9)
    for (const manifest of BUILTIN_DEV_APPS) {
      expect(manifest.parts, manifest.id).toBeTruthy()
    }
    expect(getDevAppForSurfaceTileType("llama")?.id).toBe("llama")
  })
})

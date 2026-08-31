import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  getDockComponentName,
  getPanelConstraintsForTile,
  getPanelRendererForTile,
  resolveTabGroupPreset,
} from "@/features/projects/lib/workbenchDockview"

const root = process.cwd()
const tileSource = fs.readFileSync(
  path.join(
    root,
    "apps/desktop/src/features/projects/components/workbench/WorkbenchDevAppPreviewTile.tsx",
  ),
  "utf8",
)
const storeSource = fs.readFileSync(
  path.join(root, "apps/desktop/src/stores/useProjectWorkbenchStore.ts"),
  "utf8",
)
const panelsSource = fs.readFileSync(
  path.join(
    root,
    "apps/desktop/src/features/projects/components/workbench/WorkbenchDockPanels.tsx",
  ),
  "utf8",
)
const commandSource = fs.readFileSync(
  path.join(
    root,
    "apps/desktop/src/features/projects/components/command-palette/useWorkbenchCommandRegistry.ts",
  ),
  "utf8",
)
const commandHostSource = fs.readFileSync(
  path.join(
    root,
    "apps/desktop/src/features/projects/components/command-palette/WorkbenchCommandPaletteHost.tsx",
  ),
  "utf8",
)
const workbenchSurfaceSource = fs.readFileSync(
  path.join(root, "apps/desktop/src/features/projects/pages/ProjectWorkbenchSurface.tsx"),
  "utf8",
)
const dockviewCanvasSource = fs.readFileSync(
  path.join(
    root,
    "apps/desktop/src/features/projects/components/workbench/WorkbenchDockviewCanvas.tsx",
  ),
  "utf8",
)
const dockviewRuntimeSource = fs.readFileSync(
  path.join(root, "apps/desktop/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts"),
  "utf8",
)

describe("Preview tile — persists no location", () => {
  it("stores a workspace-relative path, never an absolute one", () => {
    // A restored tile must not be able to name a directory outside its project. Main
    // joins this against the root authorization returns.
    expect(storeSource).toContain("relativePath: string")
    expect(storeSource).toContain("devAppPreviewRelativePath")
  })

  it("sends the relative path and lets the host assign identity", () => {
    expect(tileSource).toContain("relativePath: tile.relativePath")
    expect(tileSource).not.toMatch(/sourcePath|workspaceRoot/)
  })
})

describe("Preview tile — renders the host's decisions", () => {
  it("takes its status from the host rather than deriving one", () => {
    // The tile must not be able to grant, approve, or mask anything by being wrong.
    expect(tileSource).toContain("DevAppPreviewStatus")
    expect(tileSource).toContain(".approve({ sourceId })")
    expect(tileSource).not.toContain("normalizeGrant")
    expect(tileSource).not.toContain("DevAppDevelopmentTrustStore")
  })

  it("always shows a development badge, whatever the trust state", () => {
    expect(tileSource).toContain("function DevelopmentBadge")
    expect(tileSource).toContain('badge?.label ?? "Development"')
  })

  it("tells the user the grant is not saved", () => {
    expect(tileSource).toContain("This grant is not saved")
    expect(tileSource).toContain("Allow for this session")
  })

  it("surfaces preflight blockers while the app is running", () => {
    expect(tileSource).toContain("would block publishing")
    expect(tileSource).toContain('severity === "blocker"')
  })

  it("shows worker crashes rather than a blank tile", () => {
    expect(tileSource).toContain("worker?.lastError")
    expect(tileSource).toContain("worker.restarts")
  })
})

describe("Preview tile — surface isolation reaches the descriptor", () => {
  it("asks for a preview session and identifies itself as one", () => {
    expect(tileSource).toContain('kind: "devAppPreview"')
    expect(tileSource).toContain('storageScope: "devAppPreview"')
    expect(tileSource).toContain("devSourceId: sourceId")
  })

  it("loads both framework URLs and confined built output through the shared surface", () => {
    expect(tileSource).toContain('view?.kind === "devServer" || view?.kind === "builtOutput"')
    expect(tileSource).toContain("? view.url : null")
  })

  it("remounts the surface on reload instead of reusing the old build's tab", () => {
    expect(tileSource).toContain("runtimeGeneration: running?.reloadToken ?? 0")
  })
})

describe("Preview tile — registration", () => {
  it("is reachable from the normal workbench command palette", () => {
    expect(commandSource).toContain('id: "workbench.previewDevApp"')
    expect(commandSource).toContain('title: "Select cozea-devapp.json"')
    expect(commandSource).toContain('"devAppPreview"')
    expect(commandSource).toContain("devAppPreviewRelativePath: relativePath")
    expect(commandHostSource).toContain("projectRootPath: props.projectRootPath")
    expect(workbenchSurfaceSource).toContain("projectRootPath={projectRootPath}")
  })

  it("is registered as a dock component", () => {
    expect(panelsSource).toContain("devAppPreview: DevAppPreviewPanel")
    expect(getDockComponentName("devAppPreview")).toBe("devAppPreview")
    expect(getPanelRendererForTile("devAppPreview")).toBe("always")
    expect(getPanelConstraintsForTile("devAppPreview")).toEqual({
      minimumWidth: 320,
      minimumHeight: 220,
    })
    expect(resolveTabGroupPreset("devAppPreview")).toEqual({
      label: "Preview",
      color: "preview",
    })
  })

  it("uses the browser-backed Dockview policies", () => {
    expect(dockviewCanvasSource).toMatch(/type === "devAppPreview"/)
    expect(dockviewRuntimeSource).toMatch(/tile\?\.type === "devAppPreview"/)
  })

  it("is lazily loaded like every other tile", () => {
    expect(panelsSource).toContain("lazy(loadWorkbenchDevAppPreviewTile)")
  })

  it("closes the preview when the tile unmounts", () => {
    expect(tileSource).toContain("preview.close({ sourceId: opened })")
  })
})

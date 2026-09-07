import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
const root = path.resolve(__dirname, "../..")
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("generation-3 collaboration ownership", () => {
  it("registers main ownership and preload", () => {
    const main = read("apps/desktop/electron/main.ts"); const preload = read("apps/desktop/electron/preload.ts")
    expect(main).toContain("registerCollaborationHandlers(ipcMain, app.getPath('userData'))")
    expect(main).toContain("shutdownCollaboration()")
    expect(preload).toContain("collaboration: collaborationBridge")
  })
  it("does not infer live collaboration from a Git branch", () => {
    const layout = read("apps/desktop/src/features/projects/layouts/ProjectLayout.tsx")
    expect(layout).not.toContain("activeBranch === collabBranch")
    expect(layout).toContain("activeCollaborationBinding")
    expect(layout).toContain("session:${activeCollaborationBinding.sessionId}")
  })
  it("keeps legacy renderer transport local-only", () => {
    expect(read("apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx")).toContain("const sharedCollaborationEnabled = false")
  })
  it("registers the full generation-3 gateway", () => {
    const worker = read("cloudflare/worker/src/index.ts")
    for (const route of ["/collab/v2/control", "/collab/v2/keys", "/collab/v2/checkpoint", "/collab/v2/workspace-context", "/collab/repository/resolve"]) expect(worker).toContain(route)
  })
})

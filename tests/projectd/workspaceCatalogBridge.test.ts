import { describe, expect, it, vi } from "vitest"
import type { WorkspaceCatalogSnapshot } from "../../shared/workspaceTypes"
import type { ProjectdWorkspaceRecord, ProjectdWorkspaceRegistration } from "../../shared/projectdWorkspaceTypes"
import { WorkspaceCatalogBridge } from "../../apps/desktop/electron/projectd/WorkspaceCatalogBridge"

function snapshot(revision = 1, folder = "/source"): WorkspaceCatalogSnapshot {
  return { revision, generatedAt: revision, entries: {
    project: { projectId: "project", status: "ready", reason: null, collaborationScopeId: "project:project", lane: null, runtimeIdentity: null, workspace: {
      workspaceId: "workspace", projectId: "project", label: null, displayPath: folder,
      rootPath: folder, projectRootPath: folder, projectRootRelativePath: ".", gitRootPath: null, gitOriginUrl: null, gitRepoIdentity: null,
      verificationStatus: "verified", verificationReason: null, verifiedAt: revision, source: "import", storageOwnership: "attached", managedRootId: null,
      markerPolicy: "none", isActive: true, workspaceRevision: revision, createdAt: 1, updatedAt: revision, lastOpenedAt: revision,
    } },
  } }
}
function registered(request: ProjectdWorkspaceRegistration): ProjectdWorkspaceRecord {
  return { ...request, projectRootPath: request.projectRootPath!, projectRootRelativePath: request.projectRootRelativePath!,
    gitRootPath: request.gitRootPath ?? null, gitOriginUrl: request.gitOriginUrl ?? null, source: request.source!,
    storageOwnership: request.storageOwnership!, managedRootId: request.managedRootId ?? null, markerPolicy: request.markerPolicy!,
    workspaceRevision: request.workspaceRevision!, isActive: true, createdAt: 1, updatedAt: 1, lastOpenedAt: 1,
  }
}

describe("verified catalog push to projectd", () => {
  it("registers once, ignores timestamps, and retries unchanged bindings for a new daemon", async () => {
    const register = vi.fn(async (request: ProjectdWorkspaceRegistration) => registered(request))
    const bridge = new WorkspaceCatalogBridge({ register, onError: vi.fn() })
    await bridge.enqueue(snapshot())
    await bridge.enqueue({ ...snapshot(), generatedAt: 100 })
    expect(register).toHaveBeenCalledTimes(1)
    bridge.resetAcknowledgments()
    await bridge.enqueue(snapshot())
    expect(register).toHaveBeenCalledTimes(2)
  })

  it("converges a newer queued repair and ignores an older snapshot", async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const register = vi.fn(async (request: ProjectdWorkspaceRegistration) => { if (request.workspaceRevision === 1) await gate; return registered(request) })
    const bridge = new WorkspaceCatalogBridge({ register, onError: vi.fn() })
    const first = bridge.enqueue(snapshot())
    const next = bridge.enqueue(snapshot(2, "/moved"))
    release!()
    await Promise.all([first, next])
    await bridge.enqueue(snapshot())
    expect(register.mock.calls.map(([request]) => request.rootPath)).toEqual(["/source", "/moved"])
  })

  it("retains failures for retry and rejects mismatched daemon receipts", async () => {
    const onError = vi.fn()
    const register = vi.fn(async (request: ProjectdWorkspaceRegistration) => registered(request))
    register.mockRejectedValueOnce(new Error("Daemon absent"))
    register.mockImplementationOnce(async (request) => ({ ...registered(request), rootPath: "/stale" }))
    const bridge = new WorkspaceCatalogBridge({ register, onError })
    await bridge.enqueue(snapshot()); await bridge.enqueue(snapshot()); await bridge.enqueue(snapshot())
    expect(register).toHaveBeenCalledTimes(3)
    expect(onError.mock.calls.map(([, message]) => message)).toEqual(["Daemon absent", "Daemon registration did not match the current catalog binding"])
  })

  it("does not register an unverified path or delete omitted headless session state", async () => {
    const register = vi.fn(async (request: ProjectdWorkspaceRegistration) => registered(request))
    const bridge = new WorkspaceCatalogBridge({ register, onError: vi.fn() })
    const unverified = snapshot()
    unverified.entries.project.workspace.verificationStatus = "missing"
    await bridge.enqueue(unverified)
    await bridge.enqueue({ revision: 2, generatedAt: 2, entries: {} })
    expect(register).not.toHaveBeenCalled()
    bridge.stop()
    await bridge.enqueue(snapshot(3))
    expect(register).not.toHaveBeenCalled()
  })
})

import { describe, expect, it } from "vitest"
import type { WorkspaceCatalogSnapshotEntry } from "../../shared/workspaceTypes"
import { workspaceSnapshotBindingChanged } from "../../apps/desktop/src/features/workspace/catalogSnapshotComparison"

function entry(): WorkspaceCatalogSnapshotEntry {
  return {
    projectId: "project_one", status: "ready", reason: null, lane: null, runtimeIdentity: null,
    collaborationScopeId: "project:project_one",
    workspace: {
      projectId: "project_one", workspaceId: "workspace_one", workspaceRevision: 1,
      label: null, displayPath: "~/project", rootPath: "/home/project", projectRootPath: "/home/project",
      projectRootRelativePath: ".", gitRootPath: null, gitOriginUrl: null, gitRepoIdentity: null,
      verificationStatus: "verified", verificationReason: null, verifiedAt: 1,
      source: "import", storageOwnership: "attached", managedRootId: null, markerPolicy: "none",
      isActive: true, createdAt: 1, updatedAt: 1, lastOpenedAt: 1,
    },
  }
}

describe("catalog snapshot binding changes", () => {
  it("keeps a resolved workspace when a project metadata push or timestamp refresh arrives", () => {
    const previous = entry()
    const next = structuredClone(previous)
    next.workspace.verifiedAt = 100
    next.workspace.updatedAt = 100
    next.workspace.lastOpenedAt = 100
    expect(workspaceSnapshotBindingChanged(previous, next)).toBe(false)
  })

  it("invalidates for relinking, binding revision or verification failure", () => {
    const previous = entry()
    const revision = structuredClone(previous)
    revision.workspace.workspaceRevision += 1
    expect(workspaceSnapshotBindingChanged(previous, revision)).toBe(true)
    const moved = structuredClone(previous)
    moved.workspace.projectRootPath = "/home/moved-project"
    expect(workspaceSnapshotBindingChanged(previous, moved)).toBe(true)
    const broken = structuredClone(previous)
    broken.status = "broken"
    broken.workspace.verificationStatus = "missing"
    broken.reason = "missing"
    expect(workspaceSnapshotBindingChanged(previous, broken)).toBe(true)
  })

  it("invalidates both adding and forgetting an active binding", () => {
    expect(workspaceSnapshotBindingChanged(undefined, entry())).toBe(true)
    expect(workspaceSnapshotBindingChanged(entry(), undefined)).toBe(true)
    expect(workspaceSnapshotBindingChanged(undefined, undefined)).toBe(false)
  })
})

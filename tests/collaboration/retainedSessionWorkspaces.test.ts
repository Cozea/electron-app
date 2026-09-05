import { describe, expect, it, vi } from "vitest"
import { listRetainedCollaborationWorkspaces } from "../../shared/collaborationRetainedWorkspaces"
import type { SessionWorkspaceBinding } from "../../shared/collaborationDesktop"
const binding = (state: SessionWorkspaceBinding["state"], id = "session"): SessionWorkspaceBinding => ({ generation: 3, sessionId: id,
  projectId: "project", repositoryId: "github:1", workspaceId: `workspace-${id}`, sourceWorkspaceId: "ordinary", sessionBranch: `cozea/collab/${id}`,
  baseCommitSha: "a".repeat(40), role: "editor", state, joinedAt: 1 })

describe("retained local session discovery", () => {
  it("discovers left and ended sessions from the local catalog while ordinary and unrelated workspaces stay out", async () => {
    const left = binding("left", "left"), ended = { ...binding("ended", "ended"), joinedAt: 2 }
    const getBinding = vi.fn(async id => id === left.sessionId ? left : ended)
    const policies = new Map([[left.workspaceId, left], [ended.workspaceId, ended]])
    const result = await listRetainedCollaborationWorkspaces("project", {
      listForProject: async () => [{ workspaceId: "ordinary", projectId: "project" }, { workspaceId: "unrelated", projectId: "other" },
        { workspaceId: left.workspaceId, projectId: "project" }, { workspaceId: ended.workspaceId, projectId: "project" }],
      bindingForWorkspace: async id => policies.get(id) ?? null, getBinding,
    })
    expect(result).toEqual([ended, left])
    expect(getBinding).toHaveBeenCalledTimes(2)
  })
  it("rejects stale and forged workspace/session associations before returning actionable rows", async () => {
    const retained = binding("left")
    const api = { listForProject: async () => [{ workspaceId: retained.workspaceId, projectId: "project" }],
      bindingForWorkspace: async () => retained, getBinding: async () => ({ ...retained, workspaceId: "ordinary" }) }
    await expect(listRetainedCollaborationWorkspaces("project", api)).rejects.toThrow("association changed")
    await expect(listRetainedCollaborationWorkspaces("project", { ...api, bindingForWorkspace: async () => ({ ...retained, projectId: "other" }) })).rejects.toThrow("association is invalid")
    await expect(listRetainedCollaborationWorkspaces("project", { ...api, getBinding: async () => null })).rejects.toThrow("association changed")
  })
  it("bounds catalog discovery and does not hide inaccessible associations as an empty result", async () => {
    const bindingForWorkspace = vi.fn(async () => null)
    await expect(listRetainedCollaborationWorkspaces("project", { listForProject: async () => Array.from({ length: 1001 }, (_, id) => ({ workspaceId: String(id), projectId: "project" })),
      bindingForWorkspace, getBinding: async () => null })).rejects.toThrow("too many")
    expect(bindingForWorkspace).not.toHaveBeenCalled()
    await expect(listRetainedCollaborationWorkspaces("project", { listForProject: async () => [{ workspaceId: "unreadable", projectId: "project" }],
      bindingForWorkspace: async () => { throw new Error("Catalog unavailable") }, getBinding: async () => null })).rejects.toThrow("Catalog unavailable")
  })
})

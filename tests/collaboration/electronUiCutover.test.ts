import { describe, expect, it } from "vitest"

import { findWorkspaceSession, resolveCollaborationGate } from "@/features/collaboration/collaborationGate"

describe("P23 collaboration gate", () => {
  it("keeps the shared branch collaborating when no session exists for it", () => {
    expect(resolveCollaborationGate({ activeBranch: "main", sharedBranch: "main", sessions: [] })).toEqual({
      enabled: true,
      reason: "shared-branch",
    })
    // Sessions still loading (or unreadable) behave like none.
    expect(resolveCollaborationGate({ activeBranch: "main", sharedBranch: "main", sessions: undefined }).enabled).toBe(
      true,
    )
  })

  it("keeps other branches local without a session", () => {
    expect(
      resolveCollaborationGate({ activeBranch: "feature/solo", sharedBranch: "main", sessions: [] }),
    ).toEqual({ enabled: false, reason: "private-branch" })
  })

  it("leaves a session's branch to the daemon, on the shared branch too", () => {
    for (const lifecycle of ["ACTIVE", "DORMANT", "PAUSED"]) {
      expect(
        resolveCollaborationGate({
          activeBranch: "main",
          sharedBranch: "main",
          sessions: [{ branchName: "main", lifecycle }],
          sessionsUseDaemon: true,
        }),
      ).toEqual({ enabled: false, reason: "session-daemon" })
    }
    // Branches without a session keep the in-app behaviour.
    expect(
      resolveCollaborationGate({ activeBranch: "main", sharedBranch: "main", sessions: [], sessionsUseDaemon: true }),
    ).toEqual({ enabled: true, reason: "shared-branch" })
  })

  it("with daemon sessions off, lets an active or dormant session turn collaboration on for its branch", () => {
    for (const lifecycle of ["ACTIVE", "DORMANT"]) {
      expect(
        resolveCollaborationGate({
          activeBranch: "feature/experiment",
          sharedBranch: "main",
          sessions: [{ branchName: "feature/experiment", lifecycle }],
        }),
      ).toEqual({ enabled: true, reason: "session-active" })
    }
  })

  it("lets a paused or blocked session turn collaboration off, including on the shared branch", () => {
    for (const lifecycle of ["PAUSING", "PAUSED", "CLOSING", "BLOCKED", "CREATING"]) {
      expect(
        resolveCollaborationGate({
          activeBranch: "main",
          sharedBranch: "main",
          sessions: [{ branchName: "main", lifecycle }],
        }),
      ).toEqual({ enabled: false, reason: "session-inactive" })
    }
  })

  it("ignores closed sessions and sessions on other branches", () => {
    const sessions = [
      { branchName: "main", lifecycle: "CLOSED" },
      { branchName: "feature/other", lifecycle: "ACTIVE" },
    ]
    expect(resolveCollaborationGate({ activeBranch: "main", sharedBranch: "main", sessions }).reason).toBe(
      "shared-branch",
    )
    expect(resolveCollaborationGate({ activeBranch: "feature/solo", sharedBranch: "main", sessions }).enabled).toBe(
      false,
    )
  })
})

describe("P13 session resolution by Workbench identity", () => {
  const sessions = [
    { branchName: "feat/a", lifecycle: "ACTIVE", publicSessionId: "czs_aaaaaaaaaaaaaaaa" },
    { branchName: "feat/b", lifecycle: "DORMANT", publicSessionId: "czs_bbbbbbbbbbbbbbbb" },
    { branchName: "feat/closed", lifecycle: "CLOSED", publicSessionId: "czs_cccccccccccccccc" },
  ]

  it("resolves the session for a Session Workbench regardless of branch", () => {
    expect(findWorkspaceSession(sessions, "ws_collab_czs_aaaaaaaaaaaaaaaa")).toMatchObject({
      branchName: "feat/a",
    })
    expect(findWorkspaceSession(sessions, "ws_collab_czs_bbbbbbbbbbbbbbbb")).toMatchObject({
      branchName: "feat/b",
    })
  })

  it("returns null outside Session Workbenches, for unknown sessions, and closed ones", () => {
    expect(findWorkspaceSession(sessions, "ws_ordinary_123")).toBeNull()
    expect(findWorkspaceSession(sessions, null)).toBeNull()
    expect(findWorkspaceSession(sessions, "ws_collab_czs_missing")).toBeNull()
    expect(findWorkspaceSession(sessions, "ws_collab_czs_cccccccccccccccc")).toBeNull()
    expect(findWorkspaceSession(undefined, "ws_collab_czs_aaaaaaaaaaaaaaaa")).toBeNull()
  })
})

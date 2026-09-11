import { describe, expect, it } from "vitest"

import { resolveCollaborationGate } from "@/features/collaboration/collaborationGate"

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

  it("lets an active or dormant session turn collaboration on for its branch", () => {
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

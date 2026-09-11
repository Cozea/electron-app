import { describe, expect, it } from "vitest"

import { planLiveSessionStart } from "@/features/collaboration/live/liveSessionModel"

/**
 * The Start dialog's preflight (Section 6.1): a session starts on the branch the
 * project's folder has checked out, once per branch, and only in a Git repository.
 */
describe("P14 starting a live session", () => {
  const sessions = [
    { branchName: "feature/dashboard", lifecycle: "ACTIVE" },
    { branchName: "feature/old", lifecycle: "CLOSED" },
  ]

  it("starts on the branch the folder has checked out", () => {
    expect(planLiveSessionStart({ branch: "feature/new", hasGitRepo: true, sessions })).toEqual({
      status: "ready",
      branch: "feature/new",
    })
    // A closed session does not hold its branch.
    expect(planLiveSessionStart({ branch: "feature/old", hasGitRepo: true, sessions }).status).toBe("ready")
  })

  it("refuses a branch that already has a session, and a folder without Git or a branch", () => {
    expect(planLiveSessionStart({ branch: "feature/dashboard", hasGitRepo: true, sessions })).toEqual({
      status: "blocked",
      reason: "feature/dashboard already has a live session. Join it from the session bar.",
    })
    expect(planLiveSessionStart({ branch: "main", hasGitRepo: false, sessions }).status).toBe("blocked")
    expect(planLiveSessionStart({ branch: " ", hasGitRepo: true, sessions }).status).toBe("blocked")
  })

  it("waits for the project's sessions before offering to start", () => {
    expect(planLiveSessionStart({ branch: "main", hasGitRepo: true, sessions: undefined })).toEqual({
      status: "checking",
    })
  })
})

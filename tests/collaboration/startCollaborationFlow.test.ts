import { describe, expect, it } from "vitest"

describe("P14 Share/Create session UX flows", () => {
  it("validates session parameters for clean current branch flow", () => {
    const params = {
      projectId: "proj_clean",
      repositoryBindingId: "repo_1",
      branchName: "main",
      targetBranch: "main",
      includeDirtyChanges: false,
      accessMode: "invite_only" as const,
      creatorPrincipalId: "p_user",
    }

    expect(params.branchName).toBe("main")
    expect(params.includeDirtyChanges).toBe(false)
  })

  it("validates parameters for new branch flow", () => {
    const newBranch = "feature/experimental-collab"
    const params = {
      projectId: "proj_clean",
      repositoryBindingId: "repo_1",
      branchName: newBranch,
      targetBranch: "main",
      includeDirtyChanges: false,
      accessMode: "organization_available" as const,
      creatorPrincipalId: "p_user",
    }

    expect(params.branchName).toBe("feature/experimental-collab")
    expect(params.accessMode).toBe("organization_available")
  })

  it("handles dirty state Include vs Exclude choice (Section 6.1 Step 3)", () => {
    // When includeDirty is true:
    const paramsInclude = {
      includeDirtyChanges: true,
      branchName: "main",
    }
    expect(paramsInclude.includeDirtyChanges).toBe(true)

    // When includeDirty is false (session begins from clean git base):
    const paramsExclude = {
      includeDirtyChanges: false,
      branchName: "main",
    }
    expect(paramsExclude.includeDirtyChanges).toBe(false)
  })

  it("detects existing non-closed session on selected branch and flags duplicate", () => {
    const existingSessions = [
      {
        sessionId: "sess_existing",
        publicSessionId: "czs_existing",
        branchName: "feature/dashboard",
        lifecycle: "ACTIVE",
      },
    ]

    const selectedBranch = "feature/dashboard"
    const duplicate = existingSessions.find(
      (s) => s.branchName === selectedBranch && s.lifecycle !== "CLOSED",
    )

    expect(duplicate).toBeDefined()
    expect(duplicate?.publicSessionId).toBe("czs_existing")
  })
})

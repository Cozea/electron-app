import { describe, expect, it } from "vitest"
import {
  FolderGitIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "@hugeicons/core-free-icons"
import {
  resolveBranchIconPresentation,
  type WorkbenchBranchPrInfo,
} from "@/features/workbench/branch-control/WorkbenchBranchStatusIcon"

describe("resolveBranchIconPresentation", () => {
  it("resolves standard git branch icon when no PR or worktree is active", () => {
    const res = resolveBranchIconPresentation({})
    expect(res.kind).toBe("branch")
    expect(res.icon).toBe(GitBranchIcon)
  })

  it("resolves worktree icon when isWorktree and showWorktreeIcon are true", () => {
    const res = resolveBranchIconPresentation({ isWorktree: true, showWorktreeIcon: true })
    expect(res.kind).toBe("worktree")
    expect(res.icon).toBe(FolderGitIcon)
  })

  it("resolves branch icon when isWorktree is true but showWorktreeIcon is false/omitted", () => {
    const res = resolveBranchIconPresentation({ isWorktree: true })
    expect(res.kind).toBe("branch")
    expect(res.icon).toBe(GitBranchIcon)
  })

  it("resolves open PR presentation", () => {
    const pr: WorkbenchBranchPrInfo = {
      number: 42,
      title: "Add awesome feature",
      state: "open",
    }
    const res = resolveBranchIconPresentation({ pr })
    expect(res.kind).toBe("pr-open")
    expect(res.icon).toBe(GitPullRequestIcon)
    expect(res.colorClassName).toContain("text-success")
    expect(res.label).toBe("Open PR #42: Add awesome feature")
  })

  it("resolves draft PR presentation", () => {
    const pr: WorkbenchBranchPrInfo = {
      number: 43,
      title: "WIP feature",
      state: "open",
      isDraft: true,
    }
    const res = resolveBranchIconPresentation({ pr })
    expect(res.kind).toBe("pr-draft")
    expect(res.icon).toBe(GitPullRequestDraftIcon)
    expect(res.colorClassName).toContain("text-zinc-500")
    expect(res.label).toBe("Draft PR #43: WIP feature")
  })

  it("resolves closed PR presentation", () => {
    const pr: WorkbenchBranchPrInfo = {
      number: 44,
      title: "Abandoned feature",
      state: "closed",
    }
    const res = resolveBranchIconPresentation({ pr })
    expect(res.kind).toBe("pr-closed")
    expect(res.icon).toBe(GitPullRequestClosedIcon)
    expect(res.colorClassName).toContain("text-red-500")
    expect(res.label).toBe("Closed PR #44: Abandoned feature")
  })

  it("resolves merged PR presentation", () => {
    const pr: WorkbenchBranchPrInfo = {
      number: 45,
      title: "Completed feature",
      state: "merged",
    }
    const res = resolveBranchIconPresentation({ pr })
    expect(res.kind).toBe("pr-merged")
    expect(res.icon).toBe(GitMergeIcon)
    expect(res.colorClassName).toContain("text-violet-500")
    expect(res.label).toBe("Merged PR #45: Completed feature")
  })
})

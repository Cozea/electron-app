import { describe, expect, it } from "vitest"

import type { GitStatusResult } from "@cozea/assistant-contracts"

import {
  WORKBENCH_NO_GIT_CHROME_LABEL,
  WORKBENCH_SELECT_BRANCH_LABEL,
  getStatusSummary,
  getWorkspaceGitStatusSummary,
  resolveDisplayedWorkbenchBranch,
  resolveWorkbenchBranchAriaLabel,
  resolveWorkbenchBranchChromeLabel,
  resolveWorkbenchBranchTooltipDetail,
} from "@/features/workbench/branch-control/workbenchBranchDisplay"

function buildGitStatusResult(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    branch: "main",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  }
}

describe("resolveDisplayedWorkbenchBranch", () => {
  it("prefers the active lane branch over git and collab fallbacks", () => {
    expect(
      resolveDisplayedWorkbenchBranch({
        activeLaneBranch: "feature/a",
        currentGitBranch: "main",
        collabBranch: "main",
      }),
    ).toBe("feature/a")
  })

  it("falls back through git branch then collab branch", () => {
    expect(
      resolveDisplayedWorkbenchBranch({
        activeLaneBranch: null,
        currentGitBranch: "develop",
        collabBranch: "main",
      }),
    ).toBe("develop")

    expect(
      resolveDisplayedWorkbenchBranch({
        activeLaneBranch: null,
        currentGitBranch: null,
        collabBranch: "main",
      }),
    ).toBe("main")
  })
})

describe("resolveWorkbenchBranchChromeLabel", () => {
  it('shows "No git" when the workspace is not a repository', () => {
    expect(
      resolveWorkbenchBranchChromeLabel({
        isRepo: false,
        collabBranch: "main",
        activeLaneBranch: "main",
        currentGitBranch: "main",
        gitStatusFresh: true,
      }),
    ).toBe(WORKBENCH_NO_GIT_CHROME_LABEL)
  })

  it("shows the resolved branch when git status is fresh", () => {
    expect(
      resolveWorkbenchBranchChromeLabel({
        isRepo: true,
        collabBranch: "main",
        activeLaneBranch: "feature/x",
        currentGitBranch: "main",
        gitStatusFresh: true,
      }),
    ).toBe("feature/x")
  })

  it("marks an unverified branch with a trailing question mark", () => {
    expect(
      resolveWorkbenchBranchChromeLabel({
        isRepo: true,
        collabBranch: "main",
        activeLaneBranch: "feature/x",
        currentGitBranch: "main",
        gitStatusFresh: false,
      }),
    ).toBe("feature/x?")
  })

  it("does not mark a branch unverified while git status is still loading", () => {
    expect(
      resolveWorkbenchBranchChromeLabel({
        isRepo: true,
        collabBranch: "main",
        activeLaneBranch: "feature/x",
        currentGitBranch: "main",
        gitStatusFresh: false,
        isLoading: true,
      }),
    ).toBe("feature/x")
  })

  it('falls back to "Select branch" when no branch is known yet', () => {
    expect(
      resolveWorkbenchBranchChromeLabel({
        isRepo: null,
        collabBranch: "",
        activeLaneBranch: null,
        currentGitBranch: null,
        gitStatusFresh: false,
      }),
    ).toBe(WORKBENCH_SELECT_BRANCH_LABEL)
  })
})

describe("resolveWorkbenchBranchAriaLabel", () => {
  it("describes a no-git workspace for screen readers", () => {
    expect(
      resolveWorkbenchBranchAriaLabel({
        isRepo: false,
        displayedBranch: "main",
        gitStatusFresh: true,
      }),
    ).toBe("No git repository")
  })

  it("calls out an unverified branch", () => {
    expect(
      resolveWorkbenchBranchAriaLabel({
        isRepo: true,
        displayedBranch: "feature/x",
        gitStatusFresh: false,
      }),
    ).toBe("Current branch: feature/x. Branch unverified.")
  })
})

describe("resolveWorkbenchBranchTooltipDetail", () => {
  it("explains when no git repository is detected", () => {
    expect(
      resolveWorkbenchBranchTooltipDetail({
        isRepo: false,
        gitStatusFresh: true,
      }),
    ).toBe("No git repository detected.")
  })

  it("explains when branch state could not be verified", () => {
    expect(
      resolveWorkbenchBranchTooltipDetail({
        isRepo: true,
        gitStatusFresh: false,
        displayedBranch: "feature/x",
      }),
    ).toBe("Branch unverified — git status could not be confirmed.")
  })
})

describe("getStatusSummary", () => {
  it("returns null when status is unavailable", () => {
    expect(getStatusSummary(null)).toBeNull()
  })

  it("reports up to date when there is nothing to sync or commit", () => {
    expect(getStatusSummary(buildGitStatusResult())).toBe("Up to date")
  })

  it("reports ahead and behind counts with upstream", () => {
    expect(
      getStatusSummary(
        buildGitStatusResult({
          aheadCount: 2,
          behindCount: 1,
          hasUpstream: true,
        }),
      ),
    ).toBe("1 behind · 2 ahead")
  })

  it("annotates ahead/behind with no remote when upstream is missing", () => {
    expect(
      getStatusSummary(
        buildGitStatusResult({
          aheadCount: 3,
          hasUpstream: false,
        }),
      ),
    ).toBe("3 ahead (no remote)")
  })

  it("includes local changes and pull request metadata", () => {
    expect(
      getStatusSummary(
        buildGitStatusResult({
          hasWorkingTreeChanges: true,
          pr: {
            number: 42,
            title: "Feature",
            url: "https://example.com/pr/42",
            baseBranch: "main",
            headBranch: "feature/x",
            state: "open",
          },
        }),
      ),
    ).toBe("PR #42 · local changes")
  })
})

describe("getWorkspaceGitStatusSummary", () => {
  it("returns null for failed or missing IPC status", () => {
    expect(getWorkspaceGitStatusSummary(null)).toBeNull()
    expect(
      getWorkspaceGitStatusSummary({
        success: false,
        isRepo: true,
        error: "boom",
      }),
    ).toBeNull()
  })

  it("reports ahead with upstream from workspace git status IPC", () => {
    expect(
      getWorkspaceGitStatusSummary({
        success: true,
        isRepo: true,
        currentBranch: "main",
        clean: true,
        ahead: 2,
        behind: 0,
        upstreamBranch: "origin/main",
      }),
    ).toBe("2 ahead")
  })

  it("annotates ahead without upstream as having no remote", () => {
    expect(
      getWorkspaceGitStatusSummary({
        success: true,
        isRepo: true,
        currentBranch: "main",
        clean: true,
        ahead: 1,
        behind: 0,
      }),
    ).toBe("1 ahead (no remote)")
  })

  it("includes local changes from workspace git status IPC", () => {
    expect(
      getWorkspaceGitStatusSummary({
        success: true,
        isRepo: true,
        currentBranch: "main",
        clean: false,
        ahead: 0,
        behind: 0,
        upstreamBranch: "origin/main",
      }),
    ).toBe("local changes")
  })
})

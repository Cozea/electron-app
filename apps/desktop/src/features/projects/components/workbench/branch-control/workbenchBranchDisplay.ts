import type { GitStatusResult } from "@cozea/assistant-contracts"

export const WORKBENCH_NO_GIT_CHROME_LABEL = "No git"
export const WORKBENCH_SELECT_BRANCH_LABEL = "Select branch"

export interface ResolveWorkbenchBranchChromeLabelInput {
  isRepo: boolean | null
  collabBranch: string
  activeLaneBranch?: string | null
  currentGitBranch?: string | null
  gitStatusFresh: boolean
  isLoading?: boolean
}

export function resolveDisplayedWorkbenchBranch(input: {
  activeLaneBranch?: string | null
  currentGitBranch?: string | null
  collabBranch: string
}): string | null {
  const activeLaneBranch = input.activeLaneBranch?.trim() || null
  const currentGitBranch = input.currentGitBranch?.trim() || null
  const collabBranch = input.collabBranch.trim() || null
  return activeLaneBranch ?? currentGitBranch ?? collabBranch
}

export function resolveWorkbenchBranchChromeLabel(
  input: ResolveWorkbenchBranchChromeLabelInput,
): string {
  if (input.isRepo === false) {
    return WORKBENCH_NO_GIT_CHROME_LABEL
  }

  const displayedBranch = resolveDisplayedWorkbenchBranch(input)
  const branch = displayedBranch ?? WORKBENCH_SELECT_BRANCH_LABEL

  const branchUnverified =
    !input.gitStatusFresh && !input.isLoading && Boolean(displayedBranch)

  return branchUnverified ? `${branch}?` : branch
}

export function resolveWorkbenchBranchAriaLabel(input: {
  isRepo: boolean | null
  displayedBranch: string | null
  gitStatusFresh: boolean
  isLoading?: boolean
}): string | null {
  if (input.isRepo === false) {
    return "No git repository"
  }

  if (!input.gitStatusFresh && !input.isLoading && Boolean(input.displayedBranch)) {
    return `Current branch: ${input.displayedBranch}. Branch unverified.`
  }

  return null
}

export function resolveWorkbenchBranchTooltipDetail(input: {
  isRepo: boolean | null
  gitStatusFresh: boolean
  isLoading?: boolean
  displayedBranch?: string | null
}): string | null {
  if (input.isRepo === false) {
    return "No git repository detected."
  }

  if (!input.gitStatusFresh && !input.isLoading && Boolean(input.displayedBranch)) {
    return "Branch unverified — git status could not be confirmed."
  }

  return null
}

interface StatusSummaryPartsInput {
  aheadCount: number
  behindCount: number
  hasUpstream: boolean
  hasLocalChanges: boolean
  prNumber?: number | null
}

function formatStatusSummaryParts(input: StatusSummaryPartsInput): string {
  const noRemoteSuffix = input.hasUpstream ? "" : " (no remote)"
  const parts: string[] = []

  if (input.behindCount > 0) {
    parts.push(`${input.behindCount} behind${noRemoteSuffix}`)
  }
  if (input.aheadCount > 0) {
    parts.push(`${input.aheadCount} ahead${noRemoteSuffix}`)
  }
  if (input.prNumber) {
    parts.push(`PR #${input.prNumber}`)
  }
  if (input.hasLocalChanges) {
    parts.push("local changes")
  }

  return parts.length > 0 ? parts.join(" · ") : "Up to date"
}

export function getStatusSummary(status: GitStatusResult | null): string | null {
  if (!status) {
    return null
  }

  return formatStatusSummaryParts({
    aheadCount: status.aheadCount,
    behindCount: status.behindCount,
    hasUpstream: status.hasUpstream,
    hasLocalChanges: status.hasWorkingTreeChanges,
    prNumber: status.pr?.number ?? null,
  })
}

export type WorkspaceGitStatus = Awaited<
  ReturnType<typeof window.electronAPI.workspaceSync.gitStatus>
>

export function getWorkspaceGitStatusSummary(
  status: WorkspaceGitStatus | null,
): string | null {
  if (!status || !status.success) {
    return null
  }

  return formatStatusSummaryParts({
    aheadCount: status.ahead ?? 0,
    behindCount: status.behind ?? 0,
    hasUpstream: Boolean(status.upstreamBranch),
    hasLocalChanges: status.clean === false,
  })
}

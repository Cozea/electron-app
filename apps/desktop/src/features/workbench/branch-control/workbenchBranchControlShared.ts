import type {
  ContextMenuItem,
  GitBranch as NativeGitBranch,
  GitStatusResult,
} from "@cozea/assistant-contracts"

import { getStatusSummary } from "@/features/projects/components/workbench/branch-control/workbenchBranchDisplay"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons"
import { deriveLocalBranchNameFromRemoteRef } from "@/lib/git/projectBranchToolbar"
import type { ProjectLaneDescriptor } from "@shared/electronApiTypes"

export { getStatusSummary } from "@/features/projects/components/workbench/branch-control/workbenchBranchDisplay"

export type LaneAction =
  | "pull"
  | "push"
  | "updateFromCollab"
  | "mergeIntoCollab"
  | "openPullRequest"

export const WB_BRANCH_MENU = {
  switchCollab: "workbench-branch:switch-collab",
  newPersonalLane: "workbench-branch:new-personal-lane",
  pull: "workbench-branch:pull",
  push: "workbench-branch:push",
  updateFromCollab: "workbench-branch:update-from-collab",
  mergeIntoCollab: "workbench-branch:merge-into-collab",
  openPr: "workbench-branch:open-pr",
  lane: (laneId: string) => `workbench-branch:lane#${encodeURIComponent(laneId)}`,
  branch: (index: number) => `workbench-branch:branch#${index}`,
} as const

export interface GitToolbarSnapshot {
  isRepo: boolean
  branches: NativeGitBranch[]
  currentGitBranch: string | null
  gitStatus: GitStatusResult | null
  loadError: string | null
}

export function parseWorkbenchBranchMenuLaneId(action: string): string | null {
  const prefix = "workbench-branch:lane#"
  if (!action.startsWith(prefix)) return null
  try {
    return decodeURIComponent(action.slice(prefix.length))
  } catch {
    return null
  }
}

export function parseWorkbenchBranchMenuBranchIndex(action: string): number | null {
  const prefix = "workbench-branch:branch#"
  if (!action.startsWith(prefix)) return null
  const index = Number.parseInt(action.slice(prefix.length), 10)
  return Number.isFinite(index) ? index : null
}

export async function showWorkbenchBranchNativeMenu(
  position: { x: number; y: number },
  items: readonly ContextMenuItem<string>[],
): Promise<string | null> {
  return showDesktopContextMenu(items, position)
}

export function buildWorkbenchBranchMenuItems(input: {
  snapshot: GitToolbarSnapshot
  activeLane: ProjectLaneDescriptor | null
  collabBranch: string
  workspaceId: string | null
  rememberedPersonalLanes: ProjectLaneDescriptor[]
  laneActionsLocked: boolean
  newLaneDisabled: boolean
  priorPanelError?: string | null
}): ContextMenuItem<string>[] {
  const {
    snapshot,
    activeLane,
    collabBranch,
    workspaceId,
    rememberedPersonalLanes,
    laneActionsLocked,
    newLaneDisabled,
    priorPanelError,
  } = input

  const footerMessage = snapshot.loadError ?? priorPanelError ?? null

  const displayedBranch = activeLane?.branch ?? snapshot.currentGitBranch ?? collabBranch
  const chromeLabel = displayedBranch || "Select branch"
  const actionLabel =
    activeLane?.isCollab === false && chromeLabel !== collabBranch
      ? `Target ${collabBranch}`
      : "Collab lane"
  const statusSummary = getStatusSummary(snapshot.gitStatus)
  const laneKind = activeLane?.isCollab ? "Collab Lane" : "Personal Lane"

  const items: ContextMenuItem<string>[] = [
    {
      id: "workbench-branch:header-kind",
      label: laneKind,
      enabled: false,
    },
    {
      id: "workbench-branch:header-status",
      label: actionLabel,
      sublabel: statusSummary ?? undefined,
      enabled: false,
    },
    { id: "workbench-branch:sep-after-header", type: "separator" },
  ]

  if (!snapshot.isRepo) {
    items.push({
      id: "workbench-branch:no-repo",
      label: workspaceId ? "No git repository detected." : "Local project path is not ready yet.",
      enabled: false,
    })
    if (footerMessage) {
      items.push({ id: "workbench-branch:sep-err", type: "separator" })
      items.push({
        id: "workbench-branch:last-error",
        label: footerMessage,
        enabled: false,
      })
    }
    return items
  }

  if (!activeLane?.isCollab) {
    items.push({
      id: WB_BRANCH_MENU.switchCollab,
      label: "Switch To Collab Lane",
      icon: getNativeMenuIcon("branch"),
    })
  }

  for (const lane of rememberedPersonalLanes) {
    items.push({
      id: WB_BRANCH_MENU.lane(lane.id),
      label: lane.branch,
      icon: getNativeMenuIcon("branch"),
    })
  }

  items.push({
    id: WB_BRANCH_MENU.newPersonalLane,
    label: "New Personal Lane",
    enabled: !newLaneDisabled,
    icon: getNativeMenuIcon("plus"),
  })

  const showLaneActionSeparator =
    rememberedPersonalLanes.length > 0 || !activeLane?.isCollab
  if (showLaneActionSeparator) {
    items.push({ id: "workbench-branch:sep-lane-actions", type: "separator" })
  }

  items.push(
    {
      id: WB_BRANCH_MENU.pull,
      label: "Pull Active Lane",
      enabled: !laneActionsLocked,
      icon: getNativeMenuIcon("sync"),
    },
    {
      id: WB_BRANCH_MENU.push,
      label: "Push Active Lane",
      enabled: !laneActionsLocked,
      icon: getNativeMenuIcon("move-up"),
    },
  )

  if (!activeLane?.isCollab && chromeLabel !== collabBranch) {
    items.push({
      id: WB_BRANCH_MENU.updateFromCollab,
      label: "Merge Collab Into Lane",
      enabled: !laneActionsLocked,
      icon: getNativeMenuIcon("git-fork"),
    })
  }

  if (!activeLane?.isCollab) {
    items.push({
      id: WB_BRANCH_MENU.mergeIntoCollab,
      label: "Merge Lane Into Collab",
      enabled: !laneActionsLocked,
      icon: getNativeMenuIcon("git-fork"),
    })
    items.push({
      id: WB_BRANCH_MENU.openPr,
      label: snapshot.gitStatus?.pr?.url ? "Open Current PR" : "Start Pull Request",
      enabled: !laneActionsLocked,
      icon: getNativeMenuIcon("git-fork"),
    })
  }

  items.push({ id: "workbench-branch:sep-branches", type: "separator" })
  items.push({
    id: "workbench-branch:branches-label",
    label: "Branches",
    enabled: false,
  })

  if (snapshot.branches.length === 0) {
    items.push({
      id: "workbench-branch:no-branches",
      label: "No branches available.",
      enabled: false,
    })
  } else {
    for (let i = 0; i < snapshot.branches.length; i += 1) {
      const branch = snapshot.branches[i]!
      const nextBranchName = branch.isRemote
        ? deriveLocalBranchNameFromRemoteRef(branch.name)
        : branch.name
      const isActive = nextBranchName === chromeLabel
      const isCollabTarget = nextBranchName === collabBranch
      const worktreeExtra =
        branch.worktreePath && branch.worktreePath !== workspaceId ? " (worktree)" : ""
      const collabExtra = isCollabTarget ? " · collab" : ""
      items.push({
        id: WB_BRANCH_MENU.branch(i),
        type: "radio",
        label: `${branch.name}${collabExtra}${worktreeExtra}`,
        checked: isActive,
        icon: getNativeMenuIcon("branch"),
      })
    }
  }

  if (footerMessage) {
    items.push({ id: "workbench-branch:sep-footer-err", type: "separator" })
    items.push({
      id: "workbench-branch:footer-error",
      label: footerMessage,
      enabled: false,
    })
  }

  return items
}

export function buildLaneId(branch: string): string {
  const sanitized = branch
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `lane:${sanitized || "branch"}`
}

export function toToolbarGitStatus(
  status: Awaited<ReturnType<typeof window.electronAPI.workspaceSync.gitStatus>>,
): GitStatusResult | null {
  if (!status.success || !status.isRepo) {
    return null
  }

  return {
    branch: status.currentBranch ?? null,
    hasWorkingTreeChanges: !status.clean,
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
    hasUpstream: Boolean(status.upstreamBranch),
    aheadCount: status.ahead ?? 0,
    behindCount: status.behind ?? 0,
    pr: null,
  }
}

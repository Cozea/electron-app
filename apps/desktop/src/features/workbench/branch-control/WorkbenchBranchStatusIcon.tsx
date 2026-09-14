import { HugeiconsIcon } from "@hugeicons/react"
import {
  FolderGitIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

export type PullRequestState = "open" | "closed" | "merged"

export interface WorkbenchBranchPrInfo {
  number: number
  title?: string
  url?: string
  state: PullRequestState
  isDraft?: boolean
}

export interface WorkbenchBranchStatusIconProps {
  pr?: WorkbenchBranchPrInfo | null
  isWorktree?: boolean
  showWorktreeIcon?: boolean
  className?: string
}

export function resolveBranchIconPresentation(input: {
  pr?: WorkbenchBranchPrInfo | null
  isWorktree?: boolean
  showWorktreeIcon?: boolean
}) {
  if (input.pr) {
    const { state, isDraft, number, title } = input.pr
    const titleSuffix = title ? `: ${title}` : ""
    if (state === "merged") {
      return {
        icon: GitMergeIcon,
        colorClassName: "text-violet-500 dark:text-violet-400",
        label: `Merged PR #${number}${titleSuffix}`,
        kind: "pr-merged" as const,
      }
    }
    if (state === "closed") {
      return {
        icon: GitPullRequestClosedIcon,
        colorClassName: "text-red-500 dark:text-red-400",
        label: `Closed PR #${number}${titleSuffix}`,
        kind: "pr-closed" as const,
      }
    }
    if (isDraft) {
      return {
        icon: GitPullRequestDraftIcon,
        colorClassName: "text-zinc-500 dark:text-zinc-400",
        label: `Draft PR #${number}${titleSuffix}`,
        kind: "pr-draft" as const,
      }
    }
    return {
      icon: GitPullRequestIcon,
      colorClassName: "text-emerald-500 dark:text-emerald-400",
      label: `Open PR #${number}${titleSuffix}`,
      kind: "pr-open" as const,
    }
  }

  if (input.isWorktree && input.showWorktreeIcon) {
    return {
      icon: FolderGitIcon,
      colorClassName: "text-muted-foreground/80",
      label: "Worktree",
      kind: "worktree" as const,
    }
  }

  return {
    icon: GitBranchIcon,
    colorClassName: "text-muted-foreground/80",
    label: "Branch",
    kind: "branch" as const,
  }
}

export function WorkbenchBranchStatusIcon({
  pr,
  isWorktree,
  showWorktreeIcon,
  className,
}: WorkbenchBranchStatusIconProps) {
  const presentation = resolveBranchIconPresentation({ pr, isWorktree, showWorktreeIcon })
  return (
    <HugeiconsIcon
      icon={presentation.icon}
      className={cn("size-3.5 shrink-0", presentation.colorClassName, className)}
      aria-hidden="true"
    />
  )
}

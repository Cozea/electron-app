import { ArrowPathIcon as Loader2, ChevronDownIcon as ChevronDown } from "@heroicons/react/24/outline"
import type { Id } from "../../../../../convex/_generated/dataModel"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProjectGitRuntimeProjectLike } from "@/lib/git/projectGitRuntime"
import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"
import { useWorkbenchBranchControl } from "@/features/projects/components/workbench/branch-control/useWorkbenchBranchControl"

interface WorkbenchHeaderBranchControlProps {
  project: ProjectGitRuntimeProjectLike | null
  projectId: string | null
  projectPath: string | null
  collabBranch: string
  laneState: ProjectLaneState | null
  activeLane: ProjectLaneDescriptor | null
  userId?: Id<"users"> | null
  onLaneStateChange?: () => void
  triggerClassName?: string
}

export function WorkbenchHeaderBranchControl({
  project,
  projectId,
  projectPath,
  collabBranch,
  laneState,
  activeLane,
  userId,
  onLaneStateChange,
  triggerClassName,
}: WorkbenchHeaderBranchControlProps) {
  const {
    branchCwd,
    chromeLabel,
    isBusy,
    showActionSpinner,
    handleOpenNativeBranchMenu,
  } = useWorkbenchBranchControl({
    project,
    projectId,
    projectPath,
    collabBranch,
    laneState,
    activeLane,
    userId,
    onLaneStateChange,
  })

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "group h-6 gap-1 rounded-md border-0 bg-transparent px-1.5 text-[11px] font-medium text-muted-foreground shadow-none hover:bg-muted/60",
        triggerClassName,
      )}
      disabled={!branchCwd}
      aria-busy={isBusy}
      aria-haspopup="menu"
      onClick={handleOpenNativeBranchMenu}
    >
      {showActionSpinner ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      <span className="max-w-[160px] truncate leading-none">{chromeLabel}</span>
      <ChevronDown className="hidden h-3 w-3 opacity-70 group-hover:block group-focus-visible:block" />
    </Button>
  )
}

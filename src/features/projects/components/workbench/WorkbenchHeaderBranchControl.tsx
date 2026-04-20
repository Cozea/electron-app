

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"
import { useWorkbenchBranchControl } from "@/features/projects/components/workbench/branch-control/useWorkbenchBranchControl"

import { HugeiconsIcon } from '@hugeicons/react'
import { ChevronDoubleCloseIcon as __ChevronDownHugeIcon, Refresh01Icon as __Loader2HugeIcon } from '@hugeicons/core-free-icons'

interface WorkbenchHeaderBranchControlProps {
  projectId: string | null
  projectPath: string | null
  collabBranch: string
  laneState: ProjectLaneState | null
  activeLane: ProjectLaneDescriptor | null
  onLaneStateChange?: () => void
  triggerClassName?: string
}

export function WorkbenchHeaderBranchControl({
  projectId,
  projectPath,
  collabBranch,
  laneState,
  activeLane,
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
    projectId,
    projectPath,
    collabBranch,
    laneState,
    activeLane,
    onLaneStateChange,
  })

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "group h-6 gap-1 rounded-md border-0 bg-transparent px-1.5 text-[10px] font-medium text-muted-foreground shadow-none hover:bg-muted/60",
        triggerClassName,
      )}
      disabled={!branchCwd}
      aria-busy={isBusy}
      aria-haspopup="menu"
      onClick={handleOpenNativeBranchMenu}
    >
      {showActionSpinner ? <HugeiconsIcon icon={__Loader2HugeIcon} className="h-3 w-3 animate-spin" /> : null}
      <span className="max-w-[160px] truncate leading-none">{chromeLabel}</span>
      <HugeiconsIcon icon={__ChevronDownHugeIcon} className="hidden h-3 w-3 opacity-70 group-hover:block group-focus-visible:block" />
    </Button>
  )
}


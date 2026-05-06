import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"
import { useWorkbenchBranchControl } from "@/features/projects/components/workbench/branch-control/useWorkbenchBranchControl"

interface WorkbenchHeaderBranchControlProps {
  projectId: string | null
  workspaceId: string | null
  collabBranch: string
  laneState: ProjectLaneState | null
  activeLane: ProjectLaneDescriptor | null
  onLaneStateChange?: () => void
  triggerClassName?: string
  /** Rendered inside the branch button after the label; pointer-events disabled so the control stays one hit target. */
  trailing?: ReactNode
}

export function WorkbenchHeaderBranchControl({
  projectId,
  workspaceId,
  collabBranch,
  laneState,
  activeLane,
  onLaneStateChange,
  triggerClassName,
  trailing,
}: WorkbenchHeaderBranchControlProps) {
  const {
    branchCwd,
    chromeLabel,
    isBusy,
    showActionSpinner,
    handleOpenNativeBranchMenu,
  } = useWorkbenchBranchControl({
    projectId,
    workspaceId,
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
        "h-6 gap-0.5 rounded-md border-0 bg-transparent px-1.5 text-[10px] font-medium text-muted-foreground shadow-none hover:bg-muted/60",
        triggerClassName,
      )}
      disabled={!branchCwd}
      aria-busy={isBusy}
      aria-haspopup="menu"
      onClick={handleOpenNativeBranchMenu}
    >
      {showActionSpinner ? <div className="loader text-muted-foreground" /> : null}
      <span className="max-w-[160px] truncate leading-none">{chromeLabel}</span>
      {trailing ? (
        <span className="inline-flex shrink-0 items-center pointer-events-none" aria-hidden="true">
          {trailing}
        </span>
      ) : null}
    </Button>
  )
}


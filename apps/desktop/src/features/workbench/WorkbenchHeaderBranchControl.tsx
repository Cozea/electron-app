import { useCallback, type ReactNode } from "react"
import { Spinner } from "@/components/ui/spinner"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useOptionalProjectRouteContext } from "@/contexts/project/ProjectRouteContext"
import { useWorkspaceIdentity } from "@/contexts/workspace/useWorkspaceIdentity"
import { useWorkbenchBranchControl } from "@/features/workbench/branch-control/useWorkbenchBranchControl"
import { BranchCheckoutConflictDialog } from "@/features/workbench/branch-control/BranchCheckoutConflictDialog"
import { useNavigateTo, useViewTransitionNavigate } from "@/lib/navigation"

import { WorkbenchBranchStatusIcon } from "@/features/workbench/branch-control/WorkbenchBranchStatusIcon"

interface WorkbenchHeaderBranchControlProps {
  triggerClassName?: string
  /** Position of the branch/PR/worktree status icon: "leading" (default) or "trailing". */
  iconPosition?: "leading" | "trailing"
  /** Explicit override to show/hide branch status icon; defaults to true when repo detected. */
  showBranchIcon?: boolean
  /** Rendered inside the branch button after the label; pointer-events disabled so the control stays one hit target. */
  trailing?: ReactNode
}

/**
 * Reads lane/branch state from ProjectRouteContext itself instead of taking
 * it as props: this control lives inside the header element that pages hand
 * to useProjectHeader, and prop-feeding lane state forced that element (and
 * the chrome store, and therefore the whole layout) to be rebuilt on every
 * lane settle step. As a context-reading leaf it just re-renders itself.
 */
export function WorkbenchHeaderBranchControl({
  triggerClassName,
  iconPosition = "leading",
  showBranchIcon,
  trailing,
}: WorkbenchHeaderBranchControlProps) {
  const routeContext = useOptionalProjectRouteContext()
  const { workspaceId } = useWorkspaceIdentity()
  const projectId = routeContext?.project?._id
    ? String(routeContext.project._id)
    : routeContext?.projectIdParam ?? null
  const refreshLaneState = routeContext?.refreshLaneState
  const onLaneStateChange = useCallback(() => {
    void refreshLaneState?.()
  }, [refreshLaneState])

  const {
    branchCwd,
    chromeLabel,
    branchAriaLabel,
    branchTooltipDetail,
    isRepo,
    isWorktree,
    branchPr,
    isBusy,
    showActionSpinner,
    handleOpenNativeBranchMenu,
    branchConflict,
    dismissBranchConflict,
    handleStashAndSwitch,
  } = useWorkbenchBranchControl({
    projectId,
    workspaceId,
    collabBranch: routeContext?.collabBranch ?? "main",
    laneState: routeContext?.laneState ?? null,
    activeLane: routeContext?.activeLane ?? null,
    onLaneStateChange,
  })

  const navigate = useViewTransitionNavigate()

  const navigateTo = useNavigateTo()
  const handleGoToCommit = useCallback(() => {
    dismissBranchConflict()
    if (projectId) {
      navigateTo({ to: "workbench", projectId: projectId, changes: true })
    }
  }, [dismissBranchConflict, navigate, projectId])

  const { t } = useTranslation()
  const ariaLabel =
    branchAriaLabel ?? `${t("workbench.branch.currentBranch")}: ${chromeLabel.replace(/\?$/, "")}`
  const tooltipText =
    branchTooltipDetail ?? `${t("workbench.branch.currentBranch")}: ${chromeLabel.replace(/\?$/, "")}`

  const shouldShowIcon = showBranchIcon ?? isRepo
  const branchIcon = shouldShowIcon ? (
    <WorkbenchBranchStatusIcon
      pr={branchPr}
      isWorktree={isWorktree}
    />
  ) : null

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-sm font-medium text-muted-foreground shadow-none hover:bg-muted/60 transition-[background-color,color,transform] duration-150 active:scale-[0.98]",
              triggerClassName,
            )}
            disabled={!branchCwd}
            aria-busy={isBusy}
            aria-haspopup="menu"
            aria-label={ariaLabel}
            onClick={handleOpenNativeBranchMenu}
          >
            {showActionSpinner ? (
              <Spinner size="xs" className="text-muted-foreground" />
            ) : iconPosition === "leading" ? (
              branchIcon
            ) : null}
            <span className="max-w-[160px] truncate leading-none">{chromeLabel}</span>
            {iconPosition === "trailing" ? branchIcon : null}
            {trailing ? (
              <span className="inline-flex shrink-0 items-center pointer-events-none" aria-hidden="true">
                {trailing}
              </span>
            ) : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltipText}</TooltipContent>
      </Tooltip>

      {branchConflict ? (
        <BranchCheckoutConflictDialog
          conflict={branchConflict}
          onDismiss={dismissBranchConflict}
          onStashAndSwitch={handleStashAndSwitch}
          onGoToCommit={handleGoToCommit}
        />
      ) : null}
    </>
  )
}


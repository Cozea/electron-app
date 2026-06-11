import { useCallback, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useOptionalProjectRouteContext } from "@/features/projects/contexts/ProjectRouteContext"
import { useWorkspaceIdentity } from "@/features/projects/workspaces/useWorkspaceIdentity"
import { useWorkbenchBranchControl } from "@/features/projects/components/workbench/branch-control/useWorkbenchBranchControl"

interface WorkbenchHeaderBranchControlProps {
  triggerClassName?: string
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
    isBusy,
    showActionSpinner,
    handleOpenNativeBranchMenu,
  } = useWorkbenchBranchControl({
    projectId,
    workspaceId,
    collabBranch: routeContext?.collabBranch ?? "main",
    laneState: routeContext?.laneState ?? null,
    activeLane: routeContext?.activeLane ?? null,
    onLaneStateChange,
  })

  const { t } = useTranslation()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
          aria-label={`${t("workbench.branch.currentBranch")}: ${chromeLabel}`}
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
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {t("workbench.branch.currentBranch")}: {chromeLabel}
      </TooltipContent>
    </Tooltip>
  )
}


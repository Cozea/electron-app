import { useCallback, useEffect } from "react";
import { useConvex } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { scheduleTask } from "@/lib/scheduler";
import { useLocation } from "@/lib/router";
import { buildProjectPath } from "@/features/projects/lib/projectRoutes";
import { useOptionalProjectRouteContext } from "@/features/projects/contexts/ProjectRouteContext";
import { getProjectChangesActivityCacheKey } from "@/features/projects/lib/changesQueryCache";
import { useQueryCache } from "@/stores/useQueryCache";
import { useChangesSidebarStore } from "@/stores/useChangesSidebarStore";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGitChangesStore } from "@/stores/useGitChangesStore";

export function HeaderProjectChangesButton({ projectId }: { projectId: Id<"projects"> | null }) {
  const navigate = useViewTransitionNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const convex = useConvex();
  const routeContext = useOptionalProjectRouteContext();
  const workspaceId = routeContext?.activeLane?.workspaceId ?? routeContext?.workspaceId ?? null;
  const projectState = useGitChangesStore((state) => workspaceId ? state.projects[workspaceId] : undefined)
  const diffStats = projectState?.current?.snapshot ?? null;
  const watchGitStatus = useGitChangesStore((state) => state.actions.watchGitStatus);

  useEffect(() => {
    if (!workspaceId) return;
    return watchGitStatus(workspaceId, 'current');
  }, [workspaceId, watchGitStatus]);

  const isSidebarOpen = useChangesSidebarStore((state) => state.isOpen);
  const sidebarActions = useChangesSidebarStore((state) => state.actions);

  const prewarmChanges = useCallback(() => {
    if (!projectId) return;

    const activityCacheKey = getProjectChangesActivityCacheKey(projectId);
    const queryCache = useQueryCache.getState();
    if (queryCache.get(activityCacheKey, 30_000) !== undefined) {
      return;
    }

    void scheduleTask(async () => {
      try {
        const activity = await convex.query(api.activity.getRecentActivity, {
          projectId,
          limit: 100,
        });

        if (activity !== undefined) {
          useQueryCache.getState().set(activityCacheKey, activity);
        }
      } catch {
        // Ignore prewarm failures and let the drawer queries resolve normally.
      }
    }, "background");
  }, [convex, projectId]);

  if (!projectId) return null;

  const hasDisplayableDiff =
    diffStats != null && (diffStats.additions > 0 || diffStats.deletions > 0);
  if (!hasDisplayableDiff) return null;

  const workbenchPath = buildProjectPath(String(projectId), "workbench");
  const isOnWorkbench = pathname === workbenchPath;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={`h-7 sm:h-7 gap-1 shrink-0 rounded-md border border-border/60 px-3 shadow-none hover:bg-muted/40 hover:text-foreground ${isSidebarOpen ? "bg-muted/40 text-foreground" : "bg-transparent text-muted-foreground"}`}
          aria-label={isSidebarOpen ? "Close changes" : "Open changes"}
          onMouseEnter={prewarmChanges}
          onFocus={prewarmChanges}
          onPointerDown={prewarmChanges}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();

            if (!isOnWorkbench) {
              sidebarActions.open();
              navigate(workbenchPath);
              return;
            }

            sidebarActions.toggle();
          }}
        >
          <span className="inline-flex items-center gap-1 text-[9px] tabular-nums">
            <span className="text-success">+{diffStats.additions}</span>
            <span className="text-destructive">-{diffStats.deletions}</span>
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isSidebarOpen ? "Close changes" : "Open changes"}
      </TooltipContent>
    </Tooltip>
  );
}

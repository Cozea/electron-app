import { useCallback, useEffect, useState } from "react";
import { useConvex } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { scheduleTask } from "@/lib/scheduler";
import { useLocation } from "@/lib/router";
import { buildProjectPath } from "@/features/projects/lib/projectRoutes";
import { useOptionalProjectRouteContext } from "@/features/projects/contexts/ProjectRouteContext";
import { projectOpenDesktopClient } from "@/features/projects/lib/projectOpenDesktopClient";
import { getProjectChangesActivityCacheKey } from "@/features/projects/lib/changesQueryCache";
import { useQueryCache } from "@/stores/useQueryCache";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { HugeiconsIcon } from '@hugeicons/react'
import { TransactionHistoryIcon as __TransactionHistoryHugeIcon } from '@hugeicons/core-free-icons'

export function HeaderProjectChangesButton({ projectId }: { projectId: Id<"projects"> | null }) {
  const navigate = useViewTransitionNavigate();
  const location = useLocation();
  const convex = useConvex();
  const routeContext = useOptionalProjectRouteContext();
  const gitCwd = routeContext?.gitCwd ?? null;
  const [diffStats, setDiffStats] = useState<{ additions: number; deletions: number } | null>(null);

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

  useEffect(() => {
    if (!gitCwd) {
      setDiffStats(null);
      return;
    }

    let cancelled = false;

    const loadStats = async () => {
      try {
        const statsResult = await projectOpenDesktopClient.sync.gitGetHeadDiffStats({
          projectPath: gitCwd,
        });
        if (cancelled) return;

        if (statsResult.success) {
          setDiffStats({
            additions: statsResult.additions,
            deletions: statsResult.deletions,
          });
        } else {
          setDiffStats(null);
        }
      } catch {
        if (!cancelled) {
          setDiffStats(null);
        }
      }
    };

    void loadStats();
    const interval = window.setInterval(() => {
      void loadStats();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [gitCwd]);

  if (!projectId) return null;

  const workbenchPath = buildProjectPath(String(projectId), "workbench");
  const currentParams = new URLSearchParams(location.search);
  const isOnWorkbench = location.pathname === workbenchPath;
  const isChangesOpen =
    currentParams.get("changes") === "1" || currentParams.get("openTile") === "changes";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-6 gap-1 shrink-0 rounded-md border border-border/60 bg-transparent px-3 text-muted-foreground shadow-none hover:bg-muted/40 hover:text-foreground"
          aria-label="Open changes"
          onMouseEnter={prewarmChanges}
          onFocus={prewarmChanges}
          onPointerDown={prewarmChanges}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();

            const nextParams = new URLSearchParams(location.search);

            if (isOnWorkbench && isChangesOpen) {
              nextParams.delete("changes");
              nextParams.delete("openTile");
              nextParams.delete("userId");
            } else {
              nextParams.set("changes", "1");
              nextParams.delete("openTile");
            }

            const nextSearch = nextParams.toString();

            navigate({
              pathname: workbenchPath,
              search: nextSearch ? `?${nextSearch}` : "",
            });
          }}
        >
          <HugeiconsIcon icon={__TransactionHistoryHugeIcon} className="size-3 shrink-0" />
          <span className="text-[11px] leading-none">Changes</span>
          {diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) ? (
            <span className="inline-flex items-center gap-1 text-[10px] tabular-nums">
              <span className="text-success">+{diffStats.additions}</span>
              <span className="text-destructive">-{diffStats.deletions}</span>
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Open changes</TooltipContent>
    </Tooltip>
  );
}

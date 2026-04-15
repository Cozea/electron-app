import { useCallback } from "react";
import { useConvex } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { scheduleTask } from "@/lib/scheduler";
import { useLocation } from "@/lib/router";
import { buildProjectPath } from "@/features/projects/lib/projectRoutes";
import {

  getProjectChangesActivityCacheKey,
  getProjectChangesSelectedChangeCacheKey,
} from "@/features/projects/lib/changesQueryCache";
import { useQueryCache } from "@/stores/useQueryCache";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { HugeiconsIcon } from '@hugeicons/react'
import { TransactionHistoryIcon as __TransactionHistoryHugeIcon } from '@hugeicons/core-free-icons'

export function HeaderProjectChangesButton({ projectId }: { projectId: Id<"projects"> | null }) {
  const navigate = useViewTransitionNavigate();
  const location = useLocation();
  const convex = useConvex();

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

        const firstChangeId = activity?.[0]?.id;
        if (!firstChangeId) return;

        const selectedChange = await convex.query(api.activity.getChangeWithContent, {
          changeId: firstChangeId,
        });

        if (selectedChange !== undefined) {
          useQueryCache
            .getState()
            .set(getProjectChangesSelectedChangeCacheKey(firstChangeId), selectedChange);
        }
      } catch {
        // Ignore prewarm failures and let the drawer queries resolve normally.
      }
    }, "background");
  }, [convex, projectId]);

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
          size="icon"
          className="h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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
          <HugeiconsIcon icon={__TransactionHistoryHugeIcon} className="h-3.5 w-3.5 shrink-0" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Open changes</TooltipContent>
    </Tooltip>
  );
}

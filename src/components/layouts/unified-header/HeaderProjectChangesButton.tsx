import { useCallback, useEffect, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";

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
  const clearEphemeralChanges = useMutation(api.activity.clearEphemeralChanges);
  const routeContext = useOptionalProjectRouteContext();
  const projectPath = routeContext?.localPath ?? null;
  const [diffStats, setDiffStats] = useState<{ additions: number; deletions: number } | null>(null);
  const lastGitStatusRef = useRef<{ clean: boolean; headCommit: string | null } | null>(null);
  const cleanupInFlightRef = useRef(false);
  const lastCleanedHeadCommitRef = useRef<string | null>(null);

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
    if (!projectPath) {
      setDiffStats(null);
      lastGitStatusRef.current = null;
      cleanupInFlightRef.current = false;
      lastCleanedHeadCommitRef.current = null;
      return;
    }

    let cancelled = false;

    const loadStats = async () => {
      try {
        const [statsResult, statusResult] = await Promise.all([
          projectOpenDesktopClient.sync.gitGetHeadDiffStats({
            projectPath,
          }),
          projectOpenDesktopClient.sync.gitStatus({
            projectPath,
          }),
        ]);
        if (cancelled) return;

        if (statsResult.success) {
          setDiffStats({
            additions: statsResult.additions,
            deletions: statsResult.deletions,
          });
        } else {
          setDiffStats(null);
        }

        if (!statusResult.success || !statusResult.isRepo) {
          lastGitStatusRef.current = null;
          return;
        }

        const nextStatus = {
          clean: statusResult.clean ?? false,
          headCommit: statusResult.headCommit ?? null,
        };
        const previousStatus = lastGitStatusRef.current;
        lastGitStatusRef.current = nextStatus;

        const shouldClearEphemeralChanges =
          Boolean(projectId) &&
          nextStatus.clean &&
          Boolean(nextStatus.headCommit) &&
          previousStatus?.clean === false &&
          previousStatus.headCommit !== nextStatus.headCommit &&
          lastCleanedHeadCommitRef.current !== nextStatus.headCommit &&
          cleanupInFlightRef.current === false;

        if (!shouldClearEphemeralChanges || !projectId) {
          return;
        }

        cleanupInFlightRef.current = true;
        try {
          await Promise.all([
            clearEphemeralChanges({ projectId }),
            projectOpenDesktopClient.sync.gitDeleteAllCheckpointRefs({
              projectPath,
            }),
          ]);
          lastCleanedHeadCommitRef.current = nextStatus.headCommit;
          useQueryCache.getState().clear(getProjectChangesActivityCacheKey(projectId));
        } catch (error) {
          console.warn("[Changes] Failed to clear ephemeral changes after commit:", error);
        } finally {
          cleanupInFlightRef.current = false;
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
  }, [clearEphemeralChanges, projectId, projectPath]);

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
            <span className="text-[10px] tabular-nums text-muted-foreground/80">
              +{diffStats.additions} -{diffStats.deletions}
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Open changes</TooltipContent>
    </Tooltip>
  );
}

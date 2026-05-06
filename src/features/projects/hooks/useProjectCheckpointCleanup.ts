import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { getProjectChangesActivityCacheKey } from "@/features/projects/lib/changesQueryCache";
import { useQueryCache } from "@/stores/useQueryCache";

export function useProjectCheckpointCleanup(
  projectId: Id<"projects"> | null,
  workspaceId: string | null,
) {
  const clearEphemeralChanges = useMutation(api.activity.clearEphemeralChanges);
  const lastGitStatusRef = useRef<{ clean: boolean; headCommit: string | null } | null>(null);
  const cleanupInFlightRef = useRef(false);
  const lastCleanedHeadCommitRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId || !workspaceId) {
      lastGitStatusRef.current = null;
      cleanupInFlightRef.current = false;
      lastCleanedHeadCommitRef.current = null;
      return;
    }

    let cancelled = false;

    const pollStatus = async () => {
      try {
        const statusResult = await window.electronAPI.workspaceSync.gitStatus({
          workspaceId,
        });
        if (cancelled || !statusResult.success || !statusResult.isRepo) {
          return;
        }

        const nextStatus = {
          clean: statusResult.clean ?? false,
          headCommit: statusResult.headCommit ?? null,
        };
        const previousStatus = lastGitStatusRef.current;
        lastGitStatusRef.current = nextStatus;

        const shouldClearEphemeralChanges =
          nextStatus.clean &&
          Boolean(nextStatus.headCommit) &&
          previousStatus?.clean === false &&
          previousStatus.headCommit !== nextStatus.headCommit &&
          lastCleanedHeadCommitRef.current !== nextStatus.headCommit &&
          cleanupInFlightRef.current === false;

        if (!shouldClearEphemeralChanges) {
          return;
        }

        cleanupInFlightRef.current = true;
        try {
          await Promise.all([
            clearEphemeralChanges({ projectId }),
            window.electronAPI.workspaceSync.gitDeleteAllCheckpointRefs({
              workspaceId,
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
        // Ignore transient git-status failures; the next poll will retry.
      }
    };

    void pollStatus();
    const interval = window.setInterval(() => {
      void pollStatus();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [clearEphemeralChanges, workspaceId, projectId]);
}

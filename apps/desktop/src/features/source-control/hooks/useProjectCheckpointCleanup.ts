import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { getProjectChangesActivityCacheKey } from "@/features/source-control/model/changesQueryCache";
import { useGitDirtySnapshot } from "@/features/source-control/hooks/useGitDirtySnapshot";
import { useQueryCache } from "@/app/model/queryCache";
import {
  shouldClearEphemeralChanges,
  type CheckpointCleanupObservation,
} from "@/features/source-control/model/checkpointCleanupDecision";

/**
 * Clears ephemeral change records once a commit has absorbed them.
 *
 * This used to poll `git status` every two seconds per retained workspace, each
 * poll spawning a subprocess in the main process. It now reads the dirty-state
 * stream the header already subscribes to, which the `.git` watcher drives, so
 * a commit made in a terminal arrives here the same way one made in Cozea does.
 */
export function useProjectCheckpointCleanup(
  projectId: Id<"projects"> | null,
  workspaceId: string | null,
) {
  const clearEphemeralChanges = useMutation(api.activity.clearEphemeralChanges);
  const snapshot = useGitDirtySnapshot(workspaceId);
  const previousRef = useRef<CheckpointCleanupObservation | null>(null);
  const lastCleanedHeadCommitRef = useRef<string | null>(null);
  const cleanupInFlightRef = useRef(false);

  useEffect(() => {
    previousRef.current = null;
    lastCleanedHeadCommitRef.current = null;
    cleanupInFlightRef.current = false;
  }, [projectId, workspaceId]);

  useEffect(() => {
    if (!projectId || !workspaceId || !snapshot) return;

    const observation: CheckpointCleanupObservation = {
      headCommit: snapshot.headCommit ?? null,
      changedFiles: snapshot.changedFiles,
      hasError: Boolean(snapshot.error),
    };
    const previous = previousRef.current;
    previousRef.current = observation;

    const headCommit = observation.headCommit;
    if (cleanupInFlightRef.current || !headCommit) return;
    if (!shouldClearEphemeralChanges(previous, observation, lastCleanedHeadCommitRef.current)) {
      return;
    }

    cleanupInFlightRef.current = true;
    void (async () => {
      try {
        await Promise.all([
          clearEphemeralChanges({ projectId }),
          window.electronAPI.workspaceSync.gitDeleteAllCheckpointRefs({ workspaceId }),
        ]);
        lastCleanedHeadCommitRef.current = headCommit;
        useQueryCache.getState().clear(getProjectChangesActivityCacheKey(projectId));
      } catch (error) {
        console.warn("[Changes] Failed to clear ephemeral changes after commit:", error);
      } finally {
        cleanupInFlightRef.current = false;
      }
    })();
  }, [snapshot, projectId, workspaceId, clearEphemeralChanges]);
}

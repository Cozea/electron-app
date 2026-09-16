/** What the decision below needs from a dirty-state snapshot. */
export interface CheckpointCleanupObservation {
  headCommit: string | null
  changedFiles: number
  hasError: boolean
}

/**
 * Whether a commit just landed and left nothing behind to describe.
 *
 * The ephemeral change records exist to show work that is not committed yet, so
 * once HEAD has moved and the tree is clean they describe a moment that is
 * gone. Requires a previous observation: without one there is no "moved".
 *
 * This deliberately no longer asks whether the tree was seen *dirty* first. The
 * poll it replaced sampled every two seconds and could rely on catching the
 * dirty half; snapshots now arrive on Git activity, and editing in another
 * editor touches no Git state at all, so a commit can land with the last seen
 * snapshot still reading clean. Keying on HEAD alone also means a checkout or
 * pull clears these records, which is right for the same reason.
 */
export function shouldClearEphemeralChanges(
  previous: CheckpointCleanupObservation | null,
  next: CheckpointCleanupObservation,
  lastCleanedHeadCommit: string | null,
): boolean {
  if (next.hasError || !next.headCommit) return false
  if (next.changedFiles !== 0) return false
  if (!previous?.headCommit) return false
  if (previous.headCommit === next.headCommit) return false
  return lastCleanedHeadCommit !== next.headCommit
}

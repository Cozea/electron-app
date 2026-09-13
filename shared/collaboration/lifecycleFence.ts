/** Room-authored proof that durable CRDT state covers the frozen write frontier. */
export interface SessionLifecycleFence {
  fenceId: string
  intent: "pause" | "close"
  sessionSeq: number
  barrierId: string
  keyVersion: number
  requestedByPrincipalId: string
  createdAt: number
  gitSavedThroughSeq: number | null
}

/** Retained retry identity; present only for the manager who initiated paused Close. */
export interface SessionLifecycleState {
  fence: SessionLifecycleFence | null
  pausedClose?: { pauseFenceId: string; phase: "committing" | "committed" }
}

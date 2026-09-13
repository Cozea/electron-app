/**
 * Decides whether the app's in-app live collaboration engine runs for the active branch.
 *
 * Master Specification: Section 4.1, 6.1, Invariants C06, C31
 *
 * A collaboration session record for the branch decides the answer when one exists.
 * Sessions sync through the cozea-projectd daemon (P23), so the in-app engine leaves
 * a session's branch alone. With daemon sessions switched off
 * (VITE_FF_DAEMON_COLLABORATION=0) the in-app engine runs ACTIVE and DORMANT sessions
 * (opening a dormant session is a rejoin), while PAUSING, PAUSED, CLOSING, BLOCKED
 * and CREATING sessions do not collaborate.
 *
 * Without a session record the project's shared branch keeps collaborating in the
 * app, as it did before sessions existed, until P26 retires the in-app engine.
 */

export interface CollaborationSessionSummary {
  readonly branchName: string
  readonly lifecycle: string
}

export type CollaborationGateReason =
  | "session-daemon"
  | "session-active"
  | "session-inactive"
  | "shared-branch"
  | "private-branch"

export interface CollaborationGate {
  readonly enabled: boolean
  readonly reason: CollaborationGateReason
}

/** Workspace id prefix for dedicated Session Workbenches: the session, not the branch, owns the Workbench. */
export const SESSION_WORKSPACE_PREFIX = "ws_collab_"

/** The session record that decides collaboration for a branch, if there is one. */
export function findBranchSession<T extends CollaborationSessionSummary>(
  sessions: readonly T[] | undefined,
  branch: string,
): T | null {
  return sessions?.find((candidate) => candidate.branchName === branch && candidate.lifecycle !== "CLOSED") ?? null
}

export interface WorkbenchSessionSummary extends CollaborationSessionSummary {
  readonly publicSessionId: string
}

/**
 * The session record for the active Workbench, resolved by Workbench identity:
 * workbenchId → workspaceId → collaborationSessionId. The session's branchName
 * is a Git property of the session, never the lookup key. Returns null outside
 * a Session Workbench.
 */
export function findWorkspaceSession<T extends WorkbenchSessionSummary>(
  sessions: readonly T[] | undefined,
  workspaceId: string | null,
): T | null {
  if (!workspaceId || !workspaceId.startsWith(SESSION_WORKSPACE_PREFIX)) return null
  const publicSessionId = workspaceId.slice(SESSION_WORKSPACE_PREFIX.length)
  return sessions?.find((candidate) =>
    candidate.publicSessionId === publicSessionId && candidate.lifecycle !== "CLOSED",
  ) ?? null
}

/**
 * Finds a switchable session strictly by identity. Sessions are never
 * re-identified by branchName here: a closed session keeps its branch name,
 * so a branch lookup could open the wrong record depending on array order.
 * Closed sessions are not switchable.
 */
export function findOpenSessionById<T extends WorkbenchSessionSummary>(
  sessions: readonly T[] | undefined,
  publicSessionId: string,
): T | null {
  return sessions?.find((candidate) =>
    candidate.publicSessionId === publicSessionId && candidate.lifecycle !== "CLOSED",
  ) ?? null
}

export function resolveCollaborationGate(input: {
  activeBranch: string
  sharedBranch: string
  sessions: readonly CollaborationSessionSummary[] | undefined
  workspaceId?: string | null
}): CollaborationGate {
  if (input.workspaceId && input.workspaceId.startsWith(SESSION_WORKSPACE_PREFIX)) {
    // Session Workbenches sync through projectd exclusively (Section 4.1, 23.2).
    // The legacy in-app engine must never take over a Session Workbench, even
    // while the cloud sessions query is still loading.
    return { enabled: false, reason: "session-daemon" }
  }

  const session = findBranchSession(input.sessions, input.activeBranch)

  if (session) {
    // Session branches sync through projectd exclusively (Section 4.1, 23.2).
    // The fallback flag path that previously handed session branches to the
    // legacy in-app engine has been removed.
    return { enabled: false, reason: "session-daemon" }
  }

  return input.activeBranch === input.sharedBranch
    ? { enabled: true, reason: "shared-branch" }
    : { enabled: false, reason: "private-branch" }
}

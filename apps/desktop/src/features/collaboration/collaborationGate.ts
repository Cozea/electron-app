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

const COLLABORATING_SESSION_LIFECYCLES = new Set(["ACTIVE", "DORMANT"])

/** The session record that decides collaboration for a branch, if there is one. */
export function findBranchSession<T extends CollaborationSessionSummary>(
  sessions: readonly T[] | undefined,
  branch: string,
): T | null {
  return sessions?.find((candidate) => candidate.branchName === branch && candidate.lifecycle !== "CLOSED") ?? null
}

export function resolveCollaborationGate(input: {
  activeBranch: string
  sharedBranch: string
  sessions: readonly CollaborationSessionSummary[] | undefined
  /** Sessions sync through the daemon, so the in-app engine leaves their branches alone. */
  sessionsUseDaemon?: boolean
}): CollaborationGate {
  const session = findBranchSession(input.sessions, input.activeBranch)

  if (session) {
    if (input.sessionsUseDaemon) return { enabled: false, reason: "session-daemon" }
    return COLLABORATING_SESSION_LIFECYCLES.has(session.lifecycle)
      ? { enabled: true, reason: "session-active" }
      : { enabled: false, reason: "session-inactive" }
  }

  return input.activeBranch === input.sharedBranch
    ? { enabled: true, reason: "shared-branch" }
    : { enabled: false, reason: "private-branch" }
}

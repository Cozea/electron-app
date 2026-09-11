/**
 * Decides whether the project's live collaboration engine runs for the active branch.
 *
 * Master Specification: Section 4.1, 6.1, Invariants C06, C31
 *
 * A collaboration session record for the branch decides the answer when one exists:
 * ACTIVE and DORMANT sessions collaborate (opening a dormant session is a rejoin),
 * while PAUSING, PAUSED, CLOSING, BLOCKED and CREATING sessions do not.
 *
 * Without a session record the project's shared branch keeps collaborating. That is
 * the behaviour the app shipped before P23, and it stays until the projectd session
 * engine owns collaboration: nothing mounted in the app can create a session yet, so
 * requiring one switched live collaboration off for every project.
 */

export interface CollaborationSessionSummary {
  readonly branchName: string
  readonly lifecycle: string
}

export type CollaborationGateReason =
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
}): CollaborationGate {
  const session = findBranchSession(input.sessions, input.activeBranch)

  if (session) {
    return COLLABORATING_SESSION_LIFECYCLES.has(session.lifecycle)
      ? { enabled: true, reason: "session-active" }
      : { enabled: false, reason: "session-inactive" }
  }

  return input.activeBranch === input.sharedBranch
    ? { enabled: true, reason: "shared-branch" }
    : { enabled: false, reason: "private-branch" }
}

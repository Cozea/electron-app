/**
 * What the session bar and the Start dialog say about a live session.
 *
 * Master Specification: Section 5.3, 6.1, 6.7, 23.2
 * Phase: P14, P23
 */

import type { ProjectdSessionStatus } from "@cozea/projectd-protocol"

import type { DaemonSessionPhase } from "../daemon/useDaemonCollaborationSession"

export type SessionMembership = "active" | "left" | "revoked" | "none"

export type LiveSessionAction = "join" | "leave" | "pause" | "resume" | "end" | "switch"

export interface LiveSessionMember {
  principalId: string
  displayName: string
  role: string
  status: string
  isSelf: boolean
}

export type LiveSessionTone = "live" | "working" | "attention" | "idle"

export interface LiveSessionSyncView {
  tone: LiveSessionTone
  label: string
  detail: string | null
}

/**
 * This device's membership: the session record's own answer when the server sent
 * one, otherwise this device's row in the member list.
 */
export function resolveMembership(
  viewerMembership: string | null | undefined,
  members: readonly LiveSessionMember[] | undefined,
): SessionMembership {
  const status = viewerMembership !== undefined ? viewerMembership : members?.find((member) => member.isSelf)?.status
  return status === "active" || status === "left" || status === "revoked" ? status : "none"
}

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function describeDaemonStatus(status: ProjectdSessionStatus | null): LiveSessionSyncView {
  if (!status) return { tone: "working", label: "Syncing…", detail: null }
  const skipped = status.skippedPaths.length
  const skippedDetail =
    skipped > 0
      ? `${countOf(skipped, "file stays", "files stay")} on this Mac: binary files and files over 512 KB don't sync yet.`
      : null

  switch (status.state) {
    case "live":
      return status.pendingBatches > 0
        ? { tone: "working", label: "Sending changes…", detail: skippedDetail }
        : { tone: "live", label: "Live", detail: skippedDetail }
    case "starting":
    case "syncing":
      return { tone: "working", label: "Syncing…", detail: null }
    case "reconnecting":
      return { tone: "working", label: "Reconnecting…", detail: status.lastError?.message ?? null }
    case "waiting_for_ticket":
      return { tone: "working", label: "Renewing access…", detail: null }
    case "failed":
      return {
        tone: "attention",
        label: "Stopped syncing",
        detail: status.lastError?.message ?? "The background sync service stopped syncing this session.",
      }
    case "stopped":
      return { tone: "idle", label: "Stopped", detail: null }
  }
}

/** How this folder syncs with the session, for the session bar. */
export function describeLiveSessionSync(input: {
  lifecycle: string
  membership: SessionMembership
  /** False when VITE_FF_DAEMON_COLLABORATION=0 hands sessions to the in-app engine. */
  daemonEnabled: boolean
  phase: DaemonSessionPhase
  status: ProjectdSessionStatus | null
  error: string | null
}): LiveSessionSyncView {
  switch (input.lifecycle) {
    case "PAUSING":
    case "PAUSED":
      return {
        tone: "idle",
        label: "Paused",
        detail: "A session manager paused the session. Nothing syncs until it resumes.",
      }
    case "CLOSING":
      return { tone: "idle", label: "Ending", detail: null }
    case "CREATING":
      return { tone: "working", label: "Starting…", detail: null }
    case "BLOCKED":
      return { tone: "attention", label: "Blocked", detail: "The session is blocked and nothing syncs." }
  }

  switch (input.membership) {
    case "revoked":
      return { tone: "idle", label: "Removed", detail: "A session manager removed this device from the session." }
    case "left":
      return { tone: "idle", label: "Not syncing", detail: "You left this session. Rejoin to sync this folder with it." }
    case "none":
      return { tone: "idle", label: "Not joined", detail: "Join to sync this folder with the session." }
  }

  if (!input.daemonEnabled) return { tone: "live", label: "Live", detail: null }

  switch (input.phase) {
    case "off":
      return { tone: "idle", label: "Waiting for the project folder", detail: null }
    case "connecting":
      return { tone: "working", label: "Connecting…", detail: null }
    case "waiting_for_key":
      return {
        tone: "working",
        label: "Waiting for access",
        detail: "A member who is online shares the session key with this device. This retries on its own.",
      }
    case "unavailable":
      return {
        tone: "attention",
        label: "Not syncing",
        detail: input.error
          ? `The background sync service could not take the session: ${input.error}`
          : "The background sync service is not running.",
      }
    case "attached":
      return describeDaemonStatus(input.status)
  }
}

export type LiveSessionStartPlan =
  | { status: "ready"; branch: string }
  | { status: "checking" }
  | { status: "blocked"; reason: string }

/** Whether a live session can start on the branch this folder has checked out (Section 6.1). */
export function planLiveSessionStart(input: {
  branch: string | null | undefined
  hasGitRepo: boolean
  sessions: readonly { branchName: string; lifecycle: string }[] | undefined
}): LiveSessionStartPlan {
  if (!input.hasGitRepo) {
    return {
      status: "blocked",
      reason: "Live sessions follow a Git branch, and this project's folder is not a Git repository.",
    }
  }
  const branch = input.branch?.trim()
  if (!branch) return { status: "blocked", reason: "Check out a branch in this project's folder first." }
  if (input.sessions === undefined) return { status: "checking" }
  if (input.sessions.some((session) => session.branchName === branch && session.lifecycle !== "CLOSED")) {
    return { status: "blocked", reason: `${branch} already has a live session. Join it from the session bar.` }
  }
  return { status: "ready", branch }
}

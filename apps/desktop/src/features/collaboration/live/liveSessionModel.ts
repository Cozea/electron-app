/**
 * What the session bar and the Start dialog say about a live session.
 *
 * Master Specification: Section 5.3, 6.1, 6.7, 23.2
 * Phase: P14, P23
 */

import type { ProjectdSessionStatus, ProjectdTargetStatus } from "@cozea/projectd-protocol"

import type { DaemonSessionPhase } from "../daemon/useDaemonCollaborationSession"

export type SessionMembership = "active" | "left" | "revoked" | "none"

export type LiveSessionAction =
  | "join"
  | "leave"
  | "pause"
  | "resume"
  | "end"
  | "switch"
  | "save"
  | "ignore_env"
  | "check_target"

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
      ? `${countOf(skipped, "file stays", "files stay")} outside synchronization on this Mac.`
      : null

  const pendingBinaries = status.pendingBinaryVersions > 0
    ? `${countOf(status.pendingBinaryVersions, "binary version is", "binary versions are")} retained on this Mac, waiting to upload.` : null
  switch (status.state) {
    case "live":
      if (pendingBinaries) return { tone: "working", label: "Uploads pending", detail: pendingBinaries }
      return status.pendingBatches > 0
        ? { tone: "working", label: "Sending changes…", detail: skippedDetail }
        : { tone: "live", label: "Live", detail: skippedDetail }
    case "starting":
    case "syncing":
      return { tone: "working", label: "Syncing…", detail: null }
    case "reconnecting":
      return { tone: "working", label: status.pendingBatches > 0 || pendingBinaries ? "Offline · local changes pending" : "Reconnecting…",
        detail: pendingBinaries ?? status.lastError?.message ?? null }
    case "waiting_for_ticket":
      return { tone: "working", label: "Renewing access…", detail: null }
    case "paused":
      return {
        tone: "attention",
        label: "Paused on this Mac",
        detail: status.pausedReason ?? "This folder is not on the session branch, so nothing syncs here.",
      }
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
        detail: input.error ?? "A member who is online shares the session key with this device. This retries on its own.",
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

export interface LiveSessionAutoGitView {
  tone: LiveSessionTone
  label: string
  /** Why saving stopped or lags behind; null when there is nothing to explain. */
  detail: string | null
  /** Which Mac saves, and the last commit, for a tooltip. */
  title: string | null
  /** Whether Save now can reach a Mac that pushes. */
  canSave: boolean
  /** The fix the bar offers for why saving waits, when there is one. */
  fix: "ignore_env" | null
}

// Stops the session itself can lift, and what the bar calls them.
const HOLD_LABELS: Record<string, string> = {
  ENV_NOT_IGNORED: "Git saves on hold",
  CONFLICT_MARKERS: "Git saves wait on conflicts",
}

function formatSaveTime(publishedAt: number): string {
  return new Date(publishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

/** How the session is saved to its Git branch, for the session bar (Section 14 - 16). */
export function describeAutoGit(
  status: ProjectdSessionStatus | null,
  leaderName: string | null = null,
): LiveSessionAutoGitView | null {
  const autoGit = status?.autoGit
  if (!status || !autoGit || status.state === "failed" || status.state === "stopped") return null
  const checkpoint = autoGit.lastCheckpoint
  const saver = autoGit.isLeader
    ? "This Mac saves the session to Git."
    : autoGit.leaderPrincipalId
      ? `${leaderName ?? "Another member"}'s Mac saves the session to Git.`
      : null
  const title = [saver, checkpoint ? `Last commit ${checkpoint.commitOid.slice(0, 7)}.` : null].filter(Boolean).join(" ")
  const view = {
    title: title || null,
    canSave: status.role !== "viewer" && autoGit.leaderPrincipalId !== null,
    fix: null,
  }

  switch (autoGit.state) {
    case "blocked":
      return {
        ...view,
        tone: "attention",
        label: HOLD_LABELS[autoGit.detailCode ?? ""] ?? "Git saves stopped",
        detail: autoGit.detail,
        fix: autoGit.detailCode === "ENV_NOT_IGNORED" && status.role !== "viewer" ? "ignore_env" : null,
      }
    case "ineligible":
      return { ...view, tone: "attention", label: "Not saving to Git", detail: autoGit.detail, canSave: false }
    case "no_leader":
      return { ...view, tone: "working", label: "Waiting to save to Git", detail: null, canSave: false }
    case "leader":
    case "follower": {
      if (autoGit.saving) return { ...view, tone: "working", label: "Saving to Git…", detail: autoGit.detail }
      const label = checkpoint ? `Saved to Git at ${formatSaveTime(checkpoint.publishedAt)}` : "Not saved to Git yet"
      const failure = autoGit.lastError
        ? `The last save didn't finish (${autoGit.lastError.message.replace(/\.$/, "")}). It retries on its own.`
        : null
      return { ...view, tone: failure ? "attention" : "live", label, detail: failure ?? autoGit.detail }
    }
  }
}

export interface LiveSessionTargetView {
  /** Short, for the bar: "main is 23 commits ahead". */
  label: string
  /** Why a rebase is recommended, or why the check failed. */
  detail: string | null
  recommended: boolean
  tone: LiveSessionTone
  checking: boolean
  /** When the target was last checked, and which files both sides changed, for a tooltip. */
  title: string | null
}

/** How far the branch the session merges into has moved, for the session bar (Section 20). */
export function describeTarget(target: ProjectdTargetStatus | null): LiveSessionTargetView | null {
  if (!target) return null
  const base = { recommended: false, checking: target.checking, detail: null, title: null }
  if (target.error) {
    return { ...base, tone: "attention", label: `Couldn't check ${target.branch}`, detail: target.error }
  }
  if (target.checkedAt === null) {
    return target.checking ? { ...base, tone: "idle", label: `Checking ${target.branch}…` } : null
  }
  const checked = `Checked ${target.branch} at ${formatSaveTime(target.checkedAt)}.`
  if (target.behind === 0) {
    return { ...base, tone: "idle", label: `Up to date with ${target.branch}`, title: checked }
  }
  const overlap =
    target.overlappingPaths.length > 0 ? ` Both changed: ${target.overlappingPaths.join(", ")}.` : ""
  return {
    ...base,
    tone: target.recommended ? "working" : "idle",
    label: `${target.branch} is ${countOf(target.behind, "commit", "commits")} ahead`,
    detail: target.recommended && target.reason ? `Rebase recommended: ${target.reason}` : null,
    recommended: target.recommended,
    title: `${checked}${overlap}`,
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

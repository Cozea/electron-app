/**
 * Projectd Local Client Protocol
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P02
 *
 * Requirements:
 * - Versioned local Unix-domain socket (/tmp/cozea-projectd-<uid>.sock)
 * - Socket permissions 0600
 * - Explicit protocol version and handshake
 * - Request IDs and request/response matching
 * - Typed structured errors
 * - Streaming event subscriptions
 * - Graceful shutdown
 */

export const PROJECTD_PROTOCOL_VERSION = "1.0.0"
export const PROJECTD_DEFAULT_DAEMON_VERSION = "0.2.3"

export function getProjectdSocketPath(uid?: number): string {
  if (process.env.COZEA_PROJECTD_SOCKET) {
    return process.env.COZEA_PROJECTD_SOCKET
  }
  const effectiveUid = uid ?? (typeof process.getuid === "function" ? process.getuid() : 501)
  return `/tmp/cozea-projectd-${effectiveUid}.sock`
}

export type ProjectdErrorCode =
  | "INVALID_HANDSHAKE"
  | "UNSUPPORTED_VERSION"
  | "METHOD_NOT_FOUND"
  | "INVALID_PARAMS"
  | "INTERNAL_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "CANCELLED"
  | "SHUTTING_DOWN"

export interface ProjectdError {
  code: ProjectdErrorCode
  message: string
  details?: unknown
}

// ─── Wire Messages ─────────────────────────────────────────────────────────────

export interface ProjectdHandshakeRequest {
  type: "handshake"
  id: string
  protocolVersion: string
  clientName: string
  clientVersion?: string
}

export interface ProjectdHandshakeResponse {
  type: "handshake_ack"
  id: string
  success: boolean
  protocolVersion: string
  daemonVersion: string
  pid: number
  error?: ProjectdError
}

export interface ProjectdRequest<P = unknown> {
  type: "request"
  id: string
  method: string
  params?: P
}

export interface ProjectdSuccessResponse<R = unknown> {
  type: "response"
  id: string
  success: true
  result: R
}

export interface ProjectdErrorResponse {
  type: "response"
  id: string
  success: false
  error: ProjectdError
}

export type ProjectdResponse<R = unknown> = ProjectdSuccessResponse<R> | ProjectdErrorResponse

export interface ProjectdSubscribeRequest {
  type: "subscribe"
  id: string
  topic: string
}

export interface ProjectdUnsubscribeRequest {
  type: "unsubscribe"
  id: string
  topic: string
}

export interface ProjectdEventMessage<P = unknown> {
  type: "event"
  topic: string
  event: string
  payload: P
  timestamp: number
}

export type ProjectdClientMessage =
  | ProjectdHandshakeRequest
  | ProjectdRequest
  | ProjectdSubscribeRequest
  | ProjectdUnsubscribeRequest

export type ProjectdServerMessage =
  | ProjectdHandshakeResponse
  | ProjectdResponse
  | ProjectdEventMessage

// ─── Standard Method Payloads ──────────────────────────────────────────────────

export interface ProjectdHealthResult {
  status: "healthy" | "degraded"
  version: string
  protocolVersion: string
  pid: number
  uptimeSeconds: number
  activeConnections: number
  startedAt: number
}

export interface ProjectdShutdownParams {
  reason?: string
}

export interface ProjectdShutdownResult {
  shuttingDown: true
}

// ─── Collaboration sessions (P10, P13) ─────────────────────────────────────────

export type ProjectdSessionRole = "viewer" | "developer" | "project_manager"

/** A short-lived credential for one session room, issued by the gateway. */
export interface ProjectdSessionTicket {
  wsUrl: string
  token: string
  role?: ProjectdSessionRole
}

export interface ProjectdSessionAttachParams {
  publicSessionId: string
  workspaceId: string
  projectId: string
  /** Absolute path of the folder the session syncs. */
  rootPath: string
  /** The session's 32-byte room key, base64. Only this user's local socket carries it. */
  roomKeyBase64: string
  ticket: ProjectdSessionTicket
  actor?: { principalId?: string; identityKey?: string }
  /**
   * The session's branch. With it, the daemon keeps the folder from syncing while
   * another branch is checked out, and saves the session to the branch (AutoGit).
   */
  branchName?: string
  /**
   * Share the project's env files (.env) through the session although Git ignores
   * them. They travel end to end encrypted like every session file. AutoGit commits
   * only what Git's ignore rules allow, and holds saving while a new env file isn't
   * ignored.
   */
  shareEnvironmentFiles?: boolean
  /** The branch the session's work merges into, such as main; the daemon tracks how far it moved (P20). */
  targetBranch?: string
  /** When the session started, in epoch milliseconds. */
  sessionStartedAt?: number
}

export type ProjectdSessionState =
  | "starting"
  | "syncing"
  | "live"
  | "reconnecting"
  | "waiting_for_ticket"
  /** The folder left the session branch, or Git is mid-merge or mid-rebase in it. */
  | "paused"
  | "stopped"
  | "failed"

export interface ProjectdCheckpointSummary {
  commitOid: string
  sessionSeq: number
  publishedAt: number
}

export type ProjectdAutoGitState = "ineligible" | "no_leader" | "follower" | "leader" | "blocked"

/** How the session is saved to its Git branch, as this device sees it (Section 14 - 16). */
export interface ProjectdAutoGitStatus {
  state: ProjectdAutoGitState
  isLeader: boolean
  /** The member whose device pushes checkpoints; null while none does. */
  leaderPrincipalId: string | null
  lastCheckpoint: ProjectdCheckpointSummary | null
  /** Session changes this device has that no checkpoint holds yet. */
  unsavedChanges: number
  saving: boolean
  /** Why saving stopped, why this device cannot push, or why Git here lags behind. */
  detail: string | null
  /** What kind of stop `detail` describes, such as ENV_NOT_IGNORED, so the app can offer the fix. */
  detailCode?: string | null
  lastError: { code: string; message: string } | null
}

export interface ProjectdCheckpointResult {
  /** saved: this device saved, or had nothing new; requested: the leader was asked; no_leader: no device can push. */
  outcome: "saved" | "requested" | "no_leader"
  lastCheckpoint: ProjectdCheckpointSummary | null
}

/** How far the branch a session's work merges into has moved (Section 20). */
export interface ProjectdTargetStatus {
  /** The target branch, such as main. */
  branch: string
  /** Commits on the target that the session branch doesn't have. */
  behind: number
  /** Commits on the session branch that the target doesn't have. */
  ahead: number
  /** Files the target changed since the session branch split from it. */
  changedPathCount: number
  /** Up to ten of those files that the session changed too. */
  overlappingPaths: string[]
  /** Whether rebasing the session onto the target is worth it now. Nothing rebases on its own. */
  recommended: boolean
  /** Why, in words for the session bar. */
  reason: string | null
  checkedAt: number | null
  checking: boolean
  /** Why the last check failed, such as a remote that could not be reached. */
  error: string | null
}

export interface ProjectdSessionStatus {
  publicSessionId: string
  workspaceId: string
  rootPath: string
  state: ProjectdSessionState
  role: ProjectdSessionRole
  lastAppliedSessionSeq: number
  pendingBatches: number
  fileCount: number
  /** Files kept on this machine: binaries, and text too large for one batch. */
  skippedPaths: string[]
  lastError: { code: string; message: string } | null
  updatedAt: number
  /** Why the folder stopped syncing while the state is `paused`. */
  pausedReason?: string | null
  /** Absent from daemons older than AutoGit, and null when the folder is not a Git repository. */
  autoGit?: ProjectdAutoGitStatus | null
  /** How far the target branch moved; null without a target or a Git repository. */
  target?: ProjectdTargetStatus | null
}

/** Topic carrying one session's `status` and `ticket_needed` events. */
export function projectdSessionTopic(publicSessionId: string): string {
  return `session:${publicSessionId}`
}

// ─── Framing utilities (Line-delimited JSON) ───────────────────────────────────

export function encodeMessage(msg: ProjectdClientMessage | ProjectdServerMessage): string {
  return JSON.stringify(msg) + "\n"
}

export class LineMessageDecoder {
  private buffer = ""

  push(chunk: string | Buffer): (ProjectdClientMessage | ProjectdServerMessage)[] {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
    const messages: (ProjectdClientMessage | ProjectdServerMessage)[] = []

    let newlineIndex: number
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line.length > 0) {
        try {
          messages.push(JSON.parse(line))
        } catch (err) {
          console.error("[LineMessageDecoder] Malformed message:", line, err)
        }
      }
    }

    return messages
  }
}

export * from "./client"


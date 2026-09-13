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

import { StringDecoder } from "node:string_decoder"

export const PROJECTD_PROTOCOL_VERSION = "1.0.0"
export const PROJECTD_DEFAULT_DAEMON_VERSION = "0.2.3"

export function getProjectdSocketPath(uid?: number): string {
  if (process.env.COZEA_PROJECTD_SOCKET) {
    return process.env.COZEA_PROJECTD_SOCKET
  }
  const effectiveUid = uid ?? (typeof process.getuid === "function" ? process.getuid() : 501)
  return `/tmp/cozea-projectd-${effectiveUid}.sock`
}

/**
 * The protocol's own codes. Daemon components add theirs, such as NOT_SAVED from a
 * merge or CONFLICT_MARKERS from AutoGit, so clients can tell failures apart.
 */
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
  | (string & {})

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

// ─── Local Session Workbenches (P13-P15) ─────────────────────────────────────

export interface ProjectdEnsureSessionWorkbenchParams {
  /** Main-pinned services used to hydrate before activation. */
  background?: { gatewayUrl: string; convexUrl: string }
  projectId: string
  /** Public czs_… session ID. This is the stable device-local Session Workbench identity. */
  publicSessionId: string
  branchName: string
  /** Branch/ref used as the starting point when creating a new collaboration branch. */
  baseBranch?: string | null
  createBranch?: boolean
  title: string
  /** Network remote when available. The daemon preserves credential-bearing HTTPS URLs verbatim. */
  sourceRepoUrl?: string | null
  /** Trusted local source folder, resolved by Electron main from a workspace ID. */
  sourceRootPath?: string | null
  /** Copy the source working tree bytes into the dedicated clone after Git setup. */
  includeDirtyChanges?: boolean
  /** Electron WorkspaceCatalog identity for the same managed folder. */
  workspaceId?: string
  /** Absolute managed session repo path chosen by Electron main. */
  rootPath?: string
  setActive?: boolean
}

export interface ProjectdSessionWorkbenchRecord {
  workbenchId: string
  projectId: string
  workspaceId: string
  workspaceRevision: number
  kind: "collaboration"
  branchName: string
  collaborationSessionId: string
  lifecycle: "creating" | "active" | "idle" | "closing" | "closed"
  title: string
  createdAt: number
  updatedAt: number
  lastActivatedAt: number | null
  presentationStateRef: string
}

export interface ProjectdEnsureSessionWorkbenchResult {
  workbench: ProjectdSessionWorkbenchRecord
  rootPath: string
  reused: boolean
}

// ─── Collaboration sessions (P10, P13) ─────────────────────────────────────────

export type ProjectdSessionRole = "viewer" | "developer" | "project_manager"

/** A short-lived credential for one session room, issued by the gateway. */
export interface ProjectdSessionTicket {
  wsUrl: string
  token: string
  role?: ProjectdSessionRole
}

/** Device-local discovery metadata only; never returns credentials or key material. */
export interface ProjectdSessionRecoveryEntry {
  publicSessionId: string
  projectId: string | null
  workspaceId: string | null
  branchName: string | null
  source: "joined" | "left"
  descriptorState: "readable" | "unreadable"
  hasRetainedKey: boolean
  pendingBatches: number
  snapshotSequence: number | null
  pendingBinaryVersions: number
  requiresOnlineVerification: boolean
}

export type ProjectdRecoveryConflictKind =
  | "path_collision"
  | "concurrent_rename"
  | "delete_modify"
  | "binary_concurrent_revision"

/** Bounded inspect-only metadata/content for one retained file identity. */
export interface ProjectdRecoveryPreviewEntry {
  /** Stable only while retained state is unchanged; a missing cursor means refresh. */
  cursor: string
  fileId: string | null
  path: string
  kind: "text" | "binary" | "symlink"
  mode: number
  deleted: boolean
  size: number | null
  textPreview: string | null
  textTruncated: boolean
  symlinkTarget: string | null
  symlinkTargetTruncated: boolean
  revisionCount: number
  pendingBinaryVersions: number
  conflictKinds: ProjectdRecoveryConflictKind[]
}

/** Local-only frozen-session inspection. This never implies a shared-session mutation. */
export interface ProjectdRecoveryPreviewResult {
  publicSessionId: string
  snapshotSequence: number | null
  pendingBatches: number
  pendingBinaryVersions: number
  totalEntries: number
  entries: ProjectdRecoveryPreviewEntry[]
  nextCursor: string | null
  conflicts: {
    pathCollisions: number
    concurrentRenames: number
    deleteModify: number
    binary: number
  }
}

export interface ProjectdRecoveryExportResult {
  directory: string
  files: number
  pendingBatches: number
  missingBinaryContents: number
  pendingOnly: boolean
  projectOmissions: number
  pendingBinaryVersions: number
}

export interface ProjectdSessionAttachParams {
  /** Main-pinned authorities; permits OS-protected background resumption. */
  background?: { gatewayUrl: string; convexUrl: string }
  publicSessionId: string
  workspaceId: string
  projectId: string
  /** Absolute path of the folder the session syncs. */
  rootPath: string
  /** The session's 32-byte room key, base64. Only this user's local socket carries it. */
  roomKeyBase64: string
  /** Current E2EE content-key generation. */
  roomKeyVersion?: number
  /** Older E2EE keys retained by this still-authorized member for historical replay. */
  previousRoomKeysBase64?: Record<string, string>
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

/** How an explicit rebase of the session onto its target went (Section 21). */
export interface ProjectdRebaseResult {
  /**
   * rebased: pushed over the last save; held: waiting for a save;
   * conflicts: isolated resolution is required with live files unchanged; current: nothing to rebase;
   * requested: the Mac that saves was asked; no_leader: no Mac can push.
   */
  outcome: "rebased" | "held" | "conflicts" | "current" | "requested" | "no_leader"
  message: string
  commitOid?: string | null
  conflictingPaths?: string[]
  /** Opaque device-local isolated rebase journal, retained across daemon restarts. */
  recoveryId?: string
}

export type ProjectdRebaseChoice = { path: string } & (
  { kind: "variant"; stage: 1 | 2 | 3 } | { kind: "content"; text: string; executable: boolean } | { kind: "delete" }
)
export type ProjectdRebaseRecoveryRequest = { action: "list" } | { action: "review" | "continue" | "apply" | "cancel"; recoveryId: string } |
  { action: "resolve"; recoveryId: string; fingerprint: string; choices: ProjectdRebaseChoice[] }
export interface ProjectdRebaseReview {
  recoveryId: string
  state: "conflicted" | "computed" | "resolving" | "adopting"
  fingerprint: string | null
  variants: Array<{ path: string; stage: 1 | 2 | 3; mode: string; oid: string; text: string | null }>
}
export interface ProjectdRebaseRecoveryResponse {
  journals?: Array<{ id: string; state: string; createdAt: number }>
  review?: ProjectdRebaseReview
  result?: ProjectdRebaseResult
}

export type ProjectdMergeStrategy = "merge" | "squash"

export type ProjectdStructuralConflictRequest = { action: "list"; afterFileId?: string } |
  { action: "resolve"; fileId: string; fingerprint: string; choice: "rename" | "restore" | "delete"; path?: string }
export interface ProjectdStructuralConflictReview {
  fileId: string
  path: string
  deleted: boolean
  kinds: Array<"path_collision" | "concurrent_rename" | "delete_modify">
  alternatives: string[]
  fingerprint: string
  textPreview?: string
}
export interface ProjectdStructuralConflictResponse {
  conflicts: ProjectdStructuralConflictReview[]
  nextFileId: string | null
}

export type ProjectdBinaryConflictRequest = { action: "list"; afterFileId?: string } |
  { action: "resolve" | "preview" | "export"; fileId: string; revisionId: string; fingerprint: string; destinationDirectory?: string }
export interface ProjectdBinaryConflictReview {
  fileId: string
  path: string
  fingerprint: string
  variants: Array<{ revisionId: string; contentHash: string; size: number; createdAt: number }>
}
export interface ProjectdBinaryConflictResponse {
  conflicts: ProjectdBinaryConflictReview[]
  nextFileId: string | null
  resolvedRevisionId?: string
  exportedPath?: string
  preview?: { revisionId: string; size: number; hex: string; truncated: boolean; imageDataUrl: string | null }
}

export interface ProjectdClosePreflight {
  publicSessionId: string
  reviewId: string
  sessionSeq: number
  gitSavedThroughSeq: number | null
  gitLag: boolean
  conflicts: { pathCollisions: number; concurrentRenames: number; deleteModify: number; binary: number }
  merge: ProjectdMergePreview | null
  mergeUnavailable: string | null
}

export interface ProjectdCloseChoice {
  reviewId: string
  allowUnpublishedGit: boolean
  allowUnresolvedConflicts: boolean
}

export interface ProjectdAdoptGitResult {
  imported: boolean
  status: ProjectdSessionStatus
}

export interface ProjectdSyncFromGitHubResult {
  status: "up_to_date" | "fast_forward_integrated" | "local_ahead" | "remote_diverged"
  remoteOid?: string
  localOid?: string
}

/** Merging the session's last save into its target, before anything is pushed (Section 22.1). */
export interface ProjectdMergePreview {
  canCreatePullRequest?: boolean
  branch: string
  targetBranch: string
  /** The saved session commit the merge takes; never the live state. */
  checkpointOid: string
  targetOid: string
  /** Commits in the save that the target doesn't have. */
  ahead: number
  /** Commits on the target that the session branch doesn't have. */
  behind: number
  clean: boolean
  conflictingPaths: string[]
  /** Session changes not saved to Git yet, which the merge leaves out. */
  unsavedChanges: number
  /** A page where a pull request can be opened, for known hosts. */
  pullRequestUrl: string | null
}

export interface ProjectdPullRequestResult {
  number: number
  url: string
  state: "open"
  created: boolean
}

export interface ProjectdMergeResult {
  pullRequest?: ProjectdPullRequestResult
  /** needs_pull_request: the remote refuses direct pushes; moved: the save or the target moved since review. */
  outcome: "merged" | "needs_pull_request" | "conflicts" | "moved"
  mergeCommitOid?: string
  message: string
  pullRequestUrl: string | null
}

export interface ProjectdSessionStatus {
  publicSessionId: string
  workspaceId: string
  rootPath: string
  state: ProjectdSessionState
  role: ProjectdSessionRole
  lastAppliedSessionSeq: number
  pendingBatches: number
  pendingBinaryVersions: number
  fileCount: number
  /** Files excluded from synchronization by scope or unsupported content rules. */
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
  private readonly utf8 = new StringDecoder("utf8")

  push(chunk: string | Buffer): (ProjectdClientMessage | ProjectdServerMessage)[] {
    this.buffer += this.utf8.write(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk)
    const messages: (ProjectdClientMessage | ProjectdServerMessage)[] = []

    let newlineIndex: number
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line.length > 0) {
        try {
          messages.push(JSON.parse(line))
        } catch {
          // Requests can contain source text and credentials. Never log payloads.
          console.error("[LineMessageDecoder] Malformed JSON message")
        }
      }
    }

    return messages
  }
}

export * from "./client"

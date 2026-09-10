/**
 * Canonical domain contracts for Cozea Collaboration + AutoGit.
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P01
 *
 * Invariants:
 * - C01: Project is the collaborative subject (not a tile or editor).
 * - C02: Session Workbench is local device state.
 * - C06: sessionId != branchName.
 * - C07: workspaceId != projectId.
 * - C08: workbenchId != workspaceId.
 */

// ─── Branded Identifier Types ──────────────────────────────────────────────────
// Enforce at compile-time and runtime that workbenchId != workspaceId != sessionId != branchName.

declare const BrandSymbol: unique symbol

export type Brand<T, B extends string> = T & { readonly [BrandSymbol]: B }

export type WorkbenchId = Brand<string, "WorkbenchId">
export type WorkspaceId = Brand<string, "WorkspaceId">
export type SessionId = Brand<string, "SessionId">
export type BranchName = Brand<string, "BranchName">
export type ProjectId = Brand<string, "ProjectId">
export type RepositoryBindingId = Brand<string, "RepositoryBindingId">
export type BarrierId = Brand<string, "BarrierId">

export function asWorkbenchId(id: string): WorkbenchId {
  if (!id || typeof id !== "string") {
    throw new TypeError("Invalid workbenchId: must be a non-empty string")
  }
  return id as WorkbenchId
}

export function asWorkspaceId(id: string): WorkspaceId {
  if (!id || typeof id !== "string") {
    throw new TypeError("Invalid workspaceId: must be a non-empty string")
  }
  return id as WorkspaceId
}

export function asSessionId(id: string): SessionId {
  if (!id || typeof id !== "string") {
    throw new TypeError("Invalid sessionId: must be a non-empty string")
  }
  return id as SessionId
}

export function asBranchName(name: string): BranchName {
  if (!name || typeof name !== "string") {
    throw new TypeError("Invalid branchName: must be a non-empty string")
  }
  return name as BranchName
}

export function asProjectId(id: string): ProjectId {
  if (!id || typeof id !== "string") {
    throw new TypeError("Invalid projectId: must be a non-empty string")
  }
  return id as ProjectId
}

export function asRepositoryBindingId(id: string): RepositoryBindingId {
  if (!id || typeof id !== "string") {
    throw new TypeError("Invalid repositoryBindingId: must be a non-empty string")
  }
  return id as RepositoryBindingId
}

export function asBarrierId(id: string): BarrierId {
  if (!id || typeof id !== "string") {
    throw new TypeError("Invalid barrierId: must be a non-empty string")
  }
  return id as BarrierId
}

// ─── State Machine Lifecycles ──────────────────────────────────────────────────

/**
 * Collaboration session lifecycle (Section 4.1).
 *
 * CREATING -> ACTIVE <-> DORMANT
 * ACTIVE -> PAUSING -> PAUSED -> ACTIVE
 * ACTIVE / PAUSED -> CLOSING -> CLOSED
 * Any non-closed state may transition to BLOCKED.
 */
export type SessionLifecycle =
  | "CREATING"
  | "ACTIVE"
  | "DORMANT"
  | "PAUSING"
  | "PAUSED"
  | "CLOSING"
  | "CLOSED"
  | "BLOCKED"

/**
 * Session participant lifecycle (Section 4.2).
 *
 * NOT_JOINED -> INVITED / AVAILABLE -> JOINING -> CONNECTED <-> BACKGROUND
 * CONNECTED / BACKGROUND -> LEFT
 */
export type ParticipantLifecycle =
  | "NOT_JOINED"
  | "INVITED"
  | "AVAILABLE"
  | "JOINING"
  | "CONNECTED"
  | "BACKGROUND"
  | "LEFT"

/**
 * Local device Workbench lifecycle (Section 4.3).
 *
 * CREATING -> IDLE <-> ACTIVE
 * IDLE / ACTIVE -> CLOSING -> CLOSED
 * Exactly one Workbench for a given projectId is ACTIVE on one device at a time.
 */
export type LocalWorkbenchLifecycle =
  | "creating"
  | "active"
  | "idle"
  | "closing"
  | "closed"

/**
 * AutoGit leader & coordination lifecycle (Section 4.4).
 */
export type AutoGitLifecycle =
  | "DISABLED"
  | "NO_LEADER"
  | "ELECTING"
  | "LEADER_ACTIVE"
  | "LEADER_DEGRADED"
  | "TRANSFERRING"
  | "BLOCKED"

/**
 * AutoGit checkpoint execution stages (Section 4.5).
 */
export type AutoGitCheckpointStage =
  | "REQUESTED"
  | "FLUSHING"
  | "BARRIER_CREATED"
  | "SNAPSHOT_CAPTURED"
  | "GIT_TREE_BUILT"
  | "COMMIT_PREPARED"
  | "PUSHING"
  | "REMOTE_VERIFIED"
  | "ADOPTED"
  | "COMPLETE"
  | "FAILED"

/**
 * Rebase coordination lifecycle (Section 4.6).
 *
 * IDLE -> SUGGESTED -> REQUESTED -> PREPARING_BARRIER -> CHECKPOINTING ->
 * FETCHING_TARGET -> COMPUTING -> CONFLICTED | READY_TO_ADOPT -> ADOPTING ->
 * PUSHING_REWRITTEN_BRANCH -> COMPLETE | FAILED
 *
 * Invariant C25: SUGGESTED never transitions to REQUESTED without explicit user action.
 */
export type RebaseLifecycle =
  | "IDLE"
  | "SUGGESTED"
  | "REQUESTED"
  | "PREPARING_BARRIER"
  | "CHECKPOINTING"
  | "FETCHING_TARGET"
  | "COMPUTING"
  | "CONFLICTED"
  | "READY_TO_ADOPT"
  | "ADOPTING"
  | "PUSHING_REWRITTEN_BRANCH"
  | "COMPLETE"
  | "FAILED"

/**
 * Session access modes (Section 25.1).
 */
export type SessionAccessMode = "invite_only" | "organization_available"

/**
 * Participant roles within a collaboration session (Section 25.2 - 25.4).
 */
export type ParticipantRole = "viewer" | "developer" | "project_manager"

// ─── Domain Models ─────────────────────────────────────────────────────────────

export type WorkbenchKind = "ordinary" | "collaboration"

/**
 * Device-local durable execution/presentation context for a Project (Section 5.1).
 *
 * A project may have multiple Workbenches persisted on one device.
 * A Session Workbench is a local Workbench whose workspace is enrolled in a collaboration session.
 * Workbench records are local and never replicated across participants.
 */
export interface LocalProjectWorkbench {
  readonly workbenchId: WorkbenchId
  readonly projectId: ProjectId
  readonly workspaceId: WorkspaceId
  readonly workspaceRevision: number

  readonly kind: WorkbenchKind

  readonly branchName: BranchName | null
  readonly collaborationSessionId: SessionId | null

  readonly lifecycle: LocalWorkbenchLifecycle

  readonly title: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastActivatedAt: number | null

  /**
   * Reference to local presentation state (e.g. layout / tile arrangement).
   * Not shared as cloud collaboration state (Section 5.1).
   */
  readonly presentationStateRef: string
}

/**
 * Cloud/session coordination descriptor (Section 2.6, 25.1).
 */
export interface CollaborationSessionDescriptor {
  readonly sessionId: SessionId
  readonly publicSessionId: string
  readonly projectId: ProjectId
  readonly repositoryBindingId: RepositoryBindingId

  readonly sessionBranch: BranchName
  readonly targetBranch: BranchName

  readonly createdBy: string
  readonly lifecycle: SessionLifecycle
  readonly accessMode: SessionAccessMode
  readonly organizationId: string | null

  readonly createdAt: number
  readonly updatedAt: number
  readonly pausedAt: number | null
  readonly closedAt: number | null

  readonly lastDurableSeq: number
  readonly lastSnapshotSeq: number
  readonly lastAutoGitCheckpointSeq: number | null
  readonly lastAutoGitCommitOid: string | null
}

/**
 * Participant in a collaboration session (Section 23.2, 25.1).
 */
export interface CollaborationParticipant {
  readonly sessionId: SessionId
  readonly principalId: string
  readonly identityKey: string
  readonly displayName: string
  readonly role: ParticipantRole
  readonly lifecycle: ParticipantLifecycle
  readonly isLeader: boolean

  readonly joinedAt: number
  readonly lastSeenAt: number
  readonly leftAt: number | null
}

/**
 * AutoGit fenced leader lease (Section 14.5).
 */
export interface AutoGitLease {
  readonly sessionId: SessionId
  readonly leaderIdentityKey: string
  readonly leaseGeneration: number
  readonly leaseExpiresAt: number
  readonly lastRenewedAt: number
}

/**
 * AutoGit immutable barrier checkpoint (Section 15.5 - 15.7).
 */
export interface AutoGitCheckpoint {
  readonly checkpointId: string
  readonly sessionId: SessionId
  readonly barrierId: BarrierId
  readonly sessionSeq: number
  readonly stage: AutoGitCheckpointStage

  readonly commitOid: string | null
  readonly parentOid: string | null
  readonly treeOid: string | null
  readonly logicalTreeHash: string | null
  readonly leaseGeneration: number

  readonly createdAt: number
  readonly completedAt: number | null
  readonly errorMessage: string | null
}

/**
 * Rebase tracking and progress status (Section 20, 21).
 */
export interface RebaseStatus {
  readonly sessionId: SessionId
  readonly lifecycle: RebaseLifecycle
  readonly targetBranch: BranchName
  readonly targetRemoteOid: string | null
  readonly mergeBaseOid: string | null

  readonly behindCommitCount: number
  readonly aheadCommitCount: number

  readonly recommended: boolean
  readonly recommendationReason: string | null

  readonly requestedAt: number | null
  readonly completedAt: number | null
  readonly errorMessage: string | null
}

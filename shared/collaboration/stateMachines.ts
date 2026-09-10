/**
 * Pure state-machine transition validators for Cozea Collaboration + AutoGit.
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P01
 *
 * Sections: 4.1 - 4.6, Invariant C25.
 */

import type {
  AutoGitCheckpointStage,
  AutoGitLifecycle,
  LocalWorkbenchLifecycle,
  ParticipantLifecycle,
  RebaseLifecycle,
  SessionLifecycle,
} from "./types"

export class InvalidStateTransitionError extends Error {
  readonly machine: string
  readonly fromState: string
  readonly toState: string

  constructor(machine: string, fromState: string, toState: string, reason?: string) {
    super(
      `Invalid transition in ${machine} from '${fromState}' to '${toState}'${
        reason ? `: ${reason}` : ""
      }`,
    )
    this.name = "InvalidStateTransitionError"
    this.machine = machine
    this.fromState = fromState
    this.toState = toState
  }
}

// ─── 4.1 Session Lifecycle ────────────────────────────────────────────────────

const SESSION_VALID_TRANSITIONS: Record<SessionLifecycle, readonly SessionLifecycle[]> = {
  CREATING: ["ACTIVE", "BLOCKED", "CLOSED"],
  ACTIVE: ["DORMANT", "PAUSING", "CLOSING", "BLOCKED"],
  DORMANT: ["ACTIVE", "CLOSING", "BLOCKED"],
  PAUSING: ["PAUSED", "BLOCKED"],
  PAUSED: ["ACTIVE", "CLOSING", "BLOCKED"],
  CLOSING: ["CLOSED", "BLOCKED"],
  CLOSED: [], // Terminal
  BLOCKED: ["ACTIVE", "DORMANT", "CLOSING", "CLOSED"],
}

export function canTransitionSessionLifecycle(
  from: SessionLifecycle,
  to: SessionLifecycle,
): boolean {
  if (from === to) return true
  return SESSION_VALID_TRANSITIONS[from].includes(to)
}

export function assertValidSessionTransition(
  from: SessionLifecycle,
  to: SessionLifecycle,
): void {
  if (!canTransitionSessionLifecycle(from, to)) {
    throw new InvalidStateTransitionError("SessionLifecycle", from, to)
  }
}

// ─── 4.2 Participant Lifecycle ────────────────────────────────────────────────

const PARTICIPANT_VALID_TRANSITIONS: Record<
  ParticipantLifecycle,
  readonly ParticipantLifecycle[]
> = {
  NOT_JOINED: ["INVITED", "AVAILABLE"],
  INVITED: ["JOINING", "NOT_JOINED"],
  AVAILABLE: ["JOINING"],
  JOINING: ["CONNECTED", "NOT_JOINED"],
  CONNECTED: ["BACKGROUND", "LEFT"],
  BACKGROUND: ["CONNECTED", "LEFT"],
  LEFT: [], // Terminal for this participant membership instance
}

export function canTransitionParticipantLifecycle(
  from: ParticipantLifecycle,
  to: ParticipantLifecycle,
): boolean {
  if (from === to) return true
  return PARTICIPANT_VALID_TRANSITIONS[from].includes(to)
}

export function assertValidParticipantTransition(
  from: ParticipantLifecycle,
  to: ParticipantLifecycle,
): void {
  if (!canTransitionParticipantLifecycle(from, to)) {
    throw new InvalidStateTransitionError("ParticipantLifecycle", from, to)
  }
}

// ─── 4.3 Local Workbench Lifecycle ───────────────────────────────────────────

const WORKBENCH_VALID_TRANSITIONS: Record<
  LocalWorkbenchLifecycle,
  readonly LocalWorkbenchLifecycle[]
> = {
  creating: ["idle", "active", "closed"],
  idle: ["active", "closing", "closed"],
  active: ["idle", "closing", "closed"],
  closing: ["closed"],
  closed: [], // Terminal
}

export function canTransitionWorkbenchLifecycle(
  from: LocalWorkbenchLifecycle,
  to: LocalWorkbenchLifecycle,
): boolean {
  if (from === to) return true
  return WORKBENCH_VALID_TRANSITIONS[from].includes(to)
}

export function assertValidWorkbenchTransition(
  from: LocalWorkbenchLifecycle,
  to: LocalWorkbenchLifecycle,
): void {
  if (!canTransitionWorkbenchLifecycle(from, to)) {
    throw new InvalidStateTransitionError("LocalWorkbenchLifecycle", from, to)
  }
}

// ─── 4.4 AutoGit Lifecycle ────────────────────────────────────────────────────

const AUTOGIT_VALID_TRANSITIONS: Record<
  AutoGitLifecycle,
  readonly AutoGitLifecycle[]
> = {
  DISABLED: ["NO_LEADER", "BLOCKED"],
  NO_LEADER: ["ELECTING", "DISABLED", "BLOCKED"],
  ELECTING: ["LEADER_ACTIVE", "NO_LEADER", "BLOCKED"],
  LEADER_ACTIVE: ["LEADER_DEGRADED", "TRANSFERRING", "NO_LEADER", "BLOCKED"],
  LEADER_DEGRADED: ["LEADER_ACTIVE", "TRANSFERRING", "NO_LEADER", "BLOCKED"],
  TRANSFERRING: ["ELECTING", "NO_LEADER", "LEADER_ACTIVE", "BLOCKED"],
  BLOCKED: ["NO_LEADER", "DISABLED"],
}

export function canTransitionAutoGitLifecycle(
  from: AutoGitLifecycle,
  to: AutoGitLifecycle,
): boolean {
  if (from === to) return true
  return AUTOGIT_VALID_TRANSITIONS[from].includes(to)
}

export function assertValidAutoGitTransition(
  from: AutoGitLifecycle,
  to: AutoGitLifecycle,
): void {
  if (!canTransitionAutoGitLifecycle(from, to)) {
    throw new InvalidStateTransitionError("AutoGitLifecycle", from, to)
  }
}

// ─── 4.5 AutoGit Checkpoint Stages ────────────────────────────────────────────

const CHECKPOINT_VALID_TRANSITIONS: Record<
  AutoGitCheckpointStage,
  readonly AutoGitCheckpointStage[]
> = {
  REQUESTED: ["FLUSHING", "FAILED"],
  FLUSHING: ["BARRIER_CREATED", "FAILED"],
  BARRIER_CREATED: ["SNAPSHOT_CAPTURED", "FAILED"],
  SNAPSHOT_CAPTURED: ["GIT_TREE_BUILT", "FAILED"],
  GIT_TREE_BUILT: ["COMMIT_PREPARED", "FAILED"],
  COMMIT_PREPARED: ["PUSHING", "FAILED"],
  PUSHING: ["REMOTE_VERIFIED", "FAILED"],
  REMOTE_VERIFIED: ["ADOPTED", "COMPLETE", "FAILED"],
  ADOPTED: ["COMPLETE", "FAILED"],
  COMPLETE: [], // Terminal
  FAILED: [], // Terminal
}

export function canTransitionCheckpointStage(
  from: AutoGitCheckpointStage,
  to: AutoGitCheckpointStage,
): boolean {
  if (from === to) return true
  return CHECKPOINT_VALID_TRANSITIONS[from].includes(to)
}

export function assertValidCheckpointStageTransition(
  from: AutoGitCheckpointStage,
  to: AutoGitCheckpointStage,
): void {
  if (!canTransitionCheckpointStage(from, to)) {
    throw new InvalidStateTransitionError("AutoGitCheckpointStage", from, to)
  }
}

// ─── 4.6 Rebase Lifecycle ─────────────────────────────────────────────────────

const REBASE_VALID_TRANSITIONS: Record<
  RebaseLifecycle,
  readonly RebaseLifecycle[]
> = {
  IDLE: ["SUGGESTED", "REQUESTED"],
  SUGGESTED: ["REQUESTED", "IDLE"],
  REQUESTED: ["PREPARING_BARRIER", "FAILED"],
  PREPARING_BARRIER: ["CHECKPOINTING", "FAILED"],
  CHECKPOINTING: ["FETCHING_TARGET", "FAILED"],
  FETCHING_TARGET: ["COMPUTING", "FAILED"],
  COMPUTING: ["CONFLICTED", "READY_TO_ADOPT", "FAILED"],
  CONFLICTED: ["COMPUTING", "FAILED", "IDLE"],
  READY_TO_ADOPT: ["ADOPTING", "FAILED", "IDLE"],
  ADOPTING: ["PUSHING_REWRITTEN_BRANCH", "FAILED"],
  PUSHING_REWRITTEN_BRANCH: ["COMPLETE", "FAILED"],
  COMPLETE: ["IDLE"],
  FAILED: ["IDLE"],
}

export interface RebaseTransitionOptions {
  /**
   * Enforces Invariant C25: Rebase is explicit.
   * Target-branch movement may trigger SUGGESTED.
   * Rebase never transitions from SUGGESTED to REQUESTED without explicit user action/approval.
   */
  isUserAction?: boolean
}

export function canTransitionRebaseLifecycle(
  from: RebaseLifecycle,
  to: RebaseLifecycle,
  options?: RebaseTransitionOptions,
): boolean {
  if (from === to) return true

  // Invariant C25: SUGGESTED -> REQUESTED requires explicit user approval
  if (from === "SUGGESTED" && to === "REQUESTED" && !options?.isUserAction) {
    return false
  }

  return REBASE_VALID_TRANSITIONS[from].includes(to)
}

export function assertValidRebaseTransition(
  from: RebaseLifecycle,
  to: RebaseLifecycle,
  options?: RebaseTransitionOptions,
): void {
  if (from === "SUGGESTED" && to === "REQUESTED" && !options?.isUserAction) {
    throw new InvalidStateTransitionError(
      "RebaseLifecycle",
      from,
      to,
      "Invariant C25 violated: Rebase cannot transition from SUGGESTED to REQUESTED without explicit user action",
    )
  }

  if (!canTransitionRebaseLifecycle(from, to, options)) {
    throw new InvalidStateTransitionError("RebaseLifecycle", from, to)
  }
}

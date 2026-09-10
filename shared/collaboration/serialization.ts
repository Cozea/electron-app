/**
 * Domain serializers and versioning for Cozea Collaboration + AutoGit.
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P01
 *
 * Invariants:
 * - Versioned serialization envelopes.
 * - Do not attach layout JSON to cloud Session descriptor (Section 5.1).
 * - Enforce workbenchId != workspaceId != sessionId != branchName.
 */

import {
  asBarrierId,
  asBranchName,
  asProjectId,
  asRepositoryBindingId,
  asSessionId,
  asWorkbenchId,
  asWorkspaceId,
  type AutoGitCheckpoint,
  type AutoGitCheckpointStage,
  type AutoGitLease,
  type CollaborationParticipant,
  type CollaborationSessionDescriptor,
  type LocalProjectWorkbench,
  type LocalWorkbenchLifecycle,
  type ParticipantLifecycle,
  type ParticipantRole,
  type RebaseLifecycle,
  type RebaseStatus,
  type SessionAccessMode,
  type SessionLifecycle,
  type WorkbenchKind,
} from "./types"
import { validateWorkbenchInvariants } from "./workbenchStore"

export const COLLABORATION_DOMAIN_SCHEMA_VERSION = 1

export class SerializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SerializationError"
  }
}

export interface SerializedEnvelope<T> {
  readonly version: number
  readonly schema: string
  readonly payload: T
}

function createEnvelope<T>(schema: string, payload: T): SerializedEnvelope<T> {
  return {
    version: COLLABORATION_DOMAIN_SCHEMA_VERSION,
    schema,
    payload,
  }
}

function verifyEnvelope(envelope: any, expectedSchema: string): any {
  if (!envelope || typeof envelope !== "object") {
    throw new SerializationError("Invalid serialized format: expected an envelope object")
  }
  if (envelope.version !== COLLABORATION_DOMAIN_SCHEMA_VERSION) {
    throw new SerializationError(
      `Unsupported schema version '${envelope.version}' (expected '${COLLABORATION_DOMAIN_SCHEMA_VERSION}')`,
    )
  }
  if (envelope.schema !== expectedSchema) {
    throw new SerializationError(
      `Mismatched schema '${envelope.schema}' (expected '${expectedSchema}')`,
    )
  }
  if (!envelope.payload || typeof envelope.payload !== "object") {
    throw new SerializationError("Invalid envelope: payload must be an object")
  }
  return envelope.payload
}

// ─── LocalProjectWorkbench ───────────────────────────────────────────────────

export function serializeWorkbench(
  workbench: LocalProjectWorkbench,
): SerializedEnvelope<LocalProjectWorkbench> {
  validateWorkbenchInvariants(workbench)
  return createEnvelope("LocalProjectWorkbench", { ...workbench })
}

export function deserializeWorkbench(raw: any): LocalProjectWorkbench {
  const p = verifyEnvelope(raw, "LocalProjectWorkbench")

  const kind: WorkbenchKind = p.kind
  if (kind !== "ordinary" && kind !== "collaboration") {
    throw new SerializationError(`Invalid workbench kind: '${kind}'`)
  }

  const workbench: LocalProjectWorkbench = {
    workbenchId: asWorkbenchId(p.workbenchId),
    projectId: asProjectId(p.projectId),
    workspaceId: asWorkspaceId(p.workspaceId),
    workspaceRevision: Number(p.workspaceRevision) || 1,
    kind,
    branchName: p.branchName ? asBranchName(p.branchName) : null,
    collaborationSessionId: p.collaborationSessionId
      ? asSessionId(p.collaborationSessionId)
      : null,
    lifecycle: p.lifecycle as LocalWorkbenchLifecycle,
    title: String(p.title ?? ""),
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Number(p.updatedAt) || Date.now(),
    lastActivatedAt: p.lastActivatedAt ? Number(p.lastActivatedAt) : null,
    presentationStateRef: String(p.presentationStateRef ?? ""),
  }

  validateWorkbenchInvariants(workbench)
  return workbench
}

// ─── CollaborationSessionDescriptor ──────────────────────────────────────────

const FORBIDDEN_LAYOUT_KEYS = [
  "layout",
  "dockview",
  "dockviewLayout",
  "panels",
  "tiles",
  "presentation",
  "workbenchLayout",
]

export function serializeSessionDescriptor(
  session: CollaborationSessionDescriptor,
): SerializedEnvelope<CollaborationSessionDescriptor> {
  // Enforce Section 5.1 / Shortcut rules: Do NOT attach layout JSON to cloud session descriptor
  for (const forbidden of FORBIDDEN_LAYOUT_KEYS) {
    if (forbidden in session) {
      throw new SerializationError(
        `Invariant violation: Layout key '${forbidden}' cannot be attached to cloud Session descriptor`,
      )
    }
  }

  return createEnvelope("CollaborationSessionDescriptor", { ...session })
}

export function deserializeSessionDescriptor(raw: any): CollaborationSessionDescriptor {
  const p = verifyEnvelope(raw, "CollaborationSessionDescriptor")

  for (const forbidden of FORBIDDEN_LAYOUT_KEYS) {
    if (forbidden in p) {
      throw new SerializationError(
        `Invariant violation: Layout key '${forbidden}' found in deserialized Session descriptor`,
      )
    }
  }

  return {
    sessionId: asSessionId(p.sessionId),
    publicSessionId: String(p.publicSessionId),
    projectId: asProjectId(p.projectId),
    repositoryBindingId: asRepositoryBindingId(p.repositoryBindingId),
    sessionBranch: asBranchName(p.sessionBranch),
    targetBranch: asBranchName(p.targetBranch),
    createdBy: String(p.createdBy),
    lifecycle: p.lifecycle as SessionLifecycle,
    accessMode: p.accessMode as SessionAccessMode,
    organizationId: p.organizationId ? String(p.organizationId) : null,
    createdAt: Number(p.createdAt),
    updatedAt: Number(p.updatedAt),
    pausedAt: p.pausedAt ? Number(p.pausedAt) : null,
    closedAt: p.closedAt ? Number(p.closedAt) : null,
    lastDurableSeq: Number(p.lastDurableSeq) || 0,
    lastSnapshotSeq: Number(p.lastSnapshotSeq) || 0,
    lastAutoGitCheckpointSeq: p.lastAutoGitCheckpointSeq
      ? Number(p.lastAutoGitCheckpointSeq)
      : null,
    lastAutoGitCommitOid: p.lastAutoGitCommitOid ? String(p.lastAutoGitCommitOid) : null,
  }
}

// ─── CollaborationParticipant ────────────────────────────────────────────────

export function serializeParticipant(
  participant: CollaborationParticipant,
): SerializedEnvelope<CollaborationParticipant> {
  return createEnvelope("CollaborationParticipant", { ...participant })
}

export function deserializeParticipant(raw: any): CollaborationParticipant {
  const p = verifyEnvelope(raw, "CollaborationParticipant")
  return {
    sessionId: asSessionId(p.sessionId),
    principalId: String(p.principalId),
    identityKey: String(p.identityKey),
    displayName: String(p.displayName ?? ""),
    role: p.role as ParticipantRole,
    lifecycle: p.lifecycle as ParticipantLifecycle,
    isLeader: Boolean(p.isLeader),
    joinedAt: Number(p.joinedAt),
    lastSeenAt: Number(p.lastSeenAt),
    leftAt: p.leftAt ? Number(p.leftAt) : null,
  }
}

// ─── AutoGitLease ─────────────────────────────────────────────────────────────

export function serializeAutoGitLease(
  lease: AutoGitLease,
): SerializedEnvelope<AutoGitLease> {
  return createEnvelope("AutoGitLease", { ...lease })
}

export function deserializeAutoGitLease(raw: any): AutoGitLease {
  const p = verifyEnvelope(raw, "AutoGitLease")
  return {
    sessionId: asSessionId(p.sessionId),
    leaderIdentityKey: String(p.leaderIdentityKey),
    leaseGeneration: Number(p.leaseGeneration),
    leaseExpiresAt: Number(p.leaseExpiresAt),
    lastRenewedAt: Number(p.lastRenewedAt),
  }
}

// ─── AutoGitCheckpoint ────────────────────────────────────────────────────────

export function serializeAutoGitCheckpoint(
  checkpoint: AutoGitCheckpoint,
): SerializedEnvelope<AutoGitCheckpoint> {
  return createEnvelope("AutoGitCheckpoint", { ...checkpoint })
}

export function deserializeAutoGitCheckpoint(raw: any): AutoGitCheckpoint {
  const p = verifyEnvelope(raw, "AutoGitCheckpoint")
  return {
    checkpointId: String(p.checkpointId),
    sessionId: asSessionId(p.sessionId),
    barrierId: asBarrierId(p.barrierId),
    sessionSeq: Number(p.sessionSeq),
    stage: p.stage as AutoGitCheckpointStage,
    commitOid: p.commitOid ? String(p.commitOid) : null,
    parentOid: p.parentOid ? String(p.parentOid) : null,
    treeOid: p.treeOid ? String(p.treeOid) : null,
    logicalTreeHash: p.logicalTreeHash ? String(p.logicalTreeHash) : null,
    leaseGeneration: Number(p.leaseGeneration),
    createdAt: Number(p.createdAt),
    completedAt: p.completedAt ? Number(p.completedAt) : null,
    errorMessage: p.errorMessage ? String(p.errorMessage) : null,
  }
}

// ─── RebaseStatus ─────────────────────────────────────────────────────────────

export function serializeRebaseStatus(
  status: RebaseStatus,
): SerializedEnvelope<RebaseStatus> {
  return createEnvelope("RebaseStatus", { ...status })
}

export function deserializeRebaseStatus(raw: any): RebaseStatus {
  const p = verifyEnvelope(raw, "RebaseStatus")
  return {
    sessionId: asSessionId(p.sessionId),
    lifecycle: p.lifecycle as RebaseLifecycle,
    targetBranch: asBranchName(p.targetBranch),
    targetRemoteOid: p.targetRemoteOid ? String(p.targetRemoteOid) : null,
    mergeBaseOid: p.mergeBaseOid ? String(p.mergeBaseOid) : null,
    behindCommitCount: Number(p.behindCommitCount) || 0,
    aheadCommitCount: Number(p.aheadCommitCount) || 0,
    recommended: Boolean(p.recommended),
    recommendationReason: p.recommendationReason ? String(p.recommendationReason) : null,
    requestedAt: p.requestedAt ? Number(p.requestedAt) : null,
    completedAt: p.completedAt ? Number(p.completedAt) : null,
    errorMessage: p.errorMessage ? String(p.errorMessage) : null,
  }
}

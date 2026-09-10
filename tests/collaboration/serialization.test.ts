import { describe, expect, it } from "vitest"

import {
  asBarrierId,
  asBranchName,
  asProjectId,
  asRepositoryBindingId,
  asSessionId,
  asWorkspaceId,
  type AutoGitCheckpoint,
  type AutoGitLease,
  type CollaborationParticipant,
  type CollaborationSessionDescriptor,
  COLLABORATION_DOMAIN_SCHEMA_VERSION,
  createOrdinaryWorkbench,
  createSessionWorkbench,
  deserializeAutoGitCheckpoint,
  deserializeAutoGitLease,
  deserializeParticipant,
  deserializeRebaseStatus,
  deserializeSessionDescriptor,
  deserializeWorkbench,
  type RebaseStatus,
  SerializationError,
  serializeAutoGitCheckpoint,
  serializeAutoGitLease,
  serializeParticipant,
  serializeRebaseStatus,
  serializeSessionDescriptor,
  serializeWorkbench,
} from "@shared/collaboration"

describe("P01 domain serializers and versioning", () => {
  const projectId = asProjectId("proj_1")
  const workspaceId = asWorkspaceId("ws_1")
  const sessionId = asSessionId("sess_1")
  const branchName = asBranchName("feature/x")

  it("serializes and deserializes ordinary and session workbenches with round-trip fidelity", () => {
    const ordinary = createOrdinaryWorkbench({
      projectId,
      workspaceId,
      branchName,
      title: "Ordinary Workbench",
    })

    const envOrd = serializeWorkbench(ordinary)
    expect(envOrd.version).toBe(COLLABORATION_DOMAIN_SCHEMA_VERSION)
    expect(envOrd.schema).toBe("LocalProjectWorkbench")

    const roundtripOrd = deserializeWorkbench(envOrd)
    expect(roundtripOrd).toEqual(ordinary)

    const sessionWb = createSessionWorkbench({
      projectId,
      workspaceId,
      branchName,
      sessionId,
      title: "Session Workbench",
    })

    const envSess = serializeWorkbench(sessionWb)
    const roundtripSess = deserializeWorkbench(envSess)
    expect(roundtripSess).toEqual(sessionWb)
  })

  it("rejects unsupported schema versions", () => {
    const ordinary = createOrdinaryWorkbench({
      projectId,
      workspaceId,
      title: "Test",
    })
    const env = serializeWorkbench(ordinary)
    const wrongVersionEnv = { ...env, version: 999 }

    expect(() => deserializeWorkbench(wrongVersionEnv)).toThrow(SerializationError)
    expect(() => deserializeWorkbench(wrongVersionEnv)).toThrow(/Unsupported schema version/)
  })

  it("forbids layout JSON on cloud Session descriptors (Section 5.1)", () => {
    const session: CollaborationSessionDescriptor = {
      sessionId,
      publicSessionId: "czs_abc",
      projectId,
      repositoryBindingId: asRepositoryBindingId("repo_1"),
      sessionBranch: branchName,
      targetBranch: asBranchName("main"),
      createdBy: "user_1",
      lifecycle: "ACTIVE",
      accessMode: "invite_only",
      organizationId: null,
      createdAt: 1000,
      updatedAt: 1000,
      pausedAt: null,
      closedAt: null,
      lastDurableSeq: 5,
      lastSnapshotSeq: 5,
      lastAutoGitCheckpointSeq: null,
      lastAutoGitCommitOid: null,
    }

    const env = serializeSessionDescriptor(session)
    const roundtrip = deserializeSessionDescriptor(env)
    expect(roundtrip).toEqual(session)

    // Attempting to attach dockview / layout JSON to Session descriptor must fail
    const contaminatedSession: any = {
      ...session,
      dockviewLayout: { panels: [] },
    }

    expect(() => serializeSessionDescriptor(contaminatedSession)).toThrow(SerializationError)
    expect(() => serializeSessionDescriptor(contaminatedSession)).toThrow(/Layout key/)
  })

  it("round-trips participant, lease, checkpoint, and rebase descriptors", () => {
    const participant: CollaborationParticipant = {
      sessionId,
      principalId: "principal_1",
      identityKey: "czd_test_key",
      displayName: "Alice",
      role: "developer",
      lifecycle: "CONNECTED",
      isLeader: true,
      joinedAt: 2000,
      lastSeenAt: 2100,
      leftAt: null,
    }
    expect(deserializeParticipant(serializeParticipant(participant))).toEqual(participant)

    const lease: AutoGitLease = {
      sessionId,
      leaderIdentityKey: "czd_test_key",
      leaseGeneration: 3,
      leaseExpiresAt: 30000,
      lastRenewedAt: 20000,
    }
    expect(deserializeAutoGitLease(serializeAutoGitLease(lease))).toEqual(lease)

    const checkpoint: AutoGitCheckpoint = {
      checkpointId: "chk_1",
      sessionId,
      barrierId: asBarrierId("bar_1"),
      sessionSeq: 42,
      stage: "COMPLETE",
      commitOid: "abc1234",
      parentOid: "def5678",
      treeOid: "tree999",
      logicalTreeHash: "hash_xyz",
      leaseGeneration: 3,
      createdAt: 4000,
      completedAt: 4050,
      errorMessage: null,
    }
    expect(deserializeAutoGitCheckpoint(serializeAutoGitCheckpoint(checkpoint))).toEqual(
      checkpoint,
    )

    const rebase: RebaseStatus = {
      sessionId,
      lifecycle: "SUGGESTED",
      targetBranch: asBranchName("main"),
      targetRemoteOid: "main_oid_123",
      mergeBaseOid: "base_oid_456",
      behindCommitCount: 12,
      aheadCommitCount: 3,
      recommended: true,
      recommendationReason: "Target branch moved ahead by 12 commits",
      requestedAt: null,
      completedAt: null,
      errorMessage: null,
    }
    expect(deserializeRebaseStatus(serializeRebaseStatus(rebase))).toEqual(rebase)
  })
})

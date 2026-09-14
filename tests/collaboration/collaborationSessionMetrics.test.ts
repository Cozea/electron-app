import { describe, expect, it } from "vitest"

import * as sessions from "../../convex/collaborationSessions"
import * as metrics from "../../convex/collaborationSessionMetrics"
import { FakeConvexDb, fakeConvexCtx, runConvexHandler } from "../helpers/fakeConvexCtx"

const IDENTITY_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"

function identityKeyFor(seed: number): string {
  let key = ""
  for (let i = 0; i < 26; i += 1) {
    key += IDENTITY_ALPHABET[(seed * 7 + i * 13) % IDENTITY_ALPHABET.length]
  }
  return `czd_${key}`
}

function seedDevice(db: FakeConvexDb, seed: number, displayName: string) {
  const identityKey = identityKeyFor(seed)
  const id = db.seed("devicePrincipals", {
    identityKey,
    displayName,
    platform: "darwin",
    encryptionPublicKeyJwk: "{}",
    encryptionPublicKeyAlgorithm: "ECDH-P256",
    encryptionFingerprint: `enc-${seed}`,
    signingPublicKeyJwk: "{}",
    signingPublicKeyAlgorithm: "ECDSA-P256-SHA256",
    signingFingerprint: `sig-${seed}`,
    status: "active",
    signingKeyVersion: 1,
    tokenValidAfter: 0,
  })
  const identity = { subject: identityKey, key_version: 1, token_issued_at: Math.floor(Date.now() / 1000) }
  return { id, identityKey, ctx: fakeConvexCtx(db, identity) }
}

function createWorld() {
  const db = new FakeConvexDb()
  const owner = seedDevice(db, 1, "Owner")
  const developer = seedDevice(db, 2, "Developer")
  const outsider = seedDevice(db, 3, "Outsider")
  const organizationId = db.seed("organizations", { name: "Org", groupId: "czg_orgalpha1", createdBy: owner.id })
  db.seed("organizationMembers", { organizationId, principalId: developer.id, role: "member" })
  const projectId = db.seed("projects", { name: "Demo", status: "active", createdBy: owner.id, organizationId })
  return { db, owner, developer, outsider, projectId }
}

describe("collaborationSessionMetrics and role management", () => {
  it("allows a session manager to update member roles and denies outsiders/viewers", async () => {
    const { owner, developer, outsider, projectId } = createWorld()

    // Owner creates session
    const created = (await runConvexHandler(sessions.create, owner.ctx, {
      projectId,
      repositoryBindingId: "repo_1",
      branchName: "feature/roles",
      targetBranch: "main",
      accessMode: "invite_only",
      sessionKeyVersion: 1,
      wrappedSessionKey: "key_enc",
    })) as { sessionId: string }

    // Developer is invited and joins session
    await runConvexHandler(sessions.inviteParticipant, owner.ctx, { sessionId: created.sessionId, targetPrincipalId: developer.id })
    await runConvexHandler(sessions.join, developer.ctx, { sessionId: created.sessionId })

    // Owner changes developer's role to viewer
    const updated = (await runConvexHandler(sessions.updateMemberRole, owner.ctx, {
      sessionId: created.sessionId,
      principalId: developer.id,
      role: "viewer",
    })) as { success: boolean; role: string }

    expect(updated.success).toBe(true)
    expect(updated.role).toBe("viewer")

    // Outsider cannot change roles
    await expect(
      runConvexHandler(sessions.updateMemberRole, outsider.ctx, {
        sessionId: created.sessionId,
        principalId: developer.id,
        role: "project_manager",
      }),
    ).rejects.toThrow()
  })

  it("returns baseline metrics when no persisted metrics record exists", async () => {
    const { owner, projectId } = createWorld()

    const created = (await runConvexHandler(sessions.create, owner.ctx, {
      projectId,
      repositoryBindingId: "repo_1",
      branchName: "feature/metrics",
      targetBranch: "main",
      sessionKeyVersion: 1,
      wrappedSessionKey: "key_enc",
    })) as { sessionId: string }

    const result = (await runConvexHandler(metrics.getMetrics, owner.ctx, {
      sessionId: created.sessionId,
    })) as any

    expect(result).not.toBeNull()
    expect(result.publicSessionId).toBeDefined()
    expect(result.totalOperations).toBe(0)
    expect(Array.isArray(result.memberContributions)).toBe(true)
    expect(Array.isArray(result.activityBuckets)).toBe(true)
  })

  it("records activity, updates buckets, and persists member work", async () => {
    const { owner, projectId } = createWorld()

    const created = (await runConvexHandler(sessions.create, owner.ctx, {
      projectId,
      repositoryBindingId: "repo_1",
      branchName: "feature/activity",
      targetBranch: "main",
      sessionKeyVersion: 1,
      wrappedSessionKey: "key_enc",
    })) as { sessionId: string }

    // Record activity
    await runConvexHandler(metrics.recordActivity, owner.ctx, {
      sessionId: created.sessionId,
      operationsDelta: 42,
      checkpointsDelta: 2,
      linesAddedDelta: 150,
      linesDeletedDelta: 30,
      activeTimeDeltaMs: 60000,
    })

    const result = (await runConvexHandler(metrics.getMetrics, owner.ctx, {
      sessionId: created.sessionId,
    })) as any

    expect(result.totalOperations).toBe(42)
    expect(result.totalCheckpoints).toBe(2)
    expect(result.activityBuckets.length).toBeGreaterThan(0)
    expect(result.activityBuckets[result.activityBuckets.length - 1].operations).toBe(42)

    const member = result.memberContributions.find((m: any) => String(m.principalId) === String(owner.id))
    expect(member).toBeDefined()
    expect(member.operationsCount).toBe(42)
    expect(member.linesAdded).toBe(150)
    expect(member.linesDeleted).toBe(30)
  })

  it("syncs Git leader and PR details", async () => {
    const { owner, projectId } = createWorld()

    const created = (await runConvexHandler(sessions.create, owner.ctx, {
      projectId,
      repositoryBindingId: "repo_1",
      branchName: "feature/pr",
      targetBranch: "main",
      sessionKeyVersion: 1,
      wrappedSessionKey: "key_enc",
    })) as { sessionId: string }

    await runConvexHandler(metrics.syncGitLeaderAndPR, owner.ctx, {
      sessionId: created.sessionId,
      activeGitLeader: {
        principalId: owner.id,
        identityKey: owner.identityKey,
        displayName: "Owner",
      },
      pullRequest: {
        number: 42,
        title: "feat(collab): session metrics",
        url: "https://github.com/org/repo/pull/42",
        state: "open",
        isDraft: false,
        ahead: 3,
        behind: 0,
        checkedAt: Date.now(),
      },
    })

    const result = (await runConvexHandler(metrics.getMetrics, owner.ctx, {
      sessionId: created.sessionId,
    })) as any

    expect(result.pullRequest?.number).toBe(42)
    expect(result.pullRequest?.state).toBe("open")
    expect(result.activeGitLeader?.displayName).toBe("Owner")
  })
})

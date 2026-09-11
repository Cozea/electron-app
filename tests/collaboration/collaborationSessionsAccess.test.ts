import { afterEach, beforeEach, describe, expect, it } from "vitest"

import * as sessions from "../../convex/collaborationSessions"
import { FakeConvexDb, fakeConvexCtx, runConvexHandler } from "../helpers/fakeConvexCtx"

/**
 * Behaviour of convex/collaborationSessions.ts against an in-memory Convex ctx.
 * Before the 2026-09-11 audit fix every function trusted caller-supplied principal
 * IDs and checked no project access; these cases pin the replacement rules.
 */

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
  const teammate = seedDevice(db, 2, "Teammate")
  const invitee = seedDevice(db, 3, "Invitee")
  const outsider = seedDevice(db, 4, "Outsider")
  const organizationId = db.seed("organizations", { name: "Org", groupId: "czg_orgalpha1", createdBy: owner.id })
  db.seed("organizationMembers", { organizationId, principalId: teammate.id, role: "member" })
  const projectId = db.seed("projects", { name: "Demo", status: "active", createdBy: owner.id, organizationId })
  const personalProjectId = db.seed("projects", { name: "Solo", status: "active", createdBy: owner.id })
  return { db, owner, teammate, invitee, outsider, projectId, personalProjectId, anonymous: fakeConvexCtx(db, null) }
}

function createArgs(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId,
    repositoryBindingId: "repo_1",
    branchName: "feature/live",
    targetBranch: "main",
    accessMode: "invite_only",
    ...overrides,
  }
}

async function createSession(world: ReturnType<typeof createWorld>, overrides: Record<string, unknown> = {}) {
  const created = await runConvexHandler<{ sessionId: string; publicSessionId: string }>(
    sessions.create,
    world.owner.ctx,
    createArgs(world.projectId, overrides),
  )
  return created
}

async function lifecycleOf(world: ReturnType<typeof createWorld>, sessionId: string) {
  return (await world.db.get(sessionId))?.lifecycle
}

describe("collaborationSessions access control", () => {
  it("rejects unauthenticated callers and hides sessions from them", async () => {
    const world = createWorld()
    await expect(runConvexHandler(sessions.create, world.anonymous, createArgs(world.projectId))).rejects.toThrow(
      /Authentication required/,
    )

    const { sessionId } = await createSession(world)
    expect(await runConvexHandler(sessions.listByProject, world.anonymous, { projectId: world.projectId })).toEqual([])
    expect(await runConvexHandler(sessions.get, world.anonymous, { sessionId })).toBeNull()
  })

  it("records the authenticated device as the creator and session manager", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world)

    expect((await world.db.get(sessionId))?.createdByPrincipalId).toBe(world.owner.id)
    const members = world.db.rows("collaborationSessionMembers")
    expect(members).toEqual([
      expect.objectContaining({ sessionId, principalId: world.owner.id, role: "project_manager", status: "active" }),
    ])
  })

  it("stops devices without project access from creating or reading sessions", async () => {
    const world = createWorld()
    await expect(
      runConvexHandler(sessions.create, world.outsider.ctx, createArgs(world.projectId)),
    ).rejects.toThrow(/cannot access this project/)

    const { sessionId, publicSessionId } = await createSession(world)
    expect(await runConvexHandler(sessions.listByProject, world.outsider.ctx, { projectId: world.projectId })).toEqual([])
    expect(await runConvexHandler(sessions.get, world.outsider.ctx, { sessionId })).toBeNull()
    expect(await runConvexHandler(sessions.getByPublicId, world.outsider.ctx, { publicSessionId })).toBeNull()
    expect(await runConvexHandler(sessions.listByProject, world.teammate.ctx, { projectId: world.projectId })).toHaveLength(1)
  })

  it("prevents a second live session on the same branch", async () => {
    const world = createWorld()
    await createSession(world)
    await expect(createSession(world)).rejects.toThrow(/already exists for branch 'feature\/live'/)
  })

  it("requires an invitation for invite-only sessions and grants project access on join", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world)

    await expect(runConvexHandler(sessions.join, world.invitee.ctx, { sessionId })).rejects.toThrow(/Invitation required/)

    await runConvexHandler(sessions.inviteParticipant, world.owner.ctx, { sessionId, targetPrincipalId: world.invitee.id })
    await runConvexHandler(sessions.join, world.invitee.ctx, { sessionId })

    expect(world.db.rows("projectMembers")).toEqual([
      expect.objectContaining({ projectId: world.projectId, principalId: world.invitee.id, role: "developer" }),
    ])
    expect(world.db.rows("collaborationSessionInvitations")[0]?.status).toBe("accepted")
  })

  it("lets only session or project managers invite people", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world)
    await expect(
      runConvexHandler(sessions.inviteParticipant, world.teammate.ctx, { sessionId, targetPrincipalId: world.invitee.id }),
    ).rejects.toThrow(/Only session or project managers/)
  })

  it("resolves an invitation only for the invited device and expires stale ones", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world)
    const { invitationId } = await runConvexHandler<{ invitationId: string }>(sessions.inviteParticipant, world.owner.ctx, {
      sessionId,
      targetPrincipalId: world.invitee.id,
    })

    await expect(
      runConvexHandler(sessions.resolveInvitation, world.outsider.ctx, { invitationId, accept: true }),
    ).rejects.toThrow(/Invitation not found/)

    await world.db.patch(invitationId, { expiresAt: Date.now() - 1 })
    const result = await runConvexHandler(sessions.resolveInvitation, world.invitee.ctx, { invitationId, accept: true })
    expect(result).toEqual({ accepted: false, reason: "expired" })
    expect((await world.db.get(invitationId))?.status).toBe("expired")
    expect(world.db.rows("collaborationSessionMembers")).toHaveLength(1)
  })

  it("delivers identity-key invitations to the invited device's inbox", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world)
    await runConvexHandler(sessions.inviteParticipant, world.owner.ctx, {
      sessionId,
      targetIdentityKey: world.invitee.identityKey.toUpperCase(),
      role: "viewer",
    })

    const inbox = await runConvexHandler<Array<{ invitationId: string; role: string }>>(
      sessions.listIncomingInvitations,
      world.invitee.ctx,
      {},
    )
    expect(inbox).toHaveLength(1)
    expect(await runConvexHandler(sessions.listIncomingInvitations, world.outsider.ctx, {})).toEqual([])

    const accepted = await runConvexHandler(sessions.resolveInvitation, world.invitee.ctx, {
      invitationId: inbox[0].invitationId,
      accept: true,
    })
    expect(accepted).toEqual(expect.objectContaining({ accepted: true, sessionId }))
    expect(world.db.rows("projectMembers")).toEqual([
      expect.objectContaining({ principalId: world.invitee.id, role: "viewer" }),
    ])
  })

  it("admits organization members to organization-available sessions and no one else", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world, { accessMode: "organization_available" })

    await runConvexHandler(sessions.join, world.teammate.ctx, { sessionId })
    expect(world.db.rows("collaborationSessionMembers")).toContainEqual(
      expect.objectContaining({ principalId: world.teammate.id, role: "developer", status: "active" }),
    )
    expect(world.db.rows("projectMembers")).toEqual([])

    await expect(runConvexHandler(sessions.join, world.outsider.ctx, { sessionId })).rejects.toThrow(/organization/)
    await expect(
      runConvexHandler(
        sessions.create,
        world.owner.ctx,
        createArgs(world.personalProjectId, { accessMode: "organization_available" }),
      ),
    ).rejects.toThrow(/Only organization projects/)
  })

  it("denies revoked devices", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world, { accessMode: "organization_available" })
    await runConvexHandler(sessions.join, world.teammate.ctx, { sessionId })
    await runConvexHandler(sessions.revokeMember, world.owner.ctx, { sessionId, memberPrincipalId: world.teammate.id })

    await expect(runConvexHandler(sessions.join, world.teammate.ctx, { sessionId })).rejects.toThrow(/revoked/)
  })

  it("keeps lifecycle changes on the session state machine and with managers", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world, { accessMode: "organization_available" })
    await runConvexHandler(sessions.join, world.teammate.ctx, { sessionId })

    await expect(runConvexHandler(sessions.pause, world.teammate.ctx, { sessionId })).rejects.toThrow(/managers/)

    await runConvexHandler(sessions.pause, world.owner.ctx, { sessionId })
    expect(await lifecycleOf(world, sessionId)).toBe("PAUSED")
    await runConvexHandler(sessions.resume, world.owner.ctx, { sessionId })
    expect(await lifecycleOf(world, sessionId)).toBe("ACTIVE")
    await runConvexHandler(sessions.close, world.owner.ctx, { sessionId })
    expect(await lifecycleOf(world, sessionId)).toBe("CLOSED")

    await expect(runConvexHandler(sessions.resume, world.owner.ctx, { sessionId })).rejects.toThrow(
      /closed session cannot become active/,
    )
    await runConvexHandler(sessions.leave, world.teammate.ctx, { sessionId })
    expect(await lifecycleOf(world, sessionId)).toBe("CLOSED")
    await expect(runConvexHandler(sessions.join, world.teammate.ctx, { sessionId })).rejects.toThrow(/closed/)
  })

  it("goes dormant when the last member leaves and active again on rejoin", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world)

    await runConvexHandler(sessions.leave, world.owner.ctx, { sessionId })
    expect(await lifecycleOf(world, sessionId)).toBe("DORMANT")

    await runConvexHandler(sessions.join, world.owner.ctx, { sessionId })
    expect(await lifecycleOf(world, sessionId)).toBe("ACTIVE")
  })
})

describe("collaborationSessions.getRoomAccessForServer", () => {
  const GATEWAY_SECRET = "gateway-secret-for-room-access-tests"
  let previousSecret: string | undefined

  beforeEach(() => {
    previousSecret = process.env.AI_GATEWAY_SECRET
    process.env.AI_GATEWAY_SECRET = GATEWAY_SECRET
  })

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.AI_GATEWAY_SECRET
    else process.env.AI_GATEWAY_SECRET = previousSecret
  })

  function roomAccess(world: ReturnType<typeof createWorld>, publicSessionId: string, principalId: string, serverSecret = GATEWAY_SECRET) {
    return runConvexHandler(sessions.getRoomAccessForServer, world.anonymous, { publicSessionId, principalId, serverSecret })
  }

  it("refuses callers without the gateway secret", async () => {
    const world = createWorld()
    const { publicSessionId } = await createSession(world)

    await expect(roomAccess(world, publicSessionId, world.owner.id, "wrong-secret")).rejects.toThrow(/Unauthorized/)
    delete process.env.AI_GATEWAY_SECRET
    await expect(roomAccess(world, publicSessionId, world.owner.id, "")).rejects.toThrow(/Unauthorized/)
  })

  it("admits active members of an active session with their session role", async () => {
    const world = createWorld()
    const { sessionId, publicSessionId } = await createSession(world, { accessMode: "organization_available" })
    await runConvexHandler(sessions.join, world.teammate.ctx, { sessionId })

    expect(await roomAccess(world, publicSessionId, world.owner.id)).toEqual({
      allowed: true,
      projectId: world.projectId,
      role: "project_manager",
    })
    expect(await roomAccess(world, publicSessionId, world.teammate.id)).toEqual({
      allowed: true,
      projectId: world.projectId,
      role: "developer",
    })
  })

  it("denies non-members, revoked members, unknown sessions, and sessions that are not active", async () => {
    const world = createWorld()
    const { sessionId, publicSessionId } = await createSession(world, { accessMode: "organization_available" })
    await runConvexHandler(sessions.join, world.teammate.ctx, { sessionId })

    expect(await roomAccess(world, publicSessionId, world.outsider.id)).toEqual({
      allowed: false,
      reason: expect.stringMatching(/Join the session/),
    })
    expect(await roomAccess(world, "czs_ffffffffffffffff", world.owner.id)).toEqual({
      allowed: false,
      reason: expect.stringMatching(/not found/),
    })

    await runConvexHandler(sessions.revokeMember, world.owner.ctx, { sessionId, memberPrincipalId: world.teammate.id })
    expect(await roomAccess(world, publicSessionId, world.teammate.id)).toMatchObject({ allowed: false })

    await runConvexHandler(sessions.pause, world.owner.ctx, { sessionId })
    expect(await roomAccess(world, publicSessionId, world.owner.id)).toEqual({
      allowed: false,
      reason: expect.stringMatching(/paused/),
    })
  })
})

describe("collaborationSessions session room keys", () => {
  const WRAP = "ECDH-P256+A256GCM"

  function keyFor(device: { ctx: unknown }, sessionId: string) {
    return runConvexHandler(sessions.getSessionKeyForDevice, device.ctx, { sessionId })
  }

  it("lets the first writer create the key and gives each device only its own copy", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world, { accessMode: "organization_available" })

    expect(await keyFor(world.owner, sessionId)).toEqual({ status: "not_initialized", keyVersion: 1 })
    const init = { sessionId, wrapAlgorithm: WRAP, wrappedKey: "wrapped-for-owner" }
    expect(await runConvexHandler(sessions.initializeSessionKey, world.owner.ctx, init)).toEqual({ created: true, keyVersion: 1 })
    expect(await runConvexHandler(sessions.initializeSessionKey, world.owner.ctx, init)).toEqual({ created: false, keyVersion: 1 })
    expect(await keyFor(world.owner, sessionId)).toMatchObject({ status: "ready", wrappedKey: "wrapped-for-owner" })

    await runConvexHandler(sessions.join, world.teammate.ctx, { sessionId })
    expect(await keyFor(world.teammate, sessionId)).toEqual({ status: "missing_for_device", keyVersion: 1 })
    expect(await runConvexHandler(sessions.listMembersNeedingSessionKey, world.teammate.ctx, { sessionId })).toEqual([])
    expect(await runConvexHandler(sessions.listMembersNeedingSessionKey, world.owner.ctx, { sessionId })).toEqual([
      expect.objectContaining({ principalId: world.teammate.id, identityKey: world.teammate.identityKey }),
    ])

    const share = { sessionId, recipientPrincipalId: world.teammate.id, wrapAlgorithm: WRAP, wrappedKey: "wrapped-for-teammate" }
    expect(await runConvexHandler(sessions.shareSessionKey, world.owner.ctx, share)).toEqual({ shared: true })
    expect(await runConvexHandler(sessions.shareSessionKey, world.owner.ctx, share)).toEqual({ shared: false })
    expect(await keyFor(world.teammate, sessionId)).toMatchObject({
      status: "ready",
      wrappedKey: "wrapped-for-teammate",
      senderPublicKeyJwk: "{}",
    })
    expect(await runConvexHandler(sessions.listMembersNeedingSessionKey, world.owner.ctx, { sessionId })).toEqual([])
  })

  it("keeps the key from non-members, devices without it, and revoked members", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world, { accessMode: "organization_available" })
    await runConvexHandler(sessions.initializeSessionKey, world.owner.ctx, { sessionId, wrapAlgorithm: WRAP, wrappedKey: "k" })
    await runConvexHandler(sessions.join, world.teammate.ctx, { sessionId })

    await expect(keyFor(world.outsider, sessionId)).rejects.toThrow(/Join the session/)
    await expect(
      runConvexHandler(sessions.shareSessionKey, world.owner.ctx, {
        sessionId,
        recipientPrincipalId: world.outsider.id,
        wrapAlgorithm: WRAP,
        wrappedKey: "k",
      }),
    ).rejects.toThrow(/not an active member/)
    await expect(
      runConvexHandler(sessions.shareSessionKey, world.teammate.ctx, {
        sessionId,
        recipientPrincipalId: world.owner.id,
        wrapAlgorithm: WRAP,
        wrappedKey: "k",
      }),
    ).rejects.toThrow(/hold the session key/)

    await runConvexHandler(sessions.shareSessionKey, world.owner.ctx, {
      sessionId,
      recipientPrincipalId: world.teammate.id,
      wrapAlgorithm: WRAP,
      wrappedKey: "k2",
    })
    await runConvexHandler(sessions.revokeMember, world.owner.ctx, { sessionId, memberPrincipalId: world.teammate.id })
    expect(
      world.db.rows("collaborationSessionKeys").find((copy) => copy.recipientPrincipalId === world.teammate.id)?.revokedAt,
    ).toEqual(expect.any(Number))
    await expect(keyFor(world.teammate, sessionId)).rejects.toThrow(/Join the session/)
  })

  it("does not let a viewer create the key", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world)
    await runConvexHandler(sessions.inviteParticipant, world.owner.ctx, {
      sessionId,
      targetPrincipalId: world.invitee.id,
      role: "viewer",
    })
    await runConvexHandler(sessions.join, world.invitee.ctx, { sessionId })

    await expect(
      runConvexHandler(sessions.initializeSessionKey, world.invitee.ctx, { sessionId, wrapAlgorithm: WRAP, wrappedKey: "k" }),
    ).rejects.toThrow(/Viewers cannot create/)
  })
})

describe("collaborationSessions members for the session bar", () => {
  it("lists the session's members for devices with project access and marks the caller", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world, { accessMode: "organization_available" })
    await runConvexHandler(sessions.join, world.teammate.ctx, { sessionId })

    expect(await runConvexHandler(sessions.listMembers, world.owner.ctx, { sessionId })).toEqual([
      { principalId: world.owner.id, displayName: "Owner", role: "project_manager", status: "active", isSelf: true },
      { principalId: world.teammate.id, displayName: "Teammate", role: "developer", status: "active", isSelf: false },
    ])
    expect(await runConvexHandler(sessions.listMembers, world.outsider.ctx, { sessionId })).toEqual([])
    expect(await runConvexHandler(sessions.listMembers, world.anonymous, { sessionId })).toEqual([])

    // Revoked devices drop out of the list.
    await runConvexHandler(sessions.revokeMember, world.owner.ctx, { sessionId, memberPrincipalId: world.teammate.id })
    expect(await runConvexHandler(sessions.listMembers, world.owner.ctx, { sessionId })).toEqual([
      expect.objectContaining({ principalId: world.owner.id }),
    ])
  })

  it("tells each device its own membership in the project's sessions", async () => {
    const world = createWorld()
    const { sessionId } = await createSession(world, { accessMode: "organization_available" })
    const membershipOf = async (device: { ctx: unknown }) =>
      (
        await runConvexHandler<Array<{ viewerMembership: string | null }>>(sessions.listByProject, device.ctx, {
          projectId: world.projectId,
        })
      )[0]?.viewerMembership

    expect(await membershipOf(world.owner)).toBe("active")
    expect(await membershipOf(world.teammate)).toBeNull()
    await runConvexHandler(sessions.join, world.teammate.ctx, { sessionId })
    expect(await membershipOf(world.teammate)).toBe("active")
    await runConvexHandler(sessions.leave, world.teammate.ctx, { sessionId })
    expect(await membershipOf(world.teammate)).toBe("left")
  })
})

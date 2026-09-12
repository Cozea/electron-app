/**
 * Collaboration Sessions control plane mutations and queries.
 *
 * Master Specification: Section 4.1, 6.1 - 6.8, 25.1 - 25.4
 *
 * Every function acts for the authenticated device. Caller identity never comes from
 * arguments, access is checked against the session's project, and lifecycle changes
 * follow the shared session state machine.
 */

import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import { query as publicQuery, mutation as publicMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server"
import { lifecycleFenceValidator } from "./lib/sessionLifecycle"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { requireAuthenticatedDevice, type DevicePrincipal } from "./lib/deviceAuth"
import { isOrgMember } from "./lib/orgAccess"
import { canAccessProject, canEditProject, canManageProject } from "./lib/projectAccess"
import { isDeviceIdentityKey, normalizeDeviceIdentityKey } from "../shared/deviceIdentity"
import { canTransitionSessionLifecycle } from "../shared/collaboration/stateMachines"
import { normalizeSessionRepositoryUrl } from "../shared/collaboration/repositoryUrl"

type Session = Doc<"collaborationSessions">
type SessionMember = Doc<"collaborationSessionMembers">
type SessionInvitation = Doc<"collaborationSessionInvitations">
type SessionLifecycle = Session["lifecycle"]
type SessionRole = SessionMember["role"]

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const sessionRole = v.union(v.literal("viewer"), v.literal("developer"), v.literal("project_manager"))

// ─── Access helpers ───────────────────────────────────────────────────────────

async function getCallerOrNull(ctx: QueryCtx): Promise<DevicePrincipal | null> {
  try {
    return await requireAuthenticatedDevice(ctx)
  } catch (error) {
    if (error instanceof ConvexError) return null
    throw error
  }
}

async function readableSession(ctx: QueryCtx, session: Session | null): Promise<Session | null> {
  if (!session) return null
  const caller = await getCallerOrNull(ctx)
  if (!caller) return null
  return (await canAccessProject(ctx, session.projectId, caller._id)) ? session : null
}

async function requireSession(ctx: MutationCtx, sessionId: Id<"collaborationSessions">): Promise<Session> {
  const session = await ctx.db.get(sessionId)
  if (!session) {
    throw new ConvexError("Collaboration session not found")
  }
  return session
}

async function getMembership(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"collaborationSessions">,
  principalId: Id<"devicePrincipals">,
): Promise<SessionMember | null> {
  return await ctx.db
    .query("collaborationSessionMembers")
    .withIndex("by_session_and_principal", (q) => q.eq("sessionId", sessionId).eq("principalId", principalId))
    .first()
}

async function hasActiveMembers(ctx: MutationCtx, sessionId: Id<"collaborationSessions">): Promise<boolean> {
  const member = await ctx.db
    .query("collaborationSessionMembers")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .filter((q) => q.eq(q.field("status"), "active"))
    .first()
  return member !== null
}

/** Pause, resume, close, invite and revoke are global actions for session or project managers (Section 25.4). */
async function requireSessionManager(ctx: MutationCtx, session: Session, caller: DevicePrincipal): Promise<void> {
  const membership = await getMembership(ctx, session._id, caller._id)
  if (membership?.status === "active" && membership.role === "project_manager") return
  if (await canManageProject(ctx, session.projectId, caller._id)) return
  throw new ConvexError("Only session or project managers can do that")
}

/** Walks the session state machine so every intermediate state is a legal step (Section 4.1). */
function walkLifecycle(from: SessionLifecycle, steps: readonly SessionLifecycle[]): SessionLifecycle {
  let current = from
  for (const next of steps) {
    if (!canTransitionSessionLifecycle(current, next)) {
      throw new ConvexError(`A ${current.toLowerCase()} session cannot become ${next.toLowerCase()}`)
    }
    current = next
  }
  return current
}

function isClosedOrClosing(session: Session): boolean {
  return session.lifecycle === "CLOSED" || session.lifecycle === "CLOSING"
}

function isInvitationFor(invite: SessionInvitation, caller: DevicePrincipal): boolean {
  return (
    invite.targetPrincipalId === caller._id ||
    (invite.targetIdentityKey !== undefined &&
      invite.targetIdentityKey === normalizeDeviceIdentityKey(caller.identityKey))
  )
}

async function findPendingInvitation(
  ctx: MutationCtx,
  sessionId: Id<"collaborationSessions">,
  caller: DevicePrincipal,
  now: number,
): Promise<SessionInvitation | null> {
  const pending = await ctx.db
    .query("collaborationSessionInvitations")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .filter((q) => q.eq(q.field("status"), "pending"))
    .collect()
  return pending.find((invite) => invite.expiresAt > now && isInvitationFor(invite, caller)) ?? null
}

/**
 * Accepting a session invitation grants project access when the device has none
 * (Section 6.3). The grant never exceeds developer: a session role does not make
 * anyone a project manager.
 */
async function ensureProjectAccess(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  principalId: Id<"devicePrincipals">,
  role: SessionRole,
  addedBy: Id<"devicePrincipals">,
  now: number,
): Promise<void> {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    throw new ConvexError("Project not found")
  }
  if (await canAccessProject(ctx, projectId, principalId)) return
  await ctx.db.insert("projectMembers", {
    projectId,
    principalId,
    role: role === "viewer" ? "viewer" : "developer",
    addedAt: now,
    addedBy,
  })
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export const get = publicQuery({
  args: { sessionId: v.id("collaborationSessions") },
  handler: async (ctx, args) => {
    return await readableSession(ctx, await ctx.db.get(args.sessionId))
  },
})

export const getByPublicId = publicQuery({
  args: { publicSessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_public_session_id", (q) => q.eq("publicSessionId", args.publicSessionId))
      .first()
    return await readableSession(ctx, session)
  },
})

// Returns an empty list instead of throwing for callers without access, because
// ProjectLayout reads it on every project open. Each session carries the caller's own
// membership status (null when not a member), so the app knows which sessions it is in.
export const listByProject = publicQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const caller = await getCallerOrNull(ctx)
    if (!caller || !(await canAccessProject(ctx, args.projectId, caller._id))) {
      return []
    }
    const sessions = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.neq(q.field("lifecycle"), "CLOSED"))
      .collect()
    const results = []
    for (const session of sessions) {
      const membership = await getMembership(ctx, session._id, caller._id)
      results.push({ ...session, viewerMembership: membership?.status ?? null })
    }
    return results
  },
})

/** The session's members, for the session bar and the Share dialog; empty for callers without project access. */
export const listMembers = publicQuery({
  args: { sessionId: v.id("collaborationSessions") },
  handler: async (ctx, args) => {
    const caller = await getCallerOrNull(ctx)
    const session = await ctx.db.get(args.sessionId)
    if (!caller || !session || !(await canAccessProject(ctx, session.projectId, caller._id))) {
      return []
    }
    const members = await ctx.db
      .query("collaborationSessionMembers")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect()
    const results = []
    for (const member of members) {
      if (member.status === "revoked") continue
      const principal = await ctx.db.get(member.principalId)
      results.push({
        principalId: member.principalId,
        displayName: principal?.displayName ?? "A Cozea device",
        role: member.role,
        status: member.status,
        isSelf: member.principalId === caller._id,
      })
    }
    return results
  },
})

export const listIncomingInvitations = query({
  args: {},
  handler: async (ctx) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const now = Date.now()

    const byPrincipal = await ctx.db
      .query("collaborationSessionInvitations")
      .withIndex("by_target_principal", (q) => q.eq("targetPrincipalId", caller._id))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect()
    const byIdentity = await ctx.db
      .query("collaborationSessionInvitations")
      .withIndex("by_target_identity", (q) =>
        q.eq("targetIdentityKey", normalizeDeviceIdentityKey(caller.identityKey)),
      )
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect()

    const invitations = new Map<Id<"collaborationSessionInvitations">, SessionInvitation>()
    for (const invite of [...byPrincipal, ...byIdentity]) {
      if (invite.expiresAt > now) invitations.set(invite._id, invite)
    }

    const results = []
    for (const invite of invitations.values()) {
      const session = await ctx.db.get(invite.sessionId)
      const project = await ctx.db.get(invite.projectId)
      const inviter = await ctx.db.get(invite.createdByPrincipalId)

      if (session && project && session.lifecycle !== "CLOSED") {
        results.push({
          invitationId: invite._id,
          sessionId: session._id,
          publicSessionId: session.publicSessionId,
          projectId: project._id,
          projectName: project.name,
          branchName: session.branchName,
          targetBranch: session.targetBranch,
          repositoryUrl: session.repositoryUrl ?? null,
          shareEnvironmentFiles: session.shareEnvironmentFiles === true,
          role: invite.role,
          sessionLifecycle: session.lifecycle,
          inviterName: inviter?.displayName ?? "A team member",
          expiresAt: invite.expiresAt,
          createdAt: invite.createdAt,
        })
      }
    }

    return results
  },
})

function requireGatewaySecret(serverSecret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || serverSecret !== expected) {
    throw new ConvexError("Unauthorized")
  }
}

// Server-only admission check for the gateway's session-room route (Section 13.1).
export const getRoomAccessForServer = publicQuery({
  args: {
    publicSessionId: v.string(),
    principalId: v.id("devicePrincipals"),
    serverSecret: v.string(),
    recovery: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireGatewaySecret(args.serverSecret)

    const session = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_public_session_id", (q) => q.eq("publicSessionId", args.publicSessionId))
      .first()
    if (!session) {
      return { allowed: false as const, reason: "Collaboration session not found" }
    }
    if (args.recovery ? !["PAUSED", "CLOSED"].includes(session.lifecycle) : session.lifecycle !== "ACTIVE") {
      return {
        allowed: false as const,
        reason: `The session is ${session.lifecycle.toLowerCase()}; resume or rejoin it first`,
      }
    }
    const member = await getMembership(ctx, session._id, args.principalId)
    const device = await ctx.db.get(args.principalId)
    if (!device || device.status !== "active") {
      return { allowed: false as const, reason: "The device identity is no longer active" }
    }
    if (!member || member.status !== "active") {
      return { allowed: false as const, reason: "Join the session before connecting to it" }
    }
    if (!(await canAccessProject(ctx, session.projectId, args.principalId))) {
      return { allowed: false as const, reason: "The device cannot access this project" }
    }
    return {
      allowed: true as const,
      projectId: session.projectId,
      role: member.role,
      keyVersion: activeSessionKeyVersion(session),
      lifecycleRevision: session.lifecycleRevision ?? 0,
    }
  },
})

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Internal authorization boundary for repository credentials; no caller-selected repo. */
export const repositoryCredentialScope = internalQuery({
  args: { publicSessionId: v.string() },
  returns: v.object({ projectId: v.id("projects"), repositoryUrl: v.string() }),
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await ctx.db.query("collaborationSessions").withIndex("by_public_session_id", (q) => q.eq("publicSessionId", args.publicSessionId)).unique()
    if (!session || session.lifecycle !== "ACTIVE") throw new ConvexError("Session repository access is unavailable")
    const member = await getMembership(ctx, session._id, caller._id)
    if (member?.status !== "active" || member.role === "viewer" || !await canEditProject(ctx, session.projectId, caller._id)) {
      throw new ConvexError("Session repository access is unavailable")
    }
    const project = await ctx.db.get(session.projectId)
    const repositoryUrl = normalizeSessionRepositoryUrl(project?.repo?.url)
    if (project?.repo?.provider !== "github" || !repositoryUrl || repositoryUrl !== normalizeSessionRepositoryUrl(session.repositoryUrl)) {
      throw new ConvexError("Session repository binding must match the project")
    }
    return { projectId: session.projectId, repositoryUrl }
  },
})

// The authenticated builder requires edit access to args.projectId before this runs.
export const create = mutation({
  args: {
    projectId: v.id("projects"),
    repositoryBindingId: v.string(),
    branchName: v.string(),
    targetBranch: v.string(),
    accessMode: v.union(v.literal("invite_only"), v.literal("organization_available")),
    organizationId: v.optional(v.id("organizations")),
    /** The folder's Git remote, which invitees clone. Dropped unless it is a shareable network URL. */
    repositoryUrl: v.optional(v.string()),
    /** Share env files (.env) through the session although Git ignores them. */
    shareEnvironmentFiles: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const branchName = args.branchName.trim()
    const targetBranch = args.targetBranch.trim()
    if (!branchName || !targetBranch) {
      throw new ConvexError("Session and target branch names are required")
    }

    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") {
      throw new ConvexError("Project not found")
    }

    // Organization availability is tied to the project's own organization (Section 6.4).
    let organizationId: Id<"organizations"> | undefined
    if (args.accessMode === "organization_available") {
      if (!project.organizationId) {
        throw new ConvexError("Only organization projects can make a session available to the organization")
      }
      if (args.organizationId && args.organizationId !== project.organizationId) {
        throw new ConvexError("The session's organization must be the project's organization")
      }
      organizationId = project.organizationId
    }

    // Check branch uniqueness: no duplicate non-closed session for the same branch (Section 6.1)
    const existing = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_project_and_branch", (q) =>
        q.eq("projectId", args.projectId).eq("branchName", branchName),
      )
      .filter((q) => q.neq(q.field("lifecycle"), "CLOSED"))
      .first()

    if (existing) {
      throw new ConvexError(
        `A non-closed collaboration session already exists for branch '${branchName}' (session: ${existing.publicSessionId})`,
      )
    }

    const now = Date.now()
    const publicSessionId = `czs_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`

    const sessionId = await ctx.db.insert("collaborationSessions", {
      publicSessionId,
      projectId: args.projectId,
      repositoryBindingId: args.repositoryBindingId,
      branchName,
      targetBranch,
      repositoryUrl: normalizeSessionRepositoryUrl(args.repositoryUrl) ?? undefined,
      shareEnvironmentFiles: args.shareEnvironmentFiles === true,
      createdByPrincipalId: caller._id,
      lifecycle: "ACTIVE",
      accessMode: args.accessMode,
      organizationId,
      createdAt: now,
      updatedAt: now,
      pausedAt: undefined,
      closedAt: undefined,
      activeKeyVersion: INITIAL_SESSION_KEY_VERSION,
      lastDurableSeq: 0,
      lastSnapshotSeq: 0,
      lastAutoGitCheckpointSeq: undefined,
      lastAutoGitCommitOid: undefined,
    })

    // Add creator as project_manager member
    await ctx.db.insert("collaborationSessionMembers", {
      sessionId,
      projectId: args.projectId,
      principalId: caller._id,
      role: "project_manager",
      status: "active",
      joinedAt: now,
    })

    // Initialize AutoGit election state
    await ctx.db.insert("collaborationAutoGit", {
      sessionId,
      leaderIdentityKey: undefined,
      leaseGeneration: 0,
      leaseExpiresAt: 0,
      updatedAt: now,
    })

    return { sessionId, publicSessionId }
  },
})

/**
 * Records the Git remote invitees clone from, for sessions started before sessions
 * carried one. Only a member who can edit records it, and only while none is recorded,
 * so nobody can later point invitees at a different repository.
 */
export const recordRepository = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
    repositoryUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await requireSession(ctx, args.sessionId)
    if (isClosedOrClosing(session)) {
      throw new ConvexError("Session no longer available")
    }
    const membership = await getMembership(ctx, session._id, caller._id)
    if (
      membership?.status !== "active" ||
      membership.role === "viewer" ||
      !(await canEditProject(ctx, session.projectId, caller._id))
    ) {
      throw new ConvexError("Only members who can edit the session can record its repository")
    }
    if (session.repositoryUrl) {
      return { recorded: false as const, repositoryUrl: session.repositoryUrl }
    }
    const repositoryUrl = normalizeSessionRepositoryUrl(args.repositoryUrl)
    if (!repositoryUrl) {
      throw new ConvexError("Only https and ssh Git remotes can be shared with invitees")
    }
    await ctx.db.patch(session._id, { repositoryUrl, updatedAt: Date.now() })
    return { recorded: true as const, repositoryUrl }
  },
})

export const inviteParticipant = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
    targetPrincipalId: v.optional(v.id("devicePrincipals")),
    targetIdentityKey: v.optional(v.string()),
    role: v.optional(sessionRole),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await requireSession(ctx, args.sessionId)
    if (isClosedOrClosing(session)) {
      throw new ConvexError("Cannot invite people to a closed collaboration session")
    }
    await requireSessionManager(ctx, session, caller)

    let targetPrincipalId = args.targetPrincipalId
    let targetIdentityKey = args.targetIdentityKey ? normalizeDeviceIdentityKey(args.targetIdentityKey) : undefined
    if (targetIdentityKey && !isDeviceIdentityKey(targetIdentityKey)) {
      throw new ConvexError("The invitation target is not a Cozea device identity")
    }
    if (targetPrincipalId) {
      const target = await ctx.db.get(targetPrincipalId)
      if (!target) {
        throw new ConvexError("Invited device not found")
      }
      if (target.identityKey) {
        targetIdentityKey = normalizeDeviceIdentityKey(target.identityKey)
      }
    } else if (targetIdentityKey) {
      const identityKey = targetIdentityKey
      const target = await ctx.db
        .query("devicePrincipals")
        .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey))
        .unique()
      targetPrincipalId = target?._id
    } else {
      throw new ConvexError("Choose who to invite")
    }
    if (targetPrincipalId === caller._id) {
      throw new ConvexError("You are already in this session")
    }

    const now = Date.now()
    // One pending invitation per target keeps the Inbox free of duplicates.
    const pending = await ctx.db
      .query("collaborationSessionInvitations")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect()
    const duplicate = pending.find(
      (invite) =>
        invite.expiresAt > now &&
        ((targetPrincipalId !== undefined && invite.targetPrincipalId === targetPrincipalId) ||
          (targetIdentityKey !== undefined && invite.targetIdentityKey === targetIdentityKey)),
    )
    if (duplicate) {
      return { invitationId: duplicate._id, duplicate: true }
    }

    const invitationId = await ctx.db.insert("collaborationSessionInvitations", {
      sessionId: session._id,
      projectId: session.projectId,
      targetPrincipalId,
      targetIdentityKey,
      role: args.role ?? "developer",
      status: "pending",
      createdByPrincipalId: caller._id,
      createdAt: now,
      expiresAt: now + INVITATION_TTL_MS,
    })

    return { invitationId, duplicate: false }
  },
})

export const join = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await requireSession(ctx, args.sessionId)
    if (isClosedOrClosing(session)) {
      throw new ConvexError("Cannot join closed collaboration session")
    }

    const now = Date.now()
    const existingMember = await getMembership(ctx, session._id, caller._id)
    if (existingMember?.status === "revoked") {
      throw new ConvexError("Device access to this session has been revoked")
    }

    let memberId: Id<"collaborationSessionMembers">
    if (existingMember) {
      // Membership is sticky, but still requires access to the project today.
      if (!(await canAccessProject(ctx, session.projectId, caller._id))) {
        throw new ConvexError("You no longer have access to this project")
      }
      if (existingMember.status === "left") {
        await ctx.db.patch(existingMember._id, { status: "active", joinedAt: now, leftAt: undefined })
      }
      memberId = existingMember._id
    } else if (session.accessMode === "invite_only") {
      const invite = await findPendingInvitation(ctx, session._id, caller, now)
      if (!invite) {
        throw new ConvexError("Invitation required to join this invite-only session")
      }
      await ensureProjectAccess(ctx, session.projectId, caller._id, invite.role, invite.createdByPrincipalId, now)
      await ctx.db.patch(invite._id, { status: "accepted", resolvedAt: now })
      memberId = await ctx.db.insert("collaborationSessionMembers", {
        sessionId: session._id,
        projectId: session.projectId,
        principalId: caller._id,
        role: invite.role,
        status: "active",
        joinedAt: now,
      })
    } else {
      // Organization-available sessions admit members of the project's organization
      // and never grant project permissions they do not already have (Section 6.4).
      const project = await ctx.db.get(session.projectId)
      if (
        !project ||
        project.status === "deleted" ||
        !session.organizationId ||
        project.organizationId !== session.organizationId ||
        !(await isOrgMember(ctx, session.organizationId, caller._id)) ||
        !(await canAccessProject(ctx, session.projectId, caller._id))
      ) {
        throw new ConvexError("Only members of the project's organization can join this session")
      }
      const role = (await canEditProject(ctx, session.projectId, caller._id)) ? "developer" : "viewer"
      memberId = await ctx.db.insert("collaborationSessionMembers", {
        sessionId: session._id,
        projectId: session.projectId,
        principalId: caller._id,
        role,
        status: "active",
        joinedAt: now,
      })
    }

    // If session was DORMANT, revive to ACTIVE
    if (session.lifecycle === "DORMANT") {
      await ctx.db.patch(session._id, { lifecycle: "ACTIVE", updatedAt: now })
    }

    return { memberId, status: "active" as const }
  },
})

export const leave = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await requireSession(ctx, args.sessionId)
    const member = await getMembership(ctx, session._id, caller._id)
    if (!member || member.status !== "active") {
      return { success: true }
    }

    const now = Date.now()
    await ctx.db.patch(member._id, { status: "left", leftAt: now })

    // Zero participants makes an ACTIVE session DORMANT; leaving never closes or
    // reopens a session (Section 4.1, C32, C33).
    if (session.lifecycle === "ACTIVE" && !(await hasActiveMembers(ctx, session._id))) {
      await ctx.db.patch(session._id, { lifecycle: "DORMANT", updatedAt: now })
    }

    return { success: true }
  },
})

// ─── Session room keys (Section 26.2) ─────────────────────────────────────────
// The room key encrypts every session batch end to end. The first active writer
// creates it and wraps a copy for its own device; any device holding it wraps a
// copy for each member who joins later. The server only ever stores wrapped copies.

const INITIAL_SESSION_KEY_VERSION = 1

function activeSessionKeyVersion(session: Session): number {
  return Math.max(INITIAL_SESSION_KEY_VERSION, Math.floor(session.activeKeyVersion ?? INITIAL_SESSION_KEY_VERSION))
}

async function requireActiveMember(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"collaborationSessions">,
  caller: DevicePrincipal,
): Promise<SessionMember> {
  const member = await getMembership(ctx, sessionId, caller._id)
  if (!member || member.status !== "active") {
    throw new ConvexError("Join the session first")
  }
  return member
}

async function findSessionKeyCopy(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"collaborationSessions">,
  identityKey: string,
  keyVersion: number,
): Promise<Doc<"collaborationSessionKeys"> | null> {
  const copies = await ctx.db
    .query("collaborationSessionKeys")
    .withIndex("by_session_and_recipient", (q) =>
      q.eq("sessionId", sessionId).eq("recipientIdentityKey", normalizeDeviceIdentityKey(identityKey)),
    )
    .collect()
  return (
    copies
      .filter((copy) => copy.keyVersion === keyVersion && copy.revokedAt === undefined)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  )
}

async function sessionKeyExists(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"collaborationSessions">,
  keyVersion: number,
): Promise<boolean> {
  const copy = await ctx.db
    .query("collaborationSessionKeys")
    .withIndex("by_session_and_version", (q) => q.eq("sessionId", sessionId).eq("keyVersion", keyVersion))
    .first()
  return copy !== null
}

/** The calling device's wrapped copy of the session room key, or why it has none. */
export const getSessionKeyForDevice = query({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await ctx.db.get(args.sessionId)
    if (!session) {
      throw new ConvexError("Collaboration session not found")
    }
    await requireActiveMember(ctx, session._id, caller)

    const keyVersion = activeSessionKeyVersion(session)
    const copy = await findSessionKeyCopy(ctx, session._id, caller.identityKey, keyVersion)
    if (copy) {
      return {
        status: "ready" as const,
        keyVersion: copy.keyVersion,
        wrappedKey: copy.wrappedKey,
        wrapAlgorithm: copy.wrapAlgorithm,
        senderPublicKeyJwk: copy.senderPublicKeyJwk,
      }
    }
    return {
      status: (await sessionKeyExists(ctx, session._id, keyVersion))
        ? ("missing_for_device" as const)
        : ("not_initialized" as const),
      keyVersion,
    }
  },
})

/** Every still-authorized wrapped key generation this active device may need for replay. */
export const getSessionKeyringForDevice = query({
  args: { sessionId: v.id("collaborationSessions") },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await ctx.db.get(args.sessionId)
    if (!session) throw new ConvexError("Collaboration session not found")
    await requireActiveMember(ctx, session._id, caller)
    const activeKeyVersion = activeSessionKeyVersion(session)
    const identityKey = normalizeDeviceIdentityKey(caller.identityKey)
    const copies = await ctx.db
      .query("collaborationSessionKeys")
      .withIndex("by_session_and_recipient", (q) => q.eq("sessionId", session._id).eq("recipientIdentityKey", identityKey))
      .collect()
    return {
      activeKeyVersion,
      keys: copies
        .filter((copy) => copy.revokedAt === undefined && copy.keyVersion <= activeKeyVersion)
        .sort((a, b) => a.keyVersion - b.keyVersion)
        .map((copy) => ({
          keyVersion: copy.keyVersion,
          wrappedKey: copy.wrappedKey,
          wrapAlgorithm: copy.wrapAlgorithm,
          senderPublicKeyJwk: copy.senderPublicKeyJwk,
        })),
    }
  },
})

/** Stores the first copy of a new session key, wrapped by the calling device for itself. */
export const initializeSessionKey = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
    wrapAlgorithm: v.string(),
    wrappedKey: v.string(),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await requireSession(ctx, args.sessionId)
    if (isClosedOrClosing(session)) {
      throw new ConvexError("This session is closed")
    }
    const member = await requireActiveMember(ctx, session._id, caller)
    if (member.role === "viewer") {
      throw new ConvexError("Viewers cannot create the session key")
    }
    const keyVersion = activeSessionKeyVersion(session)
    if (await sessionKeyExists(ctx, session._id, keyVersion)) {
      return { created: false, keyVersion }
    }

    const identityKey = normalizeDeviceIdentityKey(caller.identityKey)
    await ctx.db.insert("collaborationSessionKeys", {
      sessionId: session._id,
      keyVersion,
      recipientPrincipalId: caller._id,
      recipientIdentityKey: identityKey,
      senderIdentityKey: identityKey,
      senderPublicKeyJwk: caller.encryptionPublicKeyJwk,
      wrapAlgorithm: args.wrapAlgorithm,
      wrappedKey: args.wrappedKey,
      createdAt: Date.now(),
    })
    return { created: true, keyVersion }
  },
})

/** Existing active members may receive missing keys after closure for read-only recovery. */
export const listMembersNeedingSessionKey = query({
  args: {
    sessionId: v.id("collaborationSessions"),
    keyVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await ctx.db.get(args.sessionId)
    if (!session || session.lifecycle === "CLOSING") return []
    if (!(await canAccessProject(ctx, session.projectId, caller._id))) return []
    const membership = await getMembership(ctx, session._id, caller._id)
    if (membership?.status !== "active") return []
    const activeVersion = activeSessionKeyVersion(session)
    const keyVersion = args.keyVersion ?? activeVersion
    if (!Number.isSafeInteger(keyVersion) || keyVersion < 1 || keyVersion > activeVersion) {
      throw new ConvexError("Invalid session key generation")
    }
    if (!(await findSessionKeyCopy(ctx, session._id, caller.identityKey, activeVersion))) return []
    if (!(await findSessionKeyCopy(ctx, session._id, caller.identityKey, keyVersion))) return []

    const members = await ctx.db
      .query("collaborationSessionMembers")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect()
    const recipients: Array<{
      principalId: Id<"devicePrincipals">
      identityKey: string
      encryptionPublicKeyJwk: string
    }> = []
    for (const member of members) {
      const principal = await ctx.db.get(member.principalId)
      if (!principal || principal.status !== "active") continue
      if (!(await canAccessProject(ctx, session.projectId, principal._id))) continue
      if (await findSessionKeyCopy(ctx, session._id, principal.identityKey, keyVersion)) continue
      recipients.push({
        principalId: principal._id,
        identityKey: principal.identityKey,
        encryptionPublicKeyJwk: principal.encryptionPublicKeyJwk,
      })
    }
    return recipients
  },
})

/** A device holding the session key stores a copy wrapped for another active member. */
export const shareSessionKey = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
    keyVersion: v.optional(v.number()),
    recipientPrincipalId: v.id("devicePrincipals"),
    wrapAlgorithm: v.string(),
    wrappedKey: v.string(),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await requireSession(ctx, args.sessionId)
    if (session.lifecycle === "CLOSING") {
      throw new ConvexError("Wait for session closure before sharing recovery keys")
    }
    await requireActiveMember(ctx, session._id, caller)
    if (!(await canAccessProject(ctx, session.projectId, caller._id))) {
      throw new ConvexError("Project access is required to share session keys")
    }
    const activeVersion = activeSessionKeyVersion(session)
    const keyVersion = args.keyVersion ?? activeVersion
    if (!Number.isSafeInteger(keyVersion) || keyVersion < 1 || keyVersion > activeVersion) {
      throw new ConvexError("Invalid session key generation")
    }
    if (!(await findSessionKeyCopy(ctx, session._id, caller.identityKey, activeVersion))) {
      throw new ConvexError("Only devices that hold the session key for the current generation can share history")
    }
    if (!(await findSessionKeyCopy(ctx, session._id, caller.identityKey, keyVersion))) {
      throw new ConvexError("Only devices that hold the session key can share it")
    }
    const recipientMembership = await getMembership(ctx, session._id, args.recipientPrincipalId)
    if (recipientMembership?.status !== "active") {
      throw new ConvexError("The recipient is not an active member of this session")
    }
    const recipient = await ctx.db.get(args.recipientPrincipalId)
    if (!recipient || recipient.status !== "active") {
      throw new ConvexError("The recipient device is not active")
    }
    if (!(await canAccessProject(ctx, session.projectId, recipient._id))) {
      throw new ConvexError("The recipient no longer has project access")
    }
    if (await findSessionKeyCopy(ctx, session._id, recipient.identityKey, keyVersion)) {
      return { shared: false }
    }

    await ctx.db.insert("collaborationSessionKeys", {
      sessionId: session._id,
      keyVersion,
      recipientPrincipalId: recipient._id,
      recipientIdentityKey: normalizeDeviceIdentityKey(recipient.identityKey),
      senderIdentityKey: normalizeDeviceIdentityKey(caller.identityKey),
      senderPublicKeyJwk: caller.encryptionPublicKeyJwk,
      wrapAlgorithm: args.wrapAlgorithm,
      wrappedKey: args.wrappedKey,
      createdAt: Date.now(),
    })
    return { shared: true }
  },
})

export const revokeMember = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
    memberPrincipalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await requireSession(ctx, args.sessionId)
    await requireSessionManager(ctx, session, caller)
    if (args.memberPrincipalId === caller._id) {
      throw new ConvexError("Use Leave to remove yourself from a session")
    }

    const now = Date.now()
    const member = await getMembership(ctx, session._id, args.memberPrincipalId)
    let rotatedToKeyVersion = activeSessionKeyVersion(session)
    if (member && member.status !== "revoked") {
      await ctx.db.patch(member._id, { status: "revoked", leftAt: member.leftAt ?? now })
      // A removed device may already hold every older plaintext key it was sent.
      // Advance the content-key generation so all future traffic uses a key the
      // removed device never receives. Surviving members retain their old wrapped
      // copies solely to decrypt historical room replay after a restart.
      rotatedToKeyVersion += 1
      await ctx.db.patch(session._id, { activeKeyVersion: rotatedToKeyVersion, updatedAt: now })
    }

    // Revoke every historical wrapped copy for the removed device. Other members'
    // old copies remain readable for replay, but cannot encrypt current traffic.
    const keyCopies = await ctx.db
      .query("collaborationSessionKeys")
      .withIndex("by_session_and_version", (q) => q.eq("sessionId", session._id))
      .collect()
    for (const copy of keyCopies) {
      if (copy.recipientPrincipalId === args.memberPrincipalId && copy.revokedAt === undefined) {
        await ctx.db.patch(copy._id, { revokedAt: now })
      }
    }

    const target = await ctx.db.get(args.memberPrincipalId)
    const targetIdentityKey = target?.identityKey ? normalizeDeviceIdentityKey(target.identityKey) : undefined
    const pending = await ctx.db
      .query("collaborationSessionInvitations")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect()
    for (const invite of pending) {
      if (
        invite.targetPrincipalId === args.memberPrincipalId ||
        (targetIdentityKey !== undefined && invite.targetIdentityKey === targetIdentityKey)
      ) {
        await ctx.db.patch(invite._id, { status: "revoked", resolvedAt: now })
      }
    }

    if (session.lifecycle === "ACTIVE" && !(await hasActiveMembers(ctx, session._id))) {
      await ctx.db.patch(session._id, { lifecycle: "DORMANT", updatedAt: now })
    }

    return { success: true, keyVersion: rotatedToKeyVersion }
  },
})

/** Only the trusted room may attest that admission is fenced at a durable snapshot. */
export const finalizeLifecycleFromServer = publicMutation({
  args: {
    serverSecret: v.string(), publicSessionId: v.string(), principalId: v.id("devicePrincipals"),
    expectedRevision: v.number(), fence: lifecycleFenceValidator,
  },
  returns: v.object({ committed: v.literal(true), revision: v.number(), superseded: v.boolean() }),
  handler: async (ctx, args) => {
    requireGatewaySecret(args.serverSecret)
    const session = await ctx.db.query("collaborationSessions")
      .withIndex("by_public_session_id", (q) => q.eq("publicSessionId", args.publicSessionId)).first()
    if (!session) throw new ConvexError("Collaboration session not found")
    const caller = await ctx.db.get(args.principalId)
    const member = await getMembership(ctx, session._id, args.principalId)
    if (!caller || caller.status !== "active" || member?.status !== "active" || member.role !== "project_manager" ||
      !(await canAccessProject(ctx, session.projectId, args.principalId))) {
      throw new ConvexError("An active session manager with project access is required")
    }
    const { fence } = args
    if (fence.requestedByPrincipalId !== args.principalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fence.fenceId) ||
      !/^barrier_[0-9a-f]{32}$/.test(fence.barrierId) ||
      ![args.expectedRevision, fence.sessionSeq, fence.createdAt].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      !Number.isSafeInteger(fence.keyVersion) || fence.keyVersion < 1 ||
      (fence.gitSavedThroughSeq !== null && (!Number.isSafeInteger(fence.gitSavedThroughSeq) ||
        fence.gitSavedThroughSeq < 0 || fence.gitSavedThroughSeq > fence.sessionSeq))) {
      throw new ConvexError("Invalid lifecycle fence")
    }
    const revision = session.lifecycleRevision ?? 0
    const receipt = session.lifecycleReceipt
    if (receipt?.fence.fenceId === fence.fenceId) {
      if (receipt.expectedRevision !== args.expectedRevision ||
        Object.keys(fence).some((key) => fence[key as keyof typeof fence] !== receipt.fence[key as keyof typeof fence])) {
        throw new ConvexError("Lifecycle receipt mismatch")
      }
      return { committed: true as const, revision, superseded: revision !== args.expectedRevision + 1 }
    }
    if (revision !== args.expectedRevision) throw new ConvexError("Lifecycle revision changed")
    if (activeSessionKeyVersion(session) !== fence.keyVersion) throw new ConvexError("Session key changed")
    if (fence.sessionSeq < Math.max(session.lastDurableSeq, session.lastSnapshotSeq)) {
      throw new ConvexError("Lifecycle snapshot is behind retained state")
    }
    const lifecycle = walkLifecycle(session.lifecycle, fence.intent === "pause" ? ["PAUSING", "PAUSED"] : ["CLOSING", "CLOSED"])
    const now = Date.now()
    await ctx.db.patch(session._id, {
      lifecycle, lifecycleRevision: revision + 1,
      lifecycleReceipt: { fence, expectedRevision: args.expectedRevision, committedAt: now },
      lastDurableSeq: fence.sessionSeq, lastSnapshotSeq: fence.sessionSeq,
      lastAutoGitCheckpointSeq: fence.gitSavedThroughSeq ?? undefined,
      lastAutoGitCommitOid: session.lastAutoGitCheckpointSeq === fence.gitSavedThroughSeq ? session.lastAutoGitCommitOid : undefined,
      ...(fence.intent === "pause" ? { pausedAt: now } : { closedAt: now }), updatedAt: now,
    })
    return { committed: true as const, revision: revision + 1, superseded: false }
  },
})

export const pause = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await requireSession(ctx, args.sessionId)
    await requireSessionManager(ctx, session, caller)
    if (session.lifecycle === "PAUSED") {
      return { success: true }
    }

    throw new ConvexError("Pause through the desktop daemon so the session is durably snapshotted first")
  },
})

export const resume = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await requireSession(ctx, args.sessionId)
    await requireSessionManager(ctx, session, caller)
    if (session.lifecycle === "ACTIVE") {
      return { success: true }
    }

    const lifecycle = walkLifecycle(session.lifecycle, ["ACTIVE"])
    const now = Date.now()
    await ctx.db.patch(session._id, {
      lifecycle,
      pausedAt: undefined,
      lifecycleRevision: (session.lifecycleRevision ?? 0) + 1,
      updatedAt: now,
    })
    return { success: true }
  },
})

export const close = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const session = await requireSession(ctx, args.sessionId)
    await requireSessionManager(ctx, session, caller)
    if (session.lifecycle === "CLOSED") {
      return { success: true }
    }

    throw new ConvexError("Close through the desktop daemon after reviewing the retained session state")
  },
})

export const resolveInvitation = mutation({
  args: {
    invitationId: v.id("collaborationSessionInvitations"),
    accept: v.boolean(),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const invite = await ctx.db.get(args.invitationId)
    if (!invite || !isInvitationFor(invite, caller)) {
      throw new ConvexError("Invitation not found")
    }
    if (invite.status !== "pending") {
      throw new ConvexError("Invitation is no longer pending")
    }

    const now = Date.now()
    if (invite.expiresAt <= now) {
      await ctx.db.patch(invite._id, { status: "expired", resolvedAt: now })
      return { accepted: false as const, reason: "expired" as const }
    }

    if (!args.accept) {
      await ctx.db.patch(invite._id, { status: "declined", resolvedAt: now })
      return { accepted: false as const, reason: "declined" as const }
    }

    const session = await ctx.db.get(invite.sessionId)
    if (!session || isClosedOrClosing(session)) {
      throw new ConvexError("Session no longer available")
    }

    const existingMember = await getMembership(ctx, session._id, caller._id)
    if (existingMember?.status === "revoked") {
      throw new ConvexError("Device access to this session has been revoked")
    }

    // Atomically ensure project access, then session membership (Section 6.3)
    await ensureProjectAccess(ctx, session.projectId, caller._id, invite.role, invite.createdByPrincipalId, now)

    let memberId: Id<"collaborationSessionMembers">
    if (existingMember) {
      if (existingMember.status !== "active") {
        await ctx.db.patch(existingMember._id, { status: "active", joinedAt: now, leftAt: undefined })
      }
      memberId = existingMember._id
    } else {
      memberId = await ctx.db.insert("collaborationSessionMembers", {
        sessionId: session._id,
        projectId: session.projectId,
        principalId: caller._id,
        role: invite.role,
        status: "active",
        joinedAt: now,
      })
    }

    await ctx.db.patch(invite._id, { status: "accepted", resolvedAt: now })
    if (session.lifecycle === "DORMANT") {
      await ctx.db.patch(session._id, { lifecycle: "ACTIVE", updatedAt: now })
    }

    return {
      accepted: true as const,
      sessionId: session._id,
      publicSessionId: session.publicSessionId,
      projectId: session.projectId,
      branchName: session.branchName,
      repositoryUrl: session.repositoryUrl ?? null,
      memberId,
    }
  },
})

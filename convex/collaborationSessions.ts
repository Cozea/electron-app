import { deliverPublicationReference } from "./lib/collaborationPublicationDelivery"
import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import {
  canAccessProject,
  canEditProject,
  canManageProject,
} from "./lib/projectAccess"
import {
  collaborationCapabilitiesValidator,
  collaborationParticipantRoleValidator,
} from "./schema/collaboration"
import {
  advancePublishedCollaborationBase,
  assertGitCommitSha,
  buildCollaborationSessionBranch,
  normalizeSequence,
  validateCollaborationSession,
  type CollaborationParticipantDescriptor,
  type CollaborationParticipantRole,
  type CollaborationSessionCapabilities,
  type CollaborationSessionDescriptor,
} from "../shared/collaborationSession"

const DEFAULT_COMMIT_LEASE_MS = 60_000
const MIN_COMMIT_LEASE_MS = 10_000
const MAX_COMMIT_LEASE_MS = 5 * 60_000
const MAX_SESSION_LIST_ITEMS = 50
const MAX_EVENT_LIST_ITEMS = 200

const TERMINAL_SESSION_STATUSES = new Set(["closed", "failed"])
const JOINABLE_SESSION_STATUSES = new Set([
  "active",
  "commit_preparing",
  "local_commit_ready",
  "pushing",
])
const RECOVERABLE_EXPIRED_LEASE_STATUSES = new Set([
  "commit_preparing",
  "local_commit_ready",
])

function assertGatewaySecret(secret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || secret !== expected) {
    throw new ConvexError("Unauthorized")
  }
}

function requiredString(value: string, label: string, maxLength = 512): string {
  const normalized = value.trim()
  if (!normalized) throw new ConvexError(`${label} is required`)
  if (normalized.length > maxLength) {
    throw new ConvexError(`${label} exceeds ${maxLength} characters`)
  }
  return normalized
}

function assertGitBranchName(value: string, label: string): string {
  const branch = requiredString(value, label, 255)
  if (
    branch.startsWith("-") ||
    branch.startsWith(".") ||
    branch.endsWith(".") ||
    branch.endsWith("/") ||
    branch.endsWith(".lock") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    /[~^:?*\\[\]]/.test(branch) || [...branch].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
  ) {
    throw new ConvexError(`${label} is not a valid Git branch name`)
  }
  return branch
}

function normalizeLeaseDuration(value: number | undefined): number {
  if (value === undefined) return DEFAULT_COMMIT_LEASE_MS
  if (!Number.isFinite(value)) {
    throw new ConvexError("Commit lease duration must be finite")
  }
  return Math.max(
    MIN_COMMIT_LEASE_MS,
    Math.min(MAX_COMMIT_LEASE_MS, Math.floor(value)),
  )
}

function newSessionId(): string {
  return `czs_${crypto.randomUUID().replace(/-/g, "")}`
}

function isTerminalSession(session: Doc<"collaborationSessions">): boolean {
  return TERMINAL_SESSION_STATUSES.has(session.status)
}

export function toSessionDescriptor(
  session: Doc<"collaborationSessions">,
): CollaborationSessionDescriptor {
  if (session.generation !== 3) throw new ConvexError("This collaboration generation is retired; start a new session")
  const descriptor: CollaborationSessionDescriptor = {
    id: session.sessionId,
    projectId: String(session.projectId),
    repositoryId: session.repositoryId,
    targetBranch: session.targetBranch,
    sessionBranch: session.sessionBranch,
    baseCommitSha: session.baseCommitSha,
    publishedCommitSha: session.publishedCommitSha ?? null,
    publishedThroughSequence: session.publishedThroughSequence,
    roomHeadSequence: session.roomHeadSequence,
    createdByUserId: String(session.createdByUserId),
    commitLeaseUserId: session.commitLeaseUserId
      ? String(session.commitLeaseUserId)
      : null,
    commitLeaseExpiresAt: session.commitLeaseExpiresAt ?? null,
    pendingCommitSha: session.pendingCommitSha ?? null,
    pendingCommitThroughSequence: session.pendingCommitThroughSequence ?? null,
    pendingCommitCreatedAt: session.pendingCommitCreatedAt ?? null,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    closedAt: session.closedAt ?? null,
  }
  return validateCollaborationSession(descriptor)
}

function toParticipantDescriptor(
  participant: Doc<"collaborationParticipants">,
  sessionPublicId: string,
): CollaborationParticipantDescriptor {
  return {
    sessionId: sessionPublicId,
    userId: String(participant.userId),
    role: participant.role,
    joinedAt: participant.joinedAt,
    lastSeenAt: participant.lastSeenAt,
    leftAt: participant.leftAt ?? null,
    capabilities: participant.capabilities,
  }
}

async function getSessionByPublicId(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
): Promise<Doc<"collaborationSessions"> | null> {
  return await ctx.db
    .query("collaborationSessions")
    .withIndex("by_session_id", (index) => index.eq("sessionId", sessionId))
    .unique()
}

async function requireSessionByPublicId(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
): Promise<Doc<"collaborationSessions">> {
  const session = await getSessionByPublicId(
    ctx,
    requiredString(sessionId, "Collaboration session ID", 128),
  )
  if (!session) throw new ConvexError("Collaboration session not found")
  if (session.generation !== 3) throw new ConvexError("This collaboration generation is retired; start a new session")
  return session
}

async function getParticipant(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"collaborationSessions">,
  userId: Id<"users">,
): Promise<Doc<"collaborationParticipants"> | null> {
  return await ctx.db
    .query("collaborationParticipants")
    .withIndex("by_session_and_user", (index) =>
      index.eq("sessionId", sessionId).eq("userId", userId),
    )
    .unique()
}

async function requireSessionAccess(
  ctx: QueryCtx | MutationCtx,
  session: Doc<"collaborationSessions">,
  userId: Id<"users">,
): Promise<void> {
  if (!(await canAccessProject(ctx, session.projectId, userId))) {
    throw new ConvexError("The authenticated user cannot access this collaboration session")
  }
}

async function requireActiveEditorParticipant(
  ctx: QueryCtx | MutationCtx,
  session: Doc<"collaborationSessions">,
  userId: Id<"users">,
): Promise<Doc<"collaborationParticipants">> {
  const participant = await getParticipant(ctx, session._id, userId)
  if (!participant || participant.leftAt !== undefined || participant.role !== "editor") {
    throw new ConvexError("An active editor participant is required")
  }
  if (!(await canEditProject(ctx, session.projectId, userId))) {
    throw new ConvexError("The authenticated user cannot edit this project")
  }
  return participant
}

async function requireLeaseHolder(
  ctx: QueryCtx | MutationCtx,
  session: Doc<"collaborationSessions">,
  userId: Id<"users">,
  now: number,
): Promise<void> {
  await requireActiveEditorParticipant(ctx, session, userId)
  if (
    session.commitLeaseUserId !== userId ||
    session.commitLeaseExpiresAt === undefined ||
    session.commitLeaseExpiresAt <= now
  ) {
    throw new ConvexError("The authenticated user does not hold an active commit lease")
  }
}

async function requireRecordedLeaseHolder(
  ctx: QueryCtx | MutationCtx,
  session: Doc<"collaborationSessions">,
  userId: Id<"users">,
): Promise<void> {
  await requireActiveEditorParticipant(ctx, session, userId)
  if (session.commitLeaseUserId !== userId) {
    throw new ConvexError("The authenticated user does not own this commit preparation")
  }
}

async function recordEvent(
  ctx: MutationCtx,
  session: Doc<"collaborationSessions">,
  eventType: Doc<"collaborationSessionEvents">["eventType"],
  args: {
    actorUserId?: Id<"users">
    roomSequence?: number
    commitSha?: string
    metadata?: Record<string, unknown>
    createdAt?: number
  } = {},
): Promise<void> {
  await ctx.db.insert("collaborationSessionEvents", {
    sessionId: session._id,
    projectId: session.projectId,
    eventType,
    actorUserId: args.actorUserId,
    roomSequence: args.roomSequence,
    commitSha: args.commitSha,
    metadata: args.metadata,
    createdAt: args.createdAt ?? Date.now(),
  })
}

async function upsertParticipant(
  ctx: MutationCtx,
  session: Doc<"collaborationSessions">,
  userId: Id<"users">,
  role: CollaborationParticipantRole,
  capabilities: CollaborationSessionCapabilities,
  now: number,
): Promise<{
  participant: Doc<"collaborationParticipants">
  joined: boolean
}> {
  const existing = await getParticipant(ctx, session._id, userId)
  if (existing) {
    const joined = existing.leftAt !== undefined
    await ctx.db.patch(existing._id, {
      role,
      capabilities,
      lastSeenAt: now,
      leftAt: undefined,
    })
    return {
      participant: {
        ...existing,
        role,
        capabilities,
        lastSeenAt: now,
        leftAt: undefined,
      },
      joined,
    }
  }

  const participantId = await ctx.db.insert("collaborationParticipants", {
    sessionId: session._id,
    projectId: session.projectId,
    userId,
    role,
    capabilities,
    joinedAt: now,
    lastSeenAt: now,
  })
  const participant = await ctx.db.get(participantId)
  if (!participant) throw new ConvexError("Failed to create collaboration participant")
  return { participant, joined: true }
}

export const createSession = mutation({
  args: {
    generation: v.literal(3),
    projectId: v.id("projects"),
    repositoryId: v.string(),
    targetBranch: v.string(),
    baseCommitSha: v.string(),
    creationToken: v.string(),
    resolutionId: v.id("collaborationRepositoryResolutions"),
  },
  handler: async (ctx, args) => {
    if (process.env.COLLABORATION_G3_CREATE_ENABLED !== "1") throw new ConvexError("New collaboration sessions are not available during rollout")
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canEditProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("The authenticated user cannot start collaboration for this project")
    }

    const repositoryId = requiredString(args.repositoryId, "Repository ID", 512)
    const targetBranch = assertGitBranchName(args.targetBranch, "Target branch")
    const baseCommitSha = assertGitCommitSha(args.baseCommitSha, "Base commit SHA")
    const creationToken = requiredString(args.creationToken, "Creation token", 128)

    const existingForRequest = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_project_and_creation_token", (index) =>
        index.eq("projectId", args.projectId).eq("creationToken", creationToken),
      )
      .unique()

    if (existingForRequest) {
      if (
        existingForRequest.repositoryId !== repositoryId ||
        existingForRequest.targetBranch !== targetBranch ||
        existingForRequest.baseCommitSha !== baseCommitSha
      ) {
        throw new ConvexError("Creation token was already used with different session parameters")
      }
      return toSessionDescriptor(existingForRequest)
    }

    // A renderer-selected SHA or repository ID is not publication authority.
    // Only the gateway can attest a commit read from an authorized installation.
    const resolution = await ctx.db.get(args.resolutionId)
    const binding = resolution ? await ctx.db.get(resolution.bindingId) : null
    const repository = binding?.organizationId ? await ctx.db.query("collaborationVerifiedRepositories")
      .withIndex("by_organization_and_repository", q => q.eq("organizationId", binding.organizationId!).eq("repositoryNumericId", binding.repositoryNumericId)).unique() : null
    if (!resolution || resolution.userId !== user._id || resolution.projectId !== args.projectId ||
      resolution.expiresAt <= Date.now() || resolution.consumedBySessionId || resolution.repositoryId !== repositoryId ||
      resolution.branch !== targetBranch || resolution.commitSha !== baseCommitSha ||
      !binding?.enabled || binding.projectId !== args.projectId || !repository || repository.revokedAt !== undefined ||
      repository.installationId !== binding.installationId) throw new ConvexError("Resolve the authorized GitHub branch again before starting")

    const sessionsForTarget = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_project_and_target", (index) =>
        index.eq("projectId", args.projectId).eq("targetBranch", targetBranch),
      )
      .collect()
    const existingActive = sessionsForTarget.find((session) => session.generation === 3 && !isTerminalSession(session))
    if (existingActive) {
      throw new ConvexError({
        code: "active_session_exists",
        message: "An active collaboration session already exists for this target branch",
        sessionId: existingActive.sessionId,
      })
    }

    const now = Date.now()
    const sessionPublicId = newSessionId()
    const sessionDocumentId = await ctx.db.insert("collaborationSessions", {
      generation: 3,
      sessionId: sessionPublicId,
      creationToken,
      projectId: args.projectId,
      repositoryId,
      targetBranch,
      sessionBranch: buildCollaborationSessionBranch(sessionPublicId),
      baseCommitSha,
      publishedThroughSequence: 0,
      roomHeadSequence: 0,
      createdByUserId: user._id,
      status: "opening",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(args.resolutionId, { consumedBySessionId: sessionDocumentId })
    const session = await ctx.db.get(sessionDocumentId)
    if (!session) throw new ConvexError("Failed to create collaboration session")

    await upsertParticipant(
      ctx,
      session,
      user._id,
      "editor",
      { codeSync: true, audio: false, screenShare: false },
      now,
    )
    await recordEvent(ctx, session, "created", {
      actorUserId: user._id,
      metadata: { repositoryId, targetBranch, baseCommitSha },
      createdAt: now,
    })

    return toSessionDescriptor(session)
  },
})

export const activateSession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    await requireActiveEditorParticipant(ctx, session, user._id)

    if (session.status === "active") return toSessionDescriptor(session)
    if (session.status !== "opening") {
      throw new ConvexError(`Cannot activate a collaboration session in ${session.status} state`)
    }

    const now = Date.now()
    await ctx.db.patch(session._id, {
      status: "active",
      revision: session.revision + 1,
      updatedAt: now,
    })
    const updated = {
      ...session,
      status: "active" as const,
      revision: session.revision + 1,
      updatedAt: now,
    }
    await recordEvent(ctx, updated, "activated", {
      actorUserId: user._id,
      createdAt: now,
    })
    return toSessionDescriptor(updated)
  },
})

export const getSession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await getSessionByPublicId(
      ctx,
      requiredString(args.sessionId, "Collaboration session ID", 128),
    )
    if (!session) return null
    await requireSessionAccess(ctx, session, user._id)
    return toSessionDescriptor(session)
  },
})

export const listForProject = query({
  args: {
    projectId: v.id("projects"),
    includeClosed: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canAccessProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("The authenticated user cannot access this project")
    }

    const limit = Number.isFinite(args.limit)
      ? Math.max(1, Math.min(MAX_SESSION_LIST_ITEMS, Math.floor(args.limit!)))
      : 20
    const sessions = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_project_and_updated", (index) => index.eq("projectId", args.projectId))
      .order("desc")
      .take(MAX_SESSION_LIST_ITEMS)

    return sessions
      .filter((session) => session.generation === 3)
      .filter((session) => args.includeClosed || !isTerminalSession(session))
      .slice(0, limit)
      .map(toSessionDescriptor)
  },
})

export const joinSession = mutation({
  args: {
    sessionId: v.string(),
    requestedRole: v.optional(collaborationParticipantRoleValidator),
    capabilities: v.optional(collaborationCapabilitiesValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    await requireSessionAccess(ctx, session, user._id)

    if (!JOINABLE_SESSION_STATUSES.has(session.status)) {
      throw new ConvexError(`Cannot join a collaboration session in ${session.status} state`)
    }

    const canEdit = await canEditProject(ctx, session.projectId, user._id)
    const requestedRole = args.requestedRole ?? (canEdit ? "editor" : "observer")
    if (requestedRole === "editor" && !canEdit) {
      throw new ConvexError("This user may join the session only as an observer")
    }

    const now = Date.now()
    const { participant, joined } = await upsertParticipant(
      ctx,
      session,
      user._id,
      requestedRole,
      args.capabilities ?? {
        codeSync: true,
        audio: false,
        screenShare: false,
      },
      now,
    )
    if (joined) {
      await recordEvent(ctx, session, "participant_joined", {
        actorUserId: user._id,
        metadata: { role: requestedRole },
        createdAt: now,
      })
    }

    return {
      session: toSessionDescriptor(session),
      participant: toParticipantDescriptor(participant, session.sessionId),
    }
  },
})

export const heartbeatParticipant = mutation({
  args: {
    sessionId: v.string(),
    capabilities: v.optional(collaborationCapabilitiesValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    await requireSessionAccess(ctx, session, user._id)
    const participant = await getParticipant(ctx, session._id, user._id)
    if (!participant || participant.leftAt !== undefined) {
      throw new ConvexError("The authenticated user is not an active session participant")
    }

    const now = Date.now()
    await ctx.db.patch(participant._id, {
      capabilities: args.capabilities ?? participant.capabilities,
      lastSeenAt: now,
    })
    return { sessionId: session.sessionId, lastSeenAt: now }
  },
})

export const leaveSession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    await requireSessionAccess(ctx, session, user._id)
    const participant = await getParticipant(ctx, session._id, user._id)
    if (!participant || participant.leftAt !== undefined) {
      return { left: false, session: toSessionDescriptor(session) }
    }

    const now = Date.now()
    await ctx.db.patch(participant._id, { lastSeenAt: now, leftAt: now })

    let updatedSession = session
    if (session.commitLeaseUserId === user._id && session.status !== "pushing") {
      await ctx.db.patch(session._id, {
        commitLeaseUserId: undefined,
        commitLeaseExpiresAt: undefined,
        pendingCommitSha: undefined,
        pendingCommitThroughSequence: undefined,
        pendingCommitCreatedAt: undefined,
        status: session.status === "closing" ? "closing" : "active",
        revision: session.revision + 1,
        updatedAt: now,
      })
      updatedSession = {
        ...session,
        commitLeaseUserId: undefined,
        commitLeaseExpiresAt: undefined,
        pendingCommitSha: undefined,
        pendingCommitThroughSequence: undefined,
        pendingCommitCreatedAt: undefined,
        status: session.status === "closing" ? "closing" : "active",
        revision: session.revision + 1,
        updatedAt: now,
      }
    }

    await recordEvent(ctx, updatedSession, "participant_left", {
      actorUserId: user._id,
      createdAt: now,
    })
    return { left: true, session: toSessionDescriptor(updatedSession) }
  },
})

export const listParticipants = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    await requireSessionAccess(ctx, session, user._id)
    const participants = await ctx.db
      .query("collaborationParticipants")
      .withIndex("by_session", (index) => index.eq("sessionId", session._id))
      .collect()
    return participants.map((participant) =>
      toParticipantDescriptor(participant, session.sessionId),
    )
  },
})

export const acquireCommitLease = mutation({
  args: {
    sessionId: v.string(),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    await requireActiveEditorParticipant(ctx, session, user._id)

    const now = Date.now()
    const leaseIsActive =
      session.commitLeaseUserId !== undefined &&
      session.commitLeaseExpiresAt !== undefined &&
      session.commitLeaseExpiresAt > now
    if (leaseIsActive && session.commitLeaseUserId !== user._id) {
      throw new ConvexError({
        code: "commit_lease_held",
        message: "Another participant is preparing a collaboration commit",
        leaseUserId: session.commitLeaseUserId,
        leaseExpiresAt: session.commitLeaseExpiresAt,
      })
    }

    const sameUserRenewal =
      leaseIsActive &&
      session.commitLeaseUserId === user._id &&
      session.status === "commit_preparing"
    const expiredLeaseRecovery =
      !leaseIsActive && RECOVERABLE_EXPIRED_LEASE_STATUSES.has(session.status)
    if (session.status !== "active" && !sameUserRenewal && !expiredLeaseRecovery) {
      throw new ConvexError(`Cannot acquire a commit lease in ${session.status} state`)
    }

    const leaseExpiresAt = now + normalizeLeaseDuration(args.durationMs)
    await ctx.db.patch(session._id, {
      commitLeaseUserId: user._id,
      commitLeaseExpiresAt: leaseExpiresAt,
      pendingCommitSha: undefined,
      pendingCommitThroughSequence: undefined,
      pendingCommitCreatedAt: undefined,
      status: "commit_preparing",
      revision: session.revision + 1,
      updatedAt: now,
    })
    const updated = {
      ...session,
      commitLeaseUserId: user._id,
      commitLeaseExpiresAt: leaseExpiresAt,
      pendingCommitSha: undefined,
      pendingCommitThroughSequence: undefined,
      pendingCommitCreatedAt: undefined,
      status: "commit_preparing" as const,
      revision: session.revision + 1,
      updatedAt: now,
    }
    await recordEvent(ctx, updated, sameUserRenewal ? "lease_renewed" : "lease_acquired", {
      actorUserId: user._id,
      metadata: {
        leaseExpiresAt,
        recoveredExpiredLease: expiredLeaseRecovery,
      },
      createdAt: now,
    })
    return toSessionDescriptor(updated)
  },
})

export const renewCommitLease = mutation({
  args: {
    sessionId: v.string(),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    const now = Date.now()
    await requireLeaseHolder(ctx, session, user._id, now)

    const leaseExpiresAt = now + normalizeLeaseDuration(args.durationMs)
    await ctx.db.patch(session._id, {
      commitLeaseExpiresAt: leaseExpiresAt,
      revision: session.revision + 1,
      updatedAt: now,
    })
    const updated = {
      ...session,
      commitLeaseExpiresAt: leaseExpiresAt,
      revision: session.revision + 1,
      updatedAt: now,
    }
    await recordEvent(ctx, updated, "lease_renewed", {
      actorUserId: user._id,
      metadata: { leaseExpiresAt },
      createdAt: now,
    })
    return toSessionDescriptor(updated)
  },
})

/** Explicit restart recovery retains the exact pending publication identity. */
export const recoverPreparedLease = mutation({
  args: { sessionId: v.string(), commitSha: v.string(), coveredThroughSequence: v.number() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    await requireActiveEditorParticipant(ctx, session, user._id)
    const now = Date.now()
    if (session.commitLeaseUserId !== user._id || !["local_commit_ready", "pushing"].includes(session.status) ||
      session.pendingCommitSha !== assertGitCommitSha(args.commitSha) || session.pendingCommitThroughSequence !== normalizeSequence(args.coveredThroughSequence, "Prepared sequence")) {
      throw new ConvexError("This prepared publication was replaced or belongs to another editor")
    }
    const updated = { ...session, commitLeaseExpiresAt: now + DEFAULT_COMMIT_LEASE_MS, revision: session.revision + 1, updatedAt: now }
    await ctx.db.patch(session._id, { commitLeaseExpiresAt: updated.commitLeaseExpiresAt, revision: updated.revision, updatedAt: now })
    await recordEvent(ctx, updated, "lease_renewed", { actorUserId: user._id, metadata: { recoveredPreparedCommit: true }, createdAt: now })
    return toSessionDescriptor(updated)
  },
})

export const markLocalCommitReady = mutation({
  args: {
    sessionId: v.string(),
    commitSha: v.string(),
    coveredThroughSequence: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    const now = Date.now()
    await requireLeaseHolder(ctx, session, user._id, now)
    if (session.status !== "commit_preparing") {
      throw new ConvexError(`Cannot prepare a local commit in ${session.status} state`)
    }

    const commitSha = assertGitCommitSha(args.commitSha, "Prepared commit SHA")
    const coveredThroughSequence = normalizeSequence(
      args.coveredThroughSequence,
      "Prepared commit sequence",
    )
    if (
      coveredThroughSequence < session.publishedThroughSequence ||
      coveredThroughSequence > session.roomHeadSequence
    ) {
      throw new ConvexError("Prepared commit sequence is outside the current room range")
    }

    await ctx.db.patch(session._id, {
      pendingCommitSha: commitSha,
      pendingCommitThroughSequence: coveredThroughSequence,
      pendingCommitCreatedAt: now,
      status: "local_commit_ready",
      revision: session.revision + 1,
      updatedAt: now,
    })
    const updated = {
      ...session,
      pendingCommitSha: commitSha,
      pendingCommitThroughSequence: coveredThroughSequence,
      pendingCommitCreatedAt: now,
      status: "local_commit_ready" as const,
      revision: session.revision + 1,
      updatedAt: now,
    }
    await recordEvent(ctx, updated, "commit_prepared", {
      actorUserId: user._id,
      roomSequence: coveredThroughSequence,
      commitSha,
      createdAt: now,
    })
    return toSessionDescriptor(updated)
  },
})

export const beginPush = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    const now = Date.now()
    await requireLeaseHolder(ctx, session, user._id, now)
    if (
      session.status !== "local_commit_ready" ||
      !session.pendingCommitSha ||
      session.pendingCommitThroughSequence === undefined
    ) {
      throw new ConvexError("A prepared local commit is required before Push")
    }

    await ctx.db.patch(session._id, {
      status: "pushing",
      revision: session.revision + 1,
      updatedAt: now,
    })
    const updated = {
      ...session,
      status: "pushing" as const,
      revision: session.revision + 1,
      updatedAt: now,
    }
    await recordEvent(ctx, updated, "push_started", {
      actorUserId: user._id,
      roomSequence: session.pendingCommitThroughSequence,
      commitSha: session.pendingCommitSha,
      createdAt: now,
    })
    return toSessionDescriptor(updated)
  },
})

export const releaseCommitLease = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    await requireRecordedLeaseHolder(ctx, session, user._id)
    if (session.status === "pushing") {
      throw new ConvexError("Cannot release the commit lease while Push verification is running")
    }

    const now = Date.now()
    await ctx.db.patch(session._id, {
      commitLeaseUserId: undefined,
      commitLeaseExpiresAt: undefined,
      pendingCommitSha: undefined,
      pendingCommitThroughSequence: undefined,
      pendingCommitCreatedAt: undefined,
      status: "active",
      revision: session.revision + 1,
      updatedAt: now,
    })
    const updated = {
      ...session,
      commitLeaseUserId: undefined,
      commitLeaseExpiresAt: undefined,
      pendingCommitSha: undefined,
      pendingCommitThroughSequence: undefined,
      pendingCommitCreatedAt: undefined,
      status: "active" as const,
      revision: session.revision + 1,
      updatedAt: now,
    }
    await recordEvent(ctx, updated, "lease_released", {
      actorUserId: user._id,
      createdAt: now,
    })
    return toSessionDescriptor(updated)
  },
})

export const updateRoomHeadFromServer = mutation({
  args: {
    serverSecret: v.string(),
    sessionId: v.string(),
    roomHeadSequence: v.number(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    if (isTerminalSession(session)) return toSessionDescriptor(session)

    const roomHeadSequence = normalizeSequence(args.roomHeadSequence, "Room head sequence")
    if (roomHeadSequence < session.roomHeadSequence) {
      throw new ConvexError("Room head sequence cannot move backwards")
    }
    if (roomHeadSequence === session.roomHeadSequence) {
      return toSessionDescriptor(session)
    }

    const now = Date.now()
    await ctx.db.patch(session._id, {
      roomHeadSequence,
      revision: session.revision + 1,
      updatedAt: now,
    })
    return toSessionDescriptor({
      ...session,
      roomHeadSequence,
      revision: session.revision + 1,
      updatedAt: now,
    })
  },
})

export const advancePublishedBaseFromServer = mutation({
  args: {
    serverSecret: v.string(),
    sessionId: v.string(),
    publishedByUserId: v.id("users"),
    commitSha: v.string(),
    coveredThroughSequence: v.number(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    const existingPublication = await ctx.db.query("collaborationPublications").withIndex("by_session_and_commit", q => q.eq("sessionId", session._id).eq("commitSha", args.commitSha)).unique()
    if (existingPublication) {
      if (existingPublication.coveredThroughSequence !== args.coveredThroughSequence || existingPublication.publishedByUserId !== args.publishedByUserId) throw new ConvexError("Publication identity differs from the verified result")
      return toSessionDescriptor(session)
    }
    const publishedAt = Date.now()
    const next = advancePublishedCollaborationBase(
      toSessionDescriptor(session),
      {
        commitSha: args.commitSha,
        coveredThroughSequence: args.coveredThroughSequence,
        publishedByUserId: String(args.publishedByUserId),
        publishedAt,
      },
    )

    const publicationId = await ctx.db.insert("collaborationPublications", {
      sessionId: session._id, publicSessionId: session.sessionId, projectId: session.projectId, publicationRevision: session.revision + 1,
      commitSha: args.commitSha, coveredThroughSequence: args.coveredThroughSequence,
      publishedByUserId: args.publishedByUserId, createdAt: publishedAt, attempts: 0,
    })
    await ctx.scheduler.runAfter(0, deliverPublicationReference, { publicationId })

    await ctx.db.patch(session._id, {
      baseCommitSha: next.baseCommitSha,
      publishedCommitSha: next.publishedCommitSha ?? undefined,
      publishedThroughSequence: next.publishedThroughSequence,
      commitLeaseUserId: undefined,
      commitLeaseExpiresAt: undefined,
      pendingCommitSha: undefined,
      pendingCommitThroughSequence: undefined,
      pendingCommitCreatedAt: undefined,
      status: "active",
      revision: session.revision + 1,
      updatedAt: publishedAt,
    })
    const updated: Doc<"collaborationSessions"> = {
      ...session,
      baseCommitSha: next.baseCommitSha,
      publishedCommitSha: next.publishedCommitSha ?? undefined,
      publishedThroughSequence: next.publishedThroughSequence,
      commitLeaseUserId: undefined,
      commitLeaseExpiresAt: undefined,
      pendingCommitSha: undefined,
      pendingCommitThroughSequence: undefined,
      pendingCommitCreatedAt: undefined,
      status: "active",
      revision: session.revision + 1,
      updatedAt: publishedAt,
    }
    await recordEvent(ctx, updated, "base_advanced", {
      actorUserId: args.publishedByUserId,
      roomSequence: next.publishedThroughSequence,
      commitSha: next.publishedCommitSha ?? undefined,
      createdAt: publishedAt,
    })
    return toSessionDescriptor(updated)
  },
})

export const closeSession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    await requireSessionAccess(ctx, session, user._id)
    const canClose =
      session.createdByUserId === user._id ||
      (await canManageProject(ctx, session.projectId, user._id))
    if (!canClose) {
      throw new ConvexError("Only the session creator or a project manager may close this session")
    }
    if (session.status === "pushing") {
      throw new ConvexError("Push verification must finish before closing the session")
    }
    if (session.status === "closed") return toSessionDescriptor(session)
    if (session.status === "failed") {
      throw new ConvexError("A failed collaboration session is already terminal")
    }

    const now = Date.now()
    await ctx.db.patch(session._id, {
      commitLeaseUserId: undefined,
      commitLeaseExpiresAt: undefined,
      pendingCommitSha: undefined,
      pendingCommitThroughSequence: undefined,
      pendingCommitCreatedAt: undefined,
      status: "closed",
      revision: session.revision + 1,
      updatedAt: now,
      closedAt: now,
    })

    const participants = await ctx.db
      .query("collaborationParticipants")
      .withIndex("by_session", (index) => index.eq("sessionId", session._id))
      .collect()
    for (const participant of participants) {
      if (participant.leftAt === undefined) {
        await ctx.db.patch(participant._id, { lastSeenAt: now, leftAt: now })
      }
    }

    const updated: Doc<"collaborationSessions"> = {
      ...session,
      commitLeaseUserId: undefined,
      commitLeaseExpiresAt: undefined,
      pendingCommitSha: undefined,
      pendingCommitThroughSequence: undefined,
      pendingCommitCreatedAt: undefined,
      status: "closed",
      revision: session.revision + 1,
      updatedAt: now,
      closedAt: now,
    }
    await recordEvent(ctx, updated, "closed", {
      actorUserId: user._id,
      createdAt: now,
    })
    return toSessionDescriptor(updated)
  },
})

export const failSessionFromServer = mutation({
  args: {
    serverSecret: v.string(),
    sessionId: v.string(),
    failureCode: v.string(),
    failureMessage: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    if (isTerminalSession(session)) return toSessionDescriptor(session)

    const now = Date.now()
    const failureCode = requiredString(args.failureCode, "Failure code", 128)
    const failureMessage = requiredString(args.failureMessage, "Failure message", 2_000)
    await ctx.db.patch(session._id, {
      commitLeaseUserId: undefined,
      commitLeaseExpiresAt: undefined,
      pendingCommitSha: undefined,
      pendingCommitThroughSequence: undefined,
      pendingCommitCreatedAt: undefined,
      status: "failed",
      revision: session.revision + 1,
      updatedAt: now,
      closedAt: now,
      failureCode,
      failureMessage,
    })
    const updated: Doc<"collaborationSessions"> = {
      ...session,
      commitLeaseUserId: undefined,
      commitLeaseExpiresAt: undefined,
      pendingCommitSha: undefined,
      pendingCommitThroughSequence: undefined,
      pendingCommitCreatedAt: undefined,
      status: "failed",
      revision: session.revision + 1,
      updatedAt: now,
      closedAt: now,
      failureCode,
      failureMessage,
    }
    await recordEvent(ctx, updated, "failed", {
      metadata: { failureCode },
      createdAt: now,
    })
    return toSessionDescriptor(updated)
  },
})

export const listEvents = query({
  args: {
    sessionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    await requireSessionAccess(ctx, session, user._id)
    const limit = Number.isFinite(args.limit)
      ? Math.max(1, Math.min(MAX_EVENT_LIST_ITEMS, Math.floor(args.limit!)))
      : 50
    return await ctx.db
      .query("collaborationSessionEvents")
      .withIndex("by_session_and_created_at", (index) => index.eq("sessionId", session._id))
      .order("desc")
      .take(limit)
  },
})

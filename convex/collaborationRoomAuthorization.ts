import { verifiedInstallationIsCurrent } from "./lib/collaborationInstallationAccess"
import { v } from "convex/values"

import { query, type QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { toSessionDescriptor } from "./collaborationSessions"
import { canAccessProject, canEditProject } from "./lib/projectAccess"
import { roomKeyHasRemovedRecipient } from "./lib/collaborationKeyAccess"

function assertGatewaySecret(secret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || secret !== expected) throw new Error("Unauthorized")
}

export async function authorizeCollaborationParticipant(ctx: QueryCtx, userId: Id<"users">, sessionId: string) {
  const user = await ctx.db.get(userId)
  if (!user || user.status === "revoked") return { allowed: false as const }
  const session = await ctx.db.query("collaborationSessions")
    .withIndex("by_session_id", index => index.eq("sessionId", sessionId.trim())).unique()
  if (!session || session.generation !== 3 || session.status === "closed" || session.status === "failed" || session.status === "closing") return { allowed: false as const }
  if (!await canAccessProject(ctx, session.projectId, user._id)) return { allowed: false as const }
  const participant = await ctx.db.query("collaborationParticipants")
    .withIndex("by_session_and_user", index => index.eq("sessionId", session._id).eq("userId", user._id)).unique()
  if (!participant || participant.leftAt !== undefined) return { allowed: false as const }
  const binding = await ctx.db.query("collaborationRepositoryBindings").withIndex("by_project", q => q.eq("projectId", session.projectId)).unique()
  if (!binding?.enabled || binding.repositoryId !== session.repositoryId || !binding.organizationId) return { allowed: false as const }
  const repository = await ctx.db.query("collaborationVerifiedRepositories").withIndex("by_organization_and_repository", q => q.eq("organizationId", binding.organizationId!).eq("repositoryNumericId", binding.repositoryNumericId)).unique()
  if (!repository || repository.revokedAt !== undefined || repository.installationId !== binding.installationId || !await verifiedInstallationIsCurrent(ctx, repository)) return { allowed: false as const }
  const keys = await ctx.db.query("projectCollabRoomKeys")
    .withIndex("by_project_and_room", q => q.eq("projectId", session.projectId).eq("roomId", `session:${session.sessionId}`)).collect()
  const activeKey = keys.filter(key => key.status === "active").sort((a, b) => b.keyVersion - a.keyVersion)[0]
  const pendingKey = keys.filter(key => key.status === "rotating").sort((a, b) => b.keyVersion - a.keyVersion)[0]
  const rotationRequired = Boolean(pendingKey || (activeKey && await roomKeyHasRemovedRecipient(ctx, session, activeKey.keyVersion)))
  const role = participant.role === "editor" && await canEditProject(ctx, session.projectId, user._id) ? "editor" as const : "observer" as const
  return {
    allowed: true as const, userId: user._id, projectId: session.projectId,
    sessionDocumentId: session._id, sessionId: session.sessionId,
    roomId: `session:${session.sessionId}`, role, capabilities: participant.capabilities,
    revision: session.revision, keyVersion: activeKey?.keyVersion ?? null,
    rotationRequired, pendingKeyVersion: pendingKey?.keyVersion ?? null,
  }
}

export const authorizeSessionForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const user = await ctx.db.query("users").withIndex("by_identity_key", index => index.eq("identityKey", args.identityKey.trim())).unique()
    return user ? await authorizeCollaborationParticipant(ctx, user._id, args.sessionId) : { allowed: false as const }
  },
})

export const authorizeConnectionForServer = query({
  args: { serverSecret: v.string(), userId: v.id("users"), sessionId: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    return await authorizeCollaborationParticipant(ctx, args.userId, args.sessionId)
  },
})

export const workspaceContextForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const user = await ctx.db.query("users").withIndex("by_identity_key", q => q.eq("identityKey", args.identityKey)).unique()
    if (!user) throw new Error("Session access denied")
    const authority = await authorizeCollaborationParticipant(ctx, user._id, args.sessionId)
    if (!authority.allowed) throw new Error("Session access denied")
    const session = await ctx.db.get(authority.sessionDocumentId)
    const binding = await ctx.db.query("collaborationRepositoryBindings").withIndex("by_project", q => q.eq("projectId", authority.projectId)).unique()
    if (!session || !binding) throw new Error("Session repository unavailable")
    return { userId: user._id, session: toSessionDescriptor(session), role: authority.role, cloneUrl: binding.cloneUrl, expiresAt: Date.now() + 60_000 }
  },
})

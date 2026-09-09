import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"
import { authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { canAccessProject, canEditProject } from "./lib/projectAccess"
import { roomKeyHasRemovedRecipient } from "./lib/collaborationKeyAccess"

function assertGatewaySecret(secret: string): void {
  if (!process.env.AI_GATEWAY_SECRET || secret !== process.env.AI_GATEWAY_SECRET) throw new Error("Unauthorized")
}

export async function authorizeCollaborationParticipant(
  ctx: QueryCtx,
  principalId: Id<"devicePrincipals">,
  sessionId: string,
) {
  const session = await ctx.db.query("collaborationSessions")
    .withIndex("by_session_id", q => q.eq("sessionId", sessionId.trim())).unique()
  if (!session || ["closed", "failed"].includes(session.status) ||
    !(await canAccessProject(ctx, session.projectId, principalId))) return { allowed: false as const }
  const participant = await ctx.db.query("collaborationParticipants")
    .withIndex("by_session_and_principal", q => q.eq("sessionId", session._id).eq("principalId", principalId)).unique()
  if (!participant || participant.leftAt !== undefined) return { allowed: false as const }
  const roomId = `session:${session.sessionId}`
  const keys = await ctx.db.query("projectCollabRoomKeys")
    .withIndex("by_project_and_room", q => q.eq("projectId", session.projectId).eq("roomId", roomId)).collect()
  const active = keys.find(key => key.status === "active")
  const pending = keys.find(key => key.status === "rotating")
  const rotationRequired = active ? await roomKeyHasRemovedRecipient(ctx, session, active.keyVersion) : false
  return {
    allowed: true as const,
    principalId,
    projectId: session.projectId,
    sessionDocumentId: session._id,
    sessionId: session.sessionId,
    roomId,
    role: participant.role === "editor" && await canEditProject(ctx, session.projectId, principalId) ? "editor" as const : "observer" as const,
    capabilities: participant.capabilities,
    keyVersion: active?.keyVersion ?? null,
    pendingKeyVersion: pending?.keyVersion ?? null,
    rotationRequired,
    session,
  }
}

export const authorizeSessionForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const principal = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", q => q.eq("identityKey", args.identityKey.trim())).unique()
    if (!principal || principal.status === "revoked") return { allowed: false as const }
    const authority = await authorizeCollaborationParticipant(ctx, principal._id, args.sessionId)
    if (!authority.allowed) return authority
    return {
      allowed: true as const,
      principalId: principal._id,
      projectId: authority.projectId,
      sessionDocumentId: authority.sessionDocumentId,
      sessionId: authority.sessionId,
      roomId: authority.roomId,
      role: authority.role,
      capabilities: authority.capabilities,
      keyVersion: authority.keyVersion,
      pendingKeyVersion: authority.pendingKeyVersion,
      rotationRequired: authority.rotationRequired,
    }
  },
})

export const workspaceContextForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const principal = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", q => q.eq("identityKey", args.identityKey.trim())).unique()
    if (!principal || principal.status === "revoked") throw new Error("Device principal unavailable")
    const authority = await authorizeCollaborationParticipant(ctx, principal._id, args.sessionId)
    if (!authority.allowed) throw new Error("Session membership unavailable")
    const session = authority.session
    return {
      principalId: String(principal._id),
      session: {
        id: session.sessionId,
        projectId: String(session.projectId), repositoryId: session.repositoryId,
        targetBranch: session.targetBranch, sessionBranch: session.sessionBranch,
        baseCommitSha: session.baseCommitSha, publishedCommitSha: session.publishedCommitSha ?? null,
        publishedThroughSequence: session.publishedThroughSequence, roomHeadSequence: session.roomHeadSequence,
        createdByPrincipalId: String(session.createdByPrincipalId),
        commitLeasePrincipalId: session.commitLeasePrincipalId ? String(session.commitLeasePrincipalId) : null,
        commitLeaseExpiresAt: session.commitLeaseExpiresAt ?? null,
        pendingCommitSha: session.pendingCommitSha ?? null,
        pendingCommitThroughSequence: session.pendingCommitThroughSequence ?? null,
        pendingCommitCreatedAt: session.pendingCommitCreatedAt ?? null,
        status: session.status, createdAt: session.createdAt, updatedAt: session.updatedAt,
        closedAt: session.closedAt ?? null,
      },
      role: authority.role,
      expiresAt: Date.now() + 60_000,
    }
  },
})

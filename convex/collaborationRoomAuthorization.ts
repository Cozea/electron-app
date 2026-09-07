import { v } from "convex/values"

import { authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { canAccessProject, canEditProject } from "./lib/projectAccess"

export const authorizeSessionForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const principal = await ctx.db
      .query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", args.identityKey.trim()))
      .unique()
    if (!principal || principal.status === "revoked") return { allowed: false as const }

    const session = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId.trim()))
      .unique()
    if (!session || session.status === "closed" || session.status === "failed") {
      return { allowed: false as const }
    }
    if (!(await canAccessProject(ctx, session.projectId, principal._id))) {
      return { allowed: false as const }
    }

    const participant = await ctx.db
      .query("collaborationParticipants")
      .withIndex("by_session_and_principal", (q) =>
        q.eq("sessionId", session._id).eq("principalId", principal._id),
      )
      .unique()
    if (!participant || participant.leftAt !== undefined) return { allowed: false as const }

    const canEdit = await canEditProject(ctx, session.projectId, principal._id)
    return {
      allowed: true as const,
      principalId: principal._id,
      identityKey: principal.identityKey,
      displayName: principal.displayName,
      projectId: session.projectId,
      sessionDocumentId: session._id,
      sessionId: session.sessionId,
      roomId: `session:${session.sessionId}`,
      role: participant.role === "editor" && canEdit ? "editor" as const : "observer" as const,
      capabilities: participant.capabilities,
      encryptionFingerprint: principal.encryptionFingerprint,
      encryptionPublicKeyJwk: principal.encryptionPublicKeyJwk,
    }
  },
})

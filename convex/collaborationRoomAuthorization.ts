import { v } from "convex/values"

import { authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { canAccessProject } from "./lib/projectAccess"

function assertGatewaySecret(secret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || secret !== expected) throw new Error("Unauthorized")
}

export const authorizeSessionForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
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

    return {
      allowed: true as const,
      principalId: principal._id,
      projectId: session.projectId,
      sessionDocumentId: session._id,
      sessionId: session.sessionId,
      roomId: `session:${session.sessionId}`,
      role: participant.role,
      capabilities: participant.capabilities,
    }
  },
})

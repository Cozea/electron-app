import { v } from "convex/values"

import { query } from "./_generated/server"
import { canAccessProject } from "./lib/projectAccess"

function assertGatewaySecret(secret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || secret !== expected) throw new Error("Unauthorized")
}

export const authorizeSessionForServer = query({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const user = await ctx.db
      .query("users")
      .withIndex("by_identity_key", (index) => index.eq("identityKey", args.identityKey.trim()))
      .unique()
    if (!user || user.status === "revoked") return { allowed: false as const }

    const session = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_session_id", (index) => index.eq("sessionId", args.sessionId.trim()))
      .unique()
    if (!session || session.status === "closed" || session.status === "failed") {
      return { allowed: false as const }
    }
    if (!(await canAccessProject(ctx, session.projectId, user._id))) {
      return { allowed: false as const }
    }

    const participant = await ctx.db
      .query("collaborationParticipants")
      .withIndex("by_session_and_user", (index) =>
        index.eq("sessionId", session._id).eq("userId", user._id),
      )
      .unique()
    if (!participant || participant.leftAt !== undefined) return { allowed: false as const }

    return {
      allowed: true as const,
      userId: user._id,
      projectId: session.projectId,
      sessionDocumentId: session._id,
      sessionId: session.sessionId,
      roomId: `session:${session.sessionId}`,
      role: participant.role,
      capabilities: participant.capabilities,
    }
  },
})

import { v } from "convex/values"
import { makeFunctionReference, type FunctionReference } from "convex/server"
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { canAccessProject } from "./lib/projectAccess"
import { deliverPublicationReference } from "./lib/collaborationPublicationDelivery"

function assertGatewaySecret(secret: string): void {
  if (!process.env.AI_GATEWAY_SECRET || process.env.AI_GATEWAY_SECRET !== secret) throw new Error("Unauthorized")
}

type PublicationArgs = { publicationId: Id<"collaborationPublications"> }
const getReference = makeFunctionReference<"query", PublicationArgs, Doc<"collaborationPublications"> | null>("collaborationPublications:get") as unknown as FunctionReference<"query", "internal", PublicationArgs, Doc<"collaborationPublications"> | null>
const finishReference = makeFunctionReference<"mutation", PublicationArgs & { delivered: boolean }, null>("collaborationPublications:finishAttempt") as unknown as FunctionReference<"mutation", "internal", PublicationArgs & { delivered: boolean }, null>

export const get = internalQuery({ args: { publicationId: v.id("collaborationPublications") }, handler: (ctx, args) => ctx.db.get(args.publicationId) })
export const finishAttempt = internalMutation({
  args: { publicationId: v.id("collaborationPublications"), delivered: v.boolean() },
  handler: async (ctx, args): Promise<null> => {
    const record = await ctx.db.get(args.publicationId)
    if (!record || record.deliveredAt !== undefined) return null
    await ctx.db.patch(record._id, { attempts: record.attempts + 1, ...(args.delivered ? { deliveredAt: Date.now() } : {}) })
    if (!args.delivered) await ctx.scheduler.runAfter(Math.min(300_000, 1000 * 2 ** Math.min(record.attempts, 8)), deliverPublicationReference, { publicationId: record._id })
    return null
  },
})
export const deliver = internalAction({
  args: { publicationId: v.id("collaborationPublications") },
  handler: async (ctx, args): Promise<null> => {
    const record = await ctx.runQuery(getReference, args)
    if (!record || record.deliveredAt !== undefined) return null
    let delivered = false
    try {
      const secret = process.env.AI_GATEWAY_SECRET
      if (!secret) throw new Error("Gateway delivery is not configured")
      const response = await fetch("https://cozea-collab.kelyan-engone.workers.dev/collab/internal/publication", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ sessionId: record.publicSessionId, commitSha: record.commitSha, coveredThroughSequence: record.coveredThroughSequence, publicationId: record._id, publicationRevision: record.publicationRevision }),
      })
      delivered = response.ok
    } catch { /* Retry without recording URLs, credentials or content. */ }
    await ctx.runMutation(finishReference, { ...args, delivered })
    return null
  },
})

export const receiptForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string(), commitSha: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const user = await ctx.db.query("users").withIndex("by_identity_key", q => q.eq("identityKey", args.identityKey)).unique()
    const session = await ctx.db.query("collaborationSessions").withIndex("by_session_id", q => q.eq("sessionId", args.sessionId)).unique()
    if (!user || user.status === "revoked" || !session || !await canAccessProject(ctx, session.projectId, user._id)) return null
    const publication = await ctx.db.query("collaborationPublications").withIndex("by_session_and_commit", q => q.eq("sessionId", session._id).eq("commitSha", args.commitSha)).unique()
    if (!publication) return null
    return { verified: true, sessionId: session.sessionId, sessionBranch: session.sessionBranch, commitSha: publication.commitSha, coveredThroughSequence: publication.coveredThroughSequence, baseAdvanced: true }
  },
})

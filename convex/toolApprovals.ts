import { mutation } from "./_generated/server"
import { v } from "convex/values"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

export const create = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    toolName: v.string(),
    toolInput: v.any(),
    approvalId: v.optional(v.string()),
    conversationId: v.string(),
    messageId: v.optional(v.string()),
    agentRunId: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    if (args.approvalId) {
      const existing = await ctx.db
        .query("toolApprovalRequests")
        .withIndex("by_approval_id", (q) => q.eq("approvalId", args.approvalId))
        .first()

      if (existing) {
        return { approvalRequestId: existing._id, alreadyExists: true }
      }
    }

    const now = Date.now()
    const expiresAt = args.expiresAt ?? now + 60 * 60 * 1000 // 1 hour default

    const approvalRequestId = await ctx.db.insert("toolApprovalRequests", {
      organizationId: args.organizationId,
      userId: args.userId,
      toolName: args.toolName,
      toolInput: args.toolInput,
      approvalId: args.approvalId,
      conversationId: args.conversationId,
      agentRunId: args.agentRunId,
      messageId: args.messageId,
      status: "pending",
      expiresAt,
      createdAt: now,
    })

    return { approvalRequestId, alreadyExists: false }
  },
})

export const resolve = mutation({
  args: {
    approvalId: v.string(),
    approved: v.boolean(),
    resolvedBy: v.optional(v.id("users")),
    rejectionReason: v.optional(v.string()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const request = await ctx.db
      .query("toolApprovalRequests")
      .withIndex("by_approval_id", (q) => q.eq("approvalId", args.approvalId))
      .first()

    if (!request) {
      throw new Error("Approval request not found")
    }

    const now = Date.now()
    await ctx.db.patch(request._id, {
      status: args.approved ? "approved" : "rejected",
      resolvedBy: args.resolvedBy,
      resolvedAt: now,
      rejectionReason: args.approved ? undefined : args.rejectionReason,
    })

    return { approvalRequestId: request._id, status: args.approved ? "approved" : "rejected" }
  },
})

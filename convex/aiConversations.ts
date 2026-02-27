import { v } from "convex/values"
import { internalMutation, mutation, query } from "./_generated/server"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET
const CONTINUATION_STATE_TTL_MS = 24 * 60 * 60 * 1000

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

/**
 * Create a new conversation.
 */
export const create = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { projectId, userId, title } = args

    return await ctx.db.insert("aiConversations", {
      projectId,
      userId,
      title: title || "New Conversation",
      messages: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  },
})

/**
 * Get a conversation by ID.
 */
export const get = query({
  args: {
    id: v.id("aiConversations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

/**
 * List conversations for a user in a project.
 * Returns conversations sorted by most recent first.
 */
export const list = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { projectId, userId, status = "active", limit = 50 } = args

    const conversations = await ctx.db
      .query("aiConversations")
      .withIndex("by_project_user_status", (q) =>
        q.eq("projectId", projectId).eq("userId", userId).eq("status", status)
      )
      .order("desc")
      .take(limit)

    return conversations.map((conv) => ({
      _id: conv._id,
      title: conv.title,
      status: conv.status,
      messageCount: conv.messages.length,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }))
  },
})

/**
 * Save/update messages in a conversation.
 */
export const saveMessages = mutation({
  args: {
    conversationId: v.id("aiConversations"),
    messages: v.array(v.object({
      id: v.string(),
      role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
      content: v.string(),
      createdAt: v.number(),
      toolInvocations: v.optional(v.any()),
      attachments: v.optional(v.array(v.object({
        url: v.string(),
        contentType: v.string(),
      }))),
    })),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { conversationId, messages, title } = args

    const updates: {
      messages: typeof messages
      updatedAt: number
      title?: string
    } = {
      messages,
      updatedAt: Date.now(),
    }

    if (title) {
      updates.title = title
    }

    await ctx.db.patch(conversationId, updates)
  },
})

/**
 * Update conversation title.
 */
export const updateTitle = mutation({
  args: {
    conversationId: v.id("aiConversations"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      title: args.title,
      updatedAt: Date.now(),
    })
  },
})

/**
 * Archive a conversation (soft delete).
 */
export const archive = mutation({
  args: {
    id: v.id("aiConversations"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "archived",
      updatedAt: Date.now(),
    })
  },
})

/**
 * Restore an archived conversation.
 */
export const restore = mutation({
  args: {
    id: v.id("aiConversations"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "active",
      updatedAt: Date.now(),
    })
  },
})

/**
 * Permanently delete a conversation.
 */
export const remove = mutation({
  args: {
    id: v.id("aiConversations"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id)
  },
})

/**
 * Server-only: Read continuation linkage state for Responses-style providers.
 */
export const getContinuationStateForServer = query({
  args: {
    organizationId: v.string(),
    conversationId: v.string(),
    provider: v.union(v.literal("openai"), v.literal("github-copilot")),
    model: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const state = await ctx.db
      .query("aiContinuationState")
      .withIndex("by_org_conversation_provider_model", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("conversationId", args.conversationId)
          .eq("provider", args.provider)
          .eq("model", args.model)
      )
      .first()

    if (!state) {
      return null
    }

    if (state.expiresAt <= Date.now()) {
      return null
    }

    return {
      previousResponseId: state.previousResponseId,
      updatedAt: state.updatedAt,
      expiresAt: state.expiresAt,
    }
  },
})

/**
 * Server-only: Upsert continuation linkage state for Responses-style providers.
 */
export const upsertContinuationStateForServer = mutation({
  args: {
    organizationId: v.string(),
    conversationId: v.string(),
    provider: v.union(v.literal("openai"), v.literal("github-copilot")),
    model: v.string(),
    previousResponseId: v.string(),
    expiresAt: v.optional(v.number()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const previousResponseId = args.previousResponseId.trim()
    if (!previousResponseId) {
      throw new Error("previousResponseId is required")
    }

    const now = Date.now()
    const expiresAt = args.expiresAt ?? now + CONTINUATION_STATE_TTL_MS

    const existing = await ctx.db
      .query("aiContinuationState")
      .withIndex("by_org_conversation_provider_model", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("conversationId", args.conversationId)
          .eq("provider", args.provider)
          .eq("model", args.model)
      )
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        previousResponseId,
        updatedAt: now,
        expiresAt,
      })
      return {
        previousResponseId,
        updatedAt: now,
        expiresAt,
      }
    }

    await ctx.db.insert("aiContinuationState", {
      organizationId: args.organizationId,
      conversationId: args.conversationId,
      provider: args.provider,
      model: args.model,
      previousResponseId,
      updatedAt: now,
      expiresAt,
    })

    return {
      previousResponseId,
      updatedAt: now,
      expiresAt,
    }
  },
})

/**
 * Server-only: Clear one continuation linkage row.
 */
export const clearContinuationStateForServer = mutation({
  args: {
    organizationId: v.string(),
    conversationId: v.string(),
    provider: v.union(v.literal("openai"), v.literal("github-copilot")),
    model: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const existing = await ctx.db
      .query("aiContinuationState")
      .withIndex("by_org_conversation_provider_model", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("conversationId", args.conversationId)
          .eq("provider", args.provider)
          .eq("model", args.model)
      )
      .first()

    if (!existing) {
      return { deletedCount: 0 }
    }

    await ctx.db.delete(existing._id)
    return { deletedCount: 1 }
  },
})

/**
 * Server-only: Clear all continuation linkage rows for a conversation.
 */
export const clearConversationContinuationStateForServer = mutation({
  args: {
    organizationId: v.string(),
    conversationId: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const matches = await ctx.db
      .query("aiContinuationState")
      .withIndex("by_org_conversation", (q) =>
        q.eq("organizationId", args.organizationId).eq("conversationId", args.conversationId)
      )
      .collect()

    for (const row of matches) {
      await ctx.db.delete(row._id)
    }

    return { deletedCount: matches.length }
  },
})

/**
 * Internal: Cleanup expired continuation rows.
 */
export const cleanupExpiredContinuationState = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const expired = await ctx.db
      .query("aiContinuationState")
      .withIndex("by_expires_at", (q) => q.lte("expiresAt", now))
      .collect()

    for (const row of expired) {
      await ctx.db.delete(row._id)
    }

    return { deletedCount: expired.length }
  },
})

import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

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

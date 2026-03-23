import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

// Plan option schema for validation
const planOptionValidator = v.object({
  tier: v.union(v.literal("prototype"), v.literal("beta"), v.literal("mvp")),
  name: v.string(),
  description: v.string(),
  features: v.array(v.string()),
  estimatedScope: v.optional(v.string()),
  config: v.object({
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    audience: v.optional(v.string()),
    targetPlatform: v.optional(v.union(v.literal("web"))),
    buildContract: v.optional(
      v.object({
        previewMode: v.union(v.literal("web")),
        frameworkClass: v.union(v.literal("web-framework")),
        toolchain: v.optional(v.any()),
        commands: v.optional(v.any()),
        constraints: v.optional(v.any()),
        fallbackPolicy: v.optional(v.any()),
        successCriteria: v.optional(v.any()),
        telemetryHints: v.optional(v.any()),
      })
    ),
    template: v.optional(v.string()),
    stack: v.optional(
      v.object({
        backend: v.string(),
        hosting: v.string(),
        aiProvider: v.string(),
      })
    ),
    sourceControl: v.optional(
      v.object({
        provider: v.string(),
        repoUrl: v.optional(v.string()),
        defaultBranch: v.optional(v.string()),
        visibility: v.string(),
        mergeStrategy: v.string(),
      })
    ),
    visuals: v.optional(
      v.object({
        uiLibrary: v.string(),
        vibeDescription: v.optional(v.string()),
        colorPreset: v.optional(v.string()),
        primaryColor: v.string(),
        secondaryColor: v.string(),
        accentColor: v.string(),
        logoUrl: v.optional(v.string()),
      })
    ),
    generatedPlan: v.optional(
      v.object({
        pages: v.array(
          v.object({
            id: v.string(),
            name: v.string(),
            route: v.string(),
            type: v.string(),
            purpose: v.optional(v.string()),
            actions: v.optional(v.array(v.string())),
          })
        ),
        entities: v.array(
          v.object({
            id: v.string(),
            name: v.string(),
            fields: v.optional(v.array(v.string())),
          })
        ),
      })
    ),
  }),
})

// Get all messages for a project (ordered by creation time)
export const list = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("projectMessages")
      .withIndex("by_project_and_created", (q) => q.eq("projectId", args.projectId))
      .collect()

    return messages
  },
})

// Add a user message
export const addUserMessage = mutation({
  args: {
    projectId: v.id("projects"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("projectMessages", {
      projectId: args.projectId,
      role: "user",
      content: args.content,
      createdAt: Date.now(),
    })

    return { messageId }
  },
})

// Add an assistant message
export const addAssistantMessage = mutation({
  args: {
    projectId: v.id("projects"),
    content: v.string(),
    planOptions: v.optional(v.array(planOptionValidator)),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("projectMessages", {
      projectId: args.projectId,
      role: "assistant",
      content: args.content,
      planOptions: args.planOptions,
      createdAt: Date.now(),
    })

    return { messageId }
  },
})

// Update an assistant message (e.g., for streaming)
export const updateAssistantMessage = mutation({
  args: {
    messageId: v.id("projectMessages"),
    content: v.string(),
    planOptions: v.optional(v.array(planOptionValidator)),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      content: args.content,
      planOptions: args.planOptions,
    })

    return { success: true }
  },
})

// Delete all messages for a project (for reset)
export const clearMessages = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("projectMessages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()

    for (const message of messages) {
      await ctx.db.delete(message._id)
    }

    return { deleted: messages.length }
  },
})

// Get the latest message with plan options (for plan selection UI)
export const getLatestPlanOptions = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("projectMessages")
      .withIndex("by_project_and_created", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect()

    // Find the most recent message with plan options
    const messageWithPlans = messages.find((m) => m.planOptions && m.planOptions.length > 0)

    return messageWithPlans?.planOptions ?? null
  },
})

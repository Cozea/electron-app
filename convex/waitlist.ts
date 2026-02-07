import { mutation } from "./_generated/server"
import { v } from "convex/values"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET
const MAX_NAME_LENGTH = 120
const MAX_SOURCE_LENGTH = 120

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export const submitForServer = mutation({
  args: {
    serverSecret: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    roleHint: v.union(v.literal("nontechnical"), v.literal("developer"), v.literal("both")),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const normalizedEmail = args.email.trim().toLowerCase()
    if (!isValidEmail(normalizedEmail)) {
      throw new Error("Invalid email")
    }

    const email = args.email.trim()
    const name = args.name?.trim().slice(0, MAX_NAME_LENGTH) || undefined
    const source = args.source?.trim().slice(0, MAX_SOURCE_LENGTH) || undefined
    const now = Date.now()

    const existing = await ctx.db
      .query("waitlistSubmissions")
      .withIndex("by_normalized_email", (q) => q.eq("normalizedEmail", normalizedEmail))
      .first()

    if (!existing) {
      const id = await ctx.db.insert("waitlistSubmissions", {
        email,
        normalizedEmail,
        name,
        roleHint: args.roleHint,
        source,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })

      return { id, status: "pending" as const, isNew: true }
    }

    if (existing.status === "pending") {
      await ctx.db.patch(existing._id, {
        email,
        normalizedEmail,
        name,
        roleHint: args.roleHint,
        source,
        updatedAt: now,
      })
    }

    return {
      id: existing._id,
      status: existing.status,
      isNew: false,
    }
  },
})

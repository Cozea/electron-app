import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

type BuiltinTool = {
  name: string
  displayName: string
  description: string
  category: string
  inputSchema: Record<string, unknown>
  requiresApproval: boolean
  allowedRoles: readonly string[]
  riskLevel: string
  executionEnvironment: string
  isBuiltin: boolean
  isEnabled: boolean
  provider?: string
  toolType?: string
  providerToolId?: string
  providerToolArgs?: Record<string, unknown>
  supportsDeferredResults?: boolean
}

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

const TODO_ITEM_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["content", "status"],
  properties: {
    content: {
      type: "string",
      minLength: 1,
    },
    activeForm: {
      type: "string",
      minLength: 1,
    },
    status: {
      type: "string",
      enum: ["pending", "in_progress", "completed"],
    },
    files: {
      type: "array",
      items: { type: "string" },
    },
  },
}

const BUILTIN_TOOLS: BuiltinTool[] = [
  {
    name: "web_search",
    displayName: "Web Search",
    description: "Search the web using provider-native web search when available.",
    category: "web",
    provider: "openai",
    toolType: "provider",
    providerToolId: "openai.web_search",
    providerToolArgs: {},
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Search query.",
        },
      },
    },
    requiresApproval: false,
    allowedRoles: ["admin", "member", "viewer"],
    riskLevel: "safe",
    executionEnvironment: "provider",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "plan_write",
    displayName: "Present Project Plans",
    description: "Present exactly 3 plan options (prototype, beta, mvp).",
    category: "data",
    inputSchema: {
      type: "object",
      required: ["plans"],
      properties: {
        plans: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            required: ["tier", "name", "description", "features", "config"],
            properties: {
              tier: {
                type: "string",
                enum: ["prototype", "beta", "mvp"],
              },
              name: { type: "string" },
              description: { type: "string" },
              features: {
                type: "array",
                minItems: 3,
                items: { type: "string" },
              },
              config: {
                type: "object",
                required: ["targetPlatform"],
                properties: {
                  targetPlatform: {
                    type: "string",
                    enum: ["web"],
                  },
                  buildContract: {
                    type: "object",
                    properties: {
                      previewMode: { type: "string", enum: ["web"] },
                      frameworkClass: { type: "string", enum: ["web-framework"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    requiresApproval: false,
    allowedRoles: ["admin", "member", "viewer"],
    riskLevel: "safe",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "todowrite",
    displayName: "Build Tasks",
    description: "Track project-generation task progress.",
    category: "data",
    inputSchema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: TODO_ITEM_SCHEMA,
        },
        todos: {
          type: "array",
          items: TODO_ITEM_SCHEMA,
        },
        tasks_json: {
          type: "string",
          description: "Compatibility JSON payload for providers that require a string input.",
        },
      },
      anyOf: [{ required: ["tasks"] }, { required: ["todos"] }, { required: ["tasks_json"] }],
    },
    requiresApproval: false,
    allowedRoles: ["admin", "member", "viewer"],
    riskLevel: "safe",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "build_complete",
    displayName: "Mark Build Complete",
    description: "Signal that project generation has completed.",
    category: "data",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
    },
    requiresApproval: false,
    allowedRoles: ["admin", "member", "viewer"],
    riskLevel: "safe",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "preview_start",
    displayName: "Start Preview",
    description: "Start the live preview as soon as the app should render something visible.",
    category: "data",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
    },
    requiresApproval: false,
    allowedRoles: ["admin", "member", "viewer"],
    riskLevel: "safe",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "preview_browser",
    displayName: "Inspect Preview",
    description: "Inspect or interact with the live preview using Playwright before finalizing the build.",
    category: "web",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["snapshot", "navigate", "click", "type", "press", "wait_for", "screenshot"],
        },
        path: { type: "string" },
        url: { type: "string" },
        element: { type: "string" },
        ref: { type: "string" },
        text: { type: "string" },
        textGone: { type: "string" },
        time: { type: "number" },
        key: { type: "string" },
        submit: { type: "boolean" },
        slowly: { type: "boolean" },
        filename: { type: "string" },
        fullPage: { type: "boolean" },
        type: { type: "string", enum: ["png", "jpeg"] },
        doubleClick: { type: "boolean" },
        button: { type: "string", enum: ["left", "middle", "right"] },
        modifiers: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    requiresApproval: false,
    allowedRoles: ["admin", "member", "viewer"],
    riskLevel: "safe",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: true,
  },
]

const CANONICAL_TOOL_NAMES = new Set(BUILTIN_TOOLS.map((tool) => tool.name))
const LEGACY_TOOL_NAMES = [
  "read",
  "list",
  "glob",
  "grep",
  "write",
  "edit",
  "multiedit",
  "bash",
  "apply_patch",
  "read_file",
  "list_dir",
  "file_search",
  "grep_search",
  "create_file",
  "create_directory",
  "replace_string_in_file",
  "multi_replace_string_in_file",
  "run_in_terminal",
  "get_terminal_output",
  "present_plans",
  "build_tasks",
  "mark_complete",
  "todo_list",
]

export const syncBuiltinTools = mutation({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const now = Date.now()
    let created = 0
    let updated = 0

    for (const tool of BUILTIN_TOOLS) {
      const existing = await ctx.db
        .query("tools")
        .withIndex("by_name", (q) => q.eq("name", tool.name))
        .first()

      const toolData = {
        name: tool.name,
        displayName: tool.displayName,
        description: tool.description,
        category: tool.category as "filesystem" | "web" | "code" | "data" | "custom",
        provider: tool.provider as "anthropic" | "openai" | "google" | "xai" | undefined,
        inputSchema: tool.inputSchema,
        toolType: (tool.toolType ?? "function") as "function" | "provider",
        providerToolId: tool.providerToolId,
        providerToolArgs: tool.providerToolArgs,
        supportsDeferredResults: tool.supportsDeferredResults,
        requiresApproval: tool.requiresApproval,
        allowedRoles: [...tool.allowedRoles] as ("admin" | "member" | "viewer")[],
        riskLevel: tool.riskLevel as "safe" | "moderate" | "dangerous",
        executionEnvironment: tool.executionEnvironment as "local" | "server" | "provider",
        isBuiltin: tool.isBuiltin,
        isEnabled: tool.isEnabled,
      }

      if (!existing) {
        await ctx.db.insert("tools", {
          ...toolData,
          createdAt: now,
          updatedAt: now,
        })
        created++
      } else {
        await ctx.db.patch(existing._id, {
          ...toolData,
          updatedAt: now,
        })
        updated++
      }
    }

    return { created, updated }
  },
})

export const purgeLegacyTools = mutation({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const tools = await ctx.db.query("tools").collect()
    const explicitLegacy = new Set(LEGACY_TOOL_NAMES)
    let removed = 0

    for (const tool of tools) {
      const nonCanonicalBuiltin = tool.isBuiltin === true && !CANONICAL_TOOL_NAMES.has(tool.name)
      const isLegacy = explicitLegacy.has(tool.name)
      if (!nonCanonicalBuiltin && !isLegacy) continue
      await ctx.db.delete(tool._id)
      removed++
    }

    return { removed }
  },
})

export const listEnabledTools = query({
  args: {
    role: v.optional(v.union(v.literal("admin"), v.literal("member"), v.literal("viewer"))),
  },
  handler: async (ctx, args) => {
    const tools = await ctx.db
      .query("tools")
      .filter((q) => q.eq(q.field("isEnabled"), true))
      .collect()

    if (!args.role) return tools

    return tools.filter((tool) => tool.allowedRoles.includes(args.role!))
  },
})

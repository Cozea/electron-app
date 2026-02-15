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

const BUILTIN_TOOLS: BuiltinTool[] = [
  {
    name: "read",
    displayName: "Read File",
    description: "Read the contents of a file. Line numbers are 1-indexed. This tool will truncate its output at 2000 lines and may be called repeatedly with offset and limit parameters to read larger files in chunks.",
    category: "filesystem",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          description: "The absolute path of the file to read.",
          type: "string",
        },
        offset: {
          description: "Optional: the 1-based line number to start reading from. Only use this if the file is too large to read at once. If not specified, the file will be read from the beginning.",
          type: "number",
        },
        limit: {
          description: "Optional: the maximum number of lines to read. Only use this together with `offset` if the file is too large to read at once.",
          type: "number",
        },
      },
      required: ["filePath"],
    },
    requiresApproval: false,
    allowedRoles: ["admin", "member", "viewer"],
    riskLevel: "safe",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "list",
    displayName: "List Directory",
    description: "List the contents of a directory. Result will have the name of the child. If the name ends in /, it's a folder, otherwise a file",
    category: "filesystem",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          description: "The absolute path to the directory to list. If omitted, the current workspace directory is used.",
          type: "string",
        },
        ignore: {
          description: "Optional glob patterns to ignore.",
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
  {
    name: "glob",
    displayName: "Find Files",
    description: "Find files using a glob pattern.",
    category: "filesystem",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: {
          description: "The glob pattern to match files against.",
          type: "string",
        },
        path: {
          description: "Optional directory to search in. Defaults to the current workspace directory.",
          type: "string",
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
    name: "grep",
    displayName: "Find Text in Files",
    description: "Search file contents using a regular expression.",
    category: "filesystem",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: {
          description: "The regex pattern to search for in file contents.",
          type: "string",
        },
        path: {
          description: "Optional directory to search in. Defaults to the current workspace directory.",
          type: "string",
        },
        include: {
          description: "Optional file include glob (for example, \"*.ts\" or \"*.{ts,tsx}\").",
          type: "string",
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
    name: "write",
    displayName: "Create File",
    description: "This is a tool for creating a new file in the workspace. The file will be created with the specified content. The directory will be created if it does not already exist. Never use this tool to edit a file that already exists.",
    category: "filesystem",
    inputSchema: {
      type: "object",
      required: ["filePath", "content"],
      properties: {
        filePath: {
          description: "The absolute path of the file to create.",
          type: "string",
        },
        content: {
          description: "The file contents.",
          type: "string",
        },
      },
    },
    requiresApproval: true,
    allowedRoles: ["admin", "member"],
    riskLevel: "dangerous",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "edit",
    displayName: "Replace String",
    description: "This is a tool for making edits in an existing file in the workspace. For moving or renaming files, use run in terminal tool with the 'mv' command instead. For larger edits, split them into smaller edits and call the edit tool multiple times to ensure accuracy. Before editing, always ensure you have the context to understand the file's contents and context. To edit a file, provide: 1) filePath (absolute path), 2) oldString (MUST be the exact literal text to replace including all whitespace, indentation, newlines, and surrounding code etc), and 3) newString (MUST be the exact literal text to replace `oldString` with (also including all whitespace, indentation, newlines, and surrounding code etc.). Ensure the resulting code is correct and idiomatic.). Each use of this tool replaces exactly ONE occurrence of oldString.\n\nCRITICAL for `oldString`: Must uniquely identify the single instance to change. Include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely. If this string matches multiple locations, or does not match exactly, the tool will fail. Never use 'Lines 123-456 omitted' from summarized documents or ...existing code... comments in the oldString or newString.",
    category: "filesystem",
    inputSchema: {
      type: "object",
      required: ["filePath", "oldString", "newString"],
      properties: {
        filePath: {
          description: "An absolute path to the file to edit.",
          type: "string",
        },
        oldString: {
          description: "The exact literal text to replace, preferably unescaped. For single replacements (default), include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely. For multiple replacements, specify expected_replacements parameter. If this string is not the exact literal text (i.e. you escaped it) or does not match exactly, the tool will fail.",
          type: "string",
        },
        newString: {
          description: "The exact literal text to replace `oldString` with, preferably unescaped. Provide the EXACT text. Ensure the resulting code is correct and idiomatic.",
          type: "string",
        },
        replaceAll: {
          description: "Replace all occurrences of oldString. Defaults to false.",
          type: "boolean",
        },
      },
    },
    requiresApproval: true,
    allowedRoles: ["admin", "member"],
    riskLevel: "dangerous",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "multiedit",
    displayName: "Multi Replace String",
    description: "Apply multiple edit operations sequentially to a file.",
    category: "filesystem",
    inputSchema: {
      type: "object",
      required: ["filePath", "edits"],
      properties: {
        filePath: {
          description: "The absolute path to the file to modify.",
          type: "string",
        },
        edits: {
          description: "Array of edit operations to perform sequentially.",
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["filePath", "oldString", "newString"],
            properties: {
              filePath: {
                description: "An absolute path to the file to edit.",
                type: "string",
              },
              oldString: {
                description: "The exact literal text to replace, preferably unescaped. Include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely. If this string is not the exact literal text or does not match exactly, this replacement will fail.",
                type: "string",
              },
              newString: {
                description: "The exact literal text to replace `oldString` with, preferably unescaped. Provide the EXACT text. Ensure the resulting code is correct and idiomatic.",
                type: "string",
              },
              replaceAll: {
                description: "Replace all occurrences of oldString. Defaults to false.",
                type: "boolean",
              },
            },
          },
        },
      },
    },
    requiresApproval: true,
    allowedRoles: ["admin", "member"],
    riskLevel: "dangerous",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "bash",
    displayName: "Run in Terminal",
    description: "Run a shell command in the workspace.",
    category: "code",
    inputSchema: {
      type: "object",
      required: ["command", "description"],
      properties: {
        command: {
          description: "The command to run in the terminal.",
          type: "string",
        },
        timeout: {
          description: "Optional timeout in milliseconds.",
          type: "number",
        },
        workdir: {
          description: "Optional working directory. Defaults to the current workspace directory.",
          type: "string",
        },
        description: {
          description: "Clear, concise description of what this command does in 5-10 words.",
          type: "string",
        },
      },
    },
    requiresApproval: true,
    allowedRoles: ["admin", "member"],
    riskLevel: "dangerous",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "apply_patch",
    displayName: "Apply Patch",
    description: "Apply a patch to files using the apply_patch patch format.",
    category: "code",
    inputSchema: {
      type: "object",
      required: ["patchText"],
      properties: {
        patchText: {
          description: "The full patch text that describes all changes to be made.",
          type: "string",
        },
      },
    },
    requiresApproval: true,
    allowedRoles: ["admin", "member"],
    riskLevel: "dangerous",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: false,
  },
  {
    name: "web_search",
    displayName: "Web Search",
    description: "Search the web for up-to-date information.",
    category: "web",
    provider: "openai",
    toolType: "provider",
    providerToolId: "openai.web_search",
    providerToolArgs: {},
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query.",
        },
      },
      required: ["query"],
    },
    requiresApproval: false,
    allowedRoles: ["admin", "member", "viewer"],
    riskLevel: "safe",
    executionEnvironment: "provider",
    isBuiltin: true,
    isEnabled: false,
  },
  {
    name: "google_search",
    displayName: "Google Search",
    description: "Search the web with Google Search grounding.",
    category: "web",
    provider: "google",
    toolType: "provider",
    providerToolId: "google.google_search",
    providerToolArgs: {},
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query.",
        },
      },
      required: ["query"],
    },
    requiresApproval: false,
    allowedRoles: ["admin", "member", "viewer"],
    riskLevel: "safe",
    executionEnvironment: "provider",
    isBuiltin: true,
    isEnabled: false,
  },
  {
    name: "plan_write",
    displayName: "Present Project Plans",
    description: "Present 3 web project plan options (prototype, beta, mvp).",
    category: "data",
    inputSchema: {
      type: "object",
      required: ["plans"],
      properties: {
        plans: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: { type: "object" },
        },
      },
    },
    requiresApproval: false,
    allowedRoles: ["admin", "member", "viewer"],
    riskLevel: "safe",
    executionEnvironment: "server",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "todowrite",
    displayName: "Build Tasks",
    description: "Track and update build progress tasks during project generation.",
    category: "data",
    inputSchema: {
      type: "object",
      required: ["tasks"],
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            required: ["content", "activeForm", "status"],
            properties: {
              content: { type: "string" },
              activeForm: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              files: { type: "array", items: { type: "string" } },
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
    name: "build_complete",
    displayName: "Mark Build Complete",
    description: "Signal that project generation is complete.",
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
]

const CANONICAL_TOOL_NAMES = new Set(BUILTIN_TOOLS.map((tool) => tool.name))
const LEGACY_TOOL_NAMES = [
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

      // Convert to proper types for db insertion
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

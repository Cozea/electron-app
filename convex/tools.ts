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
    name: "read_file",
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
        startLine: {
          description: "The line number to start reading from, 1-based.",
          type: "number",
        },
        endLine: {
          description: "The inclusive line number to end reading at, 1-based.",
          type: "number",
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
    name: "list_dir",
    displayName: "List Directory",
    description: "List the contents of a directory. Result will have the name of the child. If the name ends in /, it's a folder, otherwise a file",
    category: "filesystem",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          description: "The absolute path to the directory to list.",
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
    name: "file_search",
    displayName: "Find Files",
    description: "Search for files in the workspace by glob pattern. This only returns the paths of matching files. Use this tool when you know the exact filename pattern of the files you're searching for. Glob patterns match from the root of the workspace folder. Examples:\n- **/*.{js,ts} to match all js/ts files in the workspace.\n- src/** to match all files under the top-level src folder.\n- **/foo/**/*.js to match all js files under any foo folder in the workspace.",
    category: "filesystem",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          description: "Search for files with names or paths matching this glob pattern.",
          type: "string",
        },
        maxResults: {
          description: "The maximum number of results to return. Do not use this unless necessary, it can slow things down. By default, only some matches are returned. If you use this and don't see what you're looking for, you can try again with a more specific query or a larger maxResults.",
          type: "number",
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
    name: "grep_search",
    displayName: "Find Text in Files",
    description: "Do a fast text search in the workspace. Use this tool when you want to search with an exact string or regex. If you are not sure what words will appear in the workspace, prefer using regex patterns with alternation (|) or character classes to search for multiple potential words at once instead of making separate searches. For example, use 'function|method|procedure' to look for all of those words at once. Use includePattern to search within files matching a specific pattern, or in a specific file, using a relative path. Use 'includeIgnoredFiles' to include files normally ignored by .gitignore, other ignore files, and `files.exclude` and `search.exclude` settings. Warning: using this may cause the search to be slower, only set it when you want to search in ignored folders like node_modules or build outputs. Use this tool when you want to see an overview of a particular file, instead of using read_file many times to look for code within a file.",
    category: "filesystem",
    inputSchema: {
      type: "object",
      required: ["query", "isRegexp"],
      properties: {
        query: {
          description: "The pattern to search for in files in the workspace. Use regex with alternation (e.g., 'word1|word2|word3') or character classes to find multiple potential words in a single search. Be sure to set the isRegexp property properly to declare whether it's a regex or plain text pattern. Is case-insensitive.",
          type: "string",
        },
        isRegexp: {
          description: "Whether the pattern is a regex.",
          type: "boolean",
        },
        includePattern: {
          description: "Search files matching this glob pattern. Will be applied to the relative path of files within the workspace. To search recursively inside a folder, use a proper glob pattern like \"src/folder/**\". Do not use | in includePattern.",
          type: "string",
        },
        maxResults: {
          description: "The maximum number of results to return. Do not use this unless necessary, it can slow things down. By default, only some matches are returned. If you use this and don't see what you're looking for, you can try again with a more specific query or a larger maxResults.",
          type: "number",
        },
        includeIgnoredFiles: {
          description: "Whether to include files that would normally be ignored according to .gitignore, other ignore files and `files.exclude` and `search.exclude` settings. Warning: using this may cause the search to be slower. Only set it when you want to search in ignored folders like node_modules or build outputs.",
          type: "boolean",
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
    name: "create_file",
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
    name: "create_directory",
    displayName: "Create Directory",
    description: "Create a new directory structure in the workspace. Will recursively create all directories in the path, like mkdir -p. You do not need to use this tool before using create_file, that tool will automatically create the needed directories.",
    category: "filesystem",
    inputSchema: {
      type: "object",
      required: ["dirPath"],
      properties: {
        dirPath: {
          description: "The absolute path of the directory to create.",
          type: "string",
        },
      },
    },
    requiresApproval: true,
    allowedRoles: ["admin", "member"],
    riskLevel: "moderate",
    executionEnvironment: "local",
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: "replace_string_in_file",
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
    name: "multi_replace_string_in_file",
    displayName: "Multi Replace String",
    description: "This tool allows you to apply multiple replace_string_in_file operations in a single call, which is more efficient than calling replace_string_in_file multiple times. It takes an array of replacement operations and applies them sequentially. Each replacement operation has the same parameters as replace_string_in_file: filePath, oldString, newString, and explanation. This tool is ideal when you need to make multiple edits across different files or multiple edits in the same file. The tool will provide a summary of successful and failed operations.",
    category: "filesystem",
    inputSchema: {
      type: "object",
      required: ["replacements", "explanation"],
      properties: {
        explanation: {
          description: "A brief explanation of what the multi-replace operation will accomplish.",
          type: "string",
        },
        replacements: {
          description: "An array of replacement operations to apply sequentially.",
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["explanation", "filePath", "oldString", "newString"],
            properties: {
              explanation: {
                description: "A brief explanation of this specific replacement operation.",
                type: "string",
              },
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
    name: "run_in_terminal",
    displayName: "Run in Terminal",
    description: "Run a shell command in the workspace. Use absolute paths. For long-running commands (watch mode, dev servers), set isBackground=true. Use get_terminal_output to check background command output.",
    category: "code",
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: {
          description: "The command to run in the terminal.",
          type: "string",
        },
        explanation: {
          description: "A one-sentence description of what the command does.",
          type: "string",
        },
        isBackground: {
          description: "Whether the command starts a background process. Defaults to false.",
          type: "boolean",
          default: false,
        },
        timeout: {
          description: "Timeout in milliseconds. Use 0 or omit for no timeout. Defaults to 0.",
          type: "number",
          default: 0,
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
    name: "get_terminal_output",
    displayName: "Get Terminal Output",
    description: "Get the output of a background terminal command started with run_in_terminal.",
    category: "code",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: {
          description: "The terminal id returned by run_in_terminal.",
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
    name: "apply_patch",
    displayName: "Apply Patch",
    description: "Edit text files. Do not use this tool to edit Jupyter notebooks. `apply_patch` allows you to execute a diff/patch against a text file, but the format of the diff specification is unique to this task, so pay careful attention to these instructions. To use the `apply_patch` command, you should pass a message of the following structure as \"input\":\n\n*** Begin Patch\n[YOUR_PATCH]\n*** End Patch\n\nWhere [YOUR_PATCH] is the actual content of your patch, specified in the following V4A diff format.\n\n*** [ACTION] File: [/absolute/path/to/file] -> ACTION can be one of Add, Update, or Delete.\nAn example of a message that you might pass as \"input\" to this function, in order to apply a patch, is shown below.\n\n*** Begin Patch\n*** Update File: /Users/someone/pygorithm/searching/binary_search.py\n@@class BaseClass\n@@    def search():\n-        pass\n+        raise NotImplementedError()\n\n@@class Subclass\n@@    def search():\n-        pass\n+        raise NotImplementedError()\n\n*** End Patch\nDo not use line numbers in this diff format.",
    category: "code",
    inputSchema: {
      type: "object",
      required: ["input", "explanation"],
      properties: {
        input: {
          description: "Patch content in apply_patch format.",
          type: "string",
        },
        explanation: {
          description: "Why the patch is needed.",
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
    name: "todo_list",
    displayName: "Todo List",
    description: "Present or update a structured task list with statuses.",
    category: "custom",
    inputSchema: {
      type: "object",
      required: ["tasks"],
      properties: {
        tasks: {
          type: "array",
          description: "List of tasks to display to the user.",
          items: {
            type: "object",
            required: ["id", "title", "status"],
            properties: {
              id: { type: "string", description: "Unique task id." },
              title: { type: "string", description: "Short task title." },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "error"],
              },
              files: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of related file paths.",
              },
              details: { type: "string", description: "Optional extra details." },
            },
          },
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

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { useMutation } from 'convex/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { LocalAgentRuntime } from '@/agents/localRuntime'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { BuildTask } from './BuildTaskList'
import { MessageBubble, type MessageToolMeta } from '@/components/assistant/MessageBubble'
import { validateInputAgainstSchema } from '@/components/assistant/toolSchemaValidation'

// AI Elements components
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Loader } from '@/components/ai-elements/loader'
import { parseBillingError, type BillingErrorData } from '@/components/assistant/BillingError'
import { parseJsonArrayLoose } from '@/lib/ai/parseJsonLoose'
import { normalizeToolInput } from '@/lib/ai/normalizeToolInput'

// Builder-specific tools that should always be executed locally
// These are defined inline on the server but not in Convex's tools table
const BUILDER_LOCAL_TOOLS = new Set([
  'build_tasks',
  'mark_complete',
  'create_file',
  'read_file',
  'list_dir',
  'run_in_terminal',
  'get_terminal_output',
  'replace_string_in_file',
  'multi_replace_string_in_file',
])

// Project type from Convex
interface Project {
  _id: Id<'projects'>
  name: string
  slug: string
  template?: string
  stack?: {
    backend?: string
    hosting?: string
    aiProvider?: string
  }
  visuals?: {
    uiLibrary?: string
    primaryColor?: string
    secondaryColor?: string
    accentColor?: string
  }
  generatedPlan?: {
    pages?: Array<{
      id?: string
      name: string
      route: string
      type?: string
      purpose?: string
    }>
    entities?: Array<{
      id?: string
      name: string
      fields?: string[]
    }>
  }
  promptSettings?: {
    model: string
    agentType: 'agent' | 'assistant'
    reasoningDepth: 'low' | 'medium' | 'high'
    thinkingEffort?: 'low' | 'medium' | 'high'
  }
}

interface ToolMeta extends MessageToolMeta {
  name: string
  displayName: string
  description: string
  inputSchema: Record<string, unknown>
  requiresApproval: boolean
  riskLevel: 'safe' | 'moderate' | 'dangerous'
  executionEnvironment: 'local' | 'server' | 'provider'
  provider?: 'anthropic' | 'openai' | 'google'
  toolType?: 'function' | 'provider' | 'dynamic'
  providerToolId?: string
  providerToolArgs?: Record<string, unknown>
  supportsDeferredResults?: boolean
}

interface BuilderConversationProps {
  project: Project
  localPath: string
  onTasksUpdate: (tasks: BuildTask[]) => void
  onFileCreated: (file: { path: string; content: string }) => void
  onComplete: () => void
  onError: (error: string) => void
  onBillingError?: (error: BillingErrorData | null) => void
  className?: string
}

// AI Gateway endpoint
const AI_API_URL = import.meta.env.VITE_AI_API_URL || 'http://localhost:3001/ai/chat'
const AI_BASE_URL = AI_API_URL.replace(/\/chat$/, '')

export function BuilderConversation({
  project,
  localPath,
  onTasksUpdate,
  onFileCreated,
  onComplete,
  onError,
  onBillingError,
  className,
}: BuilderConversationProps) {
  const { accessToken, currentOrganization, convexUserId } = useAuth()

  const acquireFileLock = useMutation(api.projectFileLocks.acquireLock)
  const releaseFileLock = useMutation(api.projectFileLocks.releaseLock)

  // State
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [toolPolicy, setToolPolicy] = useState<{
    allowProviderTools: boolean
    allowWebSearch: boolean
    maxReasoningDepth: 'low' | 'medium' | 'high'
  } | null>(null)
  const [conversationId] = useState(() => crypto.randomUUID())
  const hasSentInitialMessageRef = useRef(false)
  const completedRef = useRef(false)
  const [billingError, setBillingError] = useState<BillingErrorData | null>(null)
  // Track active terminal sessions for live terminal rendering
  const [terminalSessions, setTerminalSessions] = useState<Map<string, string>>(new Map())

  const addToolOutputRef = useRef<((args: any) => void | PromiseLike<void>) | null>(null)
  const toolsByNameRef = useRef<Record<string, ToolMeta>>({})
  const lastTasksSignatureRef = useRef<string | null>(null)

  // Auto-continuation refs (defined early for use in error handling)
  const latestTasksRef = useRef<BuildTask[]>([])
  const continuationSentRef = useRef(false)
  const continuationCountRef = useRef(0)
  const MAX_CONTINUATIONS = 50 // Safety limit to prevent infinite loops

  const localRuntime = useMemo(() => new LocalAgentRuntime(), [])
  const promptSettings = project.promptSettings
  console.log('[Builder] Project promptSettings:', promptSettings)
  console.log('[Builder] Using model:', promptSettings?.model ?? 'gemini-3-pro (default)')
  const model = promptSettings?.model ?? 'gemini-3-pro'
  const requestedReasoningDepth = promptSettings?.reasoningDepth ?? 'high'
  const maxReasoningDepth = toolPolicy?.maxReasoningDepth ?? requestedReasoningDepth
  const effectiveReasoningDepth = useMemo(() => {
    const order = { low: 0, medium: 1, high: 2 }
    return order[requestedReasoningDepth] > order[maxReasoningDepth]
      ? maxReasoningDepth
      : requestedReasoningDepth
  }, [requestedReasoningDepth, maxReasoningDepth])
  // Builder always needs tools to create files and track progress
  const enableTools = true
  // Web search always enabled for builder
  const enableWebSearch = true
  const actionType = promptSettings?.agentType ?? 'agent'
  const thinkingEffort = promptSettings?.thinkingEffort

  const headers = useMemo((): Record<string, string> => {
    if (!accessToken) return {}
    return { Authorization: `Bearer ${accessToken}` }
  }, [accessToken])

  // Sync tools
  useEffect(() => {
    toolsByNameRef.current = Object.fromEntries(
      availableTools.map((tool) => [tool.name, tool])
    )
  }, [availableTools])

  // Fetch tools
  useEffect(() => {
    if (!accessToken || !currentOrganization?.organizationId) return
    const controller = new AbortController()

    fetch(`${AI_BASE_URL}/tools?organizationId=${encodeURIComponent(currentOrganization.organizationId)}`, {
      headers,
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load tools')
        return res.json()
      })
      .then((data) => {
        if (!data?.tools) return
        setAvailableTools(data.tools as ToolMeta[])
        if (data?.policy) {
          setToolPolicy(data.policy)
        }
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return
        console.warn('Failed to fetch tools:', err)
      })

    return () => controller.abort()
  }, [accessToken, currentOrganization?.organizationId, headers])

  // Request config ref
  const requestConfigRef = useRef({
    accessToken,
    organizationId: currentOrganization?.organizationId || null,
    projectId: project._id,
    conversationId,
  })

  useEffect(() => {
    requestConfigRef.current = {
      accessToken,
      organizationId: currentOrganization?.organizationId || null,
      projectId: project._id,
      conversationId,
    }
  }, [accessToken, currentOrganization?.organizationId, project._id, conversationId])

  // Build initial prompt with full plan context
  const initialPrompt = useMemo(() => {
    const planContext = {
      name: project.name,
      template: project.template || 'custom',
      stack: project.stack || { backend: 'supabase', hosting: 'vercel', aiProvider: 'anthropic' },
      visuals: project.visuals || { uiLibrary: 'shadcn', primaryColor: '#6366f1' },
      pages: project.generatedPlan?.pages || [],
      entities: project.generatedPlan?.entities || [],
    }

    return `Build this project based on the approved plan:

Project: ${planContext.name}
Template: ${planContext.template}
Stack: ${JSON.stringify(planContext.stack, null, 2)}
Visuals: ${JSON.stringify(planContext.visuals, null, 2)}

Pages to create:
${JSON.stringify(planContext.pages, null, 2)}

Entities/Data models:
${JSON.stringify(planContext.entities, null, 2)}

IMPORTANT WORKFLOW - You MUST follow this pattern to update progress:
1. First call build_tasks to define your task list with all tasks set to status: "pending"
2. Before starting each task, call build_tasks with that task's status changed to "in_progress"
3. After completing each task, call build_tasks with that task's status changed to "completed"
4. Repeat steps 2-3 for each task until all tasks are "completed"

This updates the progress UI so the user can track your work in real-time. The user sees your progress through the build_tasks tool calls, so call it frequently!

Note: If the tool schema expects tasks_json, it MUST be a strict JSON array string with double quotes, not a JS object literal.

Now begin by defining your task list with build_tasks, then start working through them one by one, updating statuses as you go.`
  }, [project])

  // Chat transport
  const chatTransport = useMemo(() => {
    return new DefaultChatTransport({
      api: AI_API_URL,
      headers: (): Record<string, string> => {
        const token = requestConfigRef.current.accessToken
        return token ? { Authorization: `Bearer ${token}` } : {}
      },
      body: () => ({
        model,
        organizationId: requestConfigRef.current.organizationId,
        projectId: requestConfigRef.current.projectId,
        conversationId: requestConfigRef.current.conversationId,
        feature: 'project-builder',
        actionType,
        enableTools,
        enableWebSearch,
        reasoningDepth: effectiveReasoningDepth,
        thinkingEffort,
      }),
      prepareSendMessagesRequest: ({ messages, body, messageId }) => {
        const api = `${AI_BASE_URL}/agent`
        const requestBody = body ?? {}
        const nextBody = {
          ...requestBody,
          messages,
          ...(messageId ? { requestId: messageId } : {}),
        }
        return { api, body: nextBody }
      },
    })
  }, [model, actionType, enableTools, enableWebSearch, effectiveReasoningDepth, thinkingEffort])

  const isAgentMode = actionType === 'agent'

  const shouldRequireLocalApproval = useCallback((toolMeta?: MessageToolMeta) => {
    if (!toolMeta) return false
    if (toolMeta.executionEnvironment !== 'local') return false
    if (isAgentMode) return false // Agent mode auto-executes without approval
    return toolMeta.requiresApproval ?? false
  }, [isAgentMode])

  const normalizeProjectPath = useCallback((filePath?: string) => {
    if (!filePath) return localPath
    if (localPath && filePath.startsWith(localPath)) {
      return filePath
    }
    if (!localPath) return filePath
    return `${localPath}/${filePath}`.replace(/\/+/g, '/')
  }, [localPath])

  const normalizeRelativeFilePath = useCallback((filePath: string) => {
    return filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  }, [])

  const formatLockConflictError = useCallback((
    filePath: string,
    details: { lockedByName?: string | null; expiresAt?: number | null; status?: string | null }
  ) => {
    const parts: string[] = []
    parts.push(`File is locked: ${filePath}`)
    if (details.status) parts.push(`status=${details.status}`)
    if (details.lockedByName) parts.push(`by ${details.lockedByName}`)
    if (details.expiresAt) {
      parts.push(`until ${new Date(details.expiresAt).toLocaleTimeString()}`)
    }
    parts.push('Wait, then re-read the file and retry your edit.')
    return parts.join(' ')
  }, [])

  const withFileLocks = useCallback(async <T,>(
    filePaths: string[],
    fn: () => Promise<T>
  ): Promise<T> => {
    if (!convexUserId) {
      throw new Error('Cannot acquire file lock: not authenticated')
    }

    const uniquePaths = Array.from(
      new Set(filePaths.map(normalizeRelativeFilePath).filter(Boolean))
    ).sort()

    const acquired: string[] = []
    try {
      for (const filePath of uniquePaths) {
        const result = await acquireFileLock({
          projectId: project._id,
          filePath,
          userId: convexUserId,
        })
        if (!result.acquired) {
          throw new Error(
            formatLockConflictError(filePath, {
              lockedByName: result.lockedByName,
              expiresAt: result.expiresAt,
              status: result.status,
            })
          )
        }
        acquired.push(filePath)
      }

      return await fn()
    } finally {
      await Promise.allSettled(
        acquired.map((filePath) =>
          releaseFileLock({ projectId: project._id, filePath, userId: convexUserId })
        )
      )
    }
  }, [
    acquireFileLock,
    convexUserId,
    formatLockConflictError,
    normalizeRelativeFilePath,
    project._id,
    releaseFileLock,
  ])

  const runLocalTool = useCallback(async (
    toolName: string,
    toolCallId: string,
    input: any
  ) => {
    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    const normalizedInput = normalizeToolInput(toolName, input) as any

    const toolMeta = toolsByNameRef.current[toolName]
    if (toolMeta?.executionEnvironment && toolMeta.executionEnvironment !== 'local') {
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: 'Tool is not available locally',
      })
      return
    }

    if (toolMeta?.inputSchema) {
      const validation = validateInputAgainstSchema(toolMeta.inputSchema, normalizedInput)
      if (!validation.valid) {
        void addToolOutput({
          state: 'output-error',
          tool: toolName,
          toolCallId,
          errorText: validation.error,
        })
        return
      }
    }

    try {
      if (toolName === 'build_tasks') {
        // Handle both formats: direct tasks array (Anthropic/OpenAI) or tasks_json string (Google/Gemini)
        let tasks: BuildTask[] | null = null

        if (Array.isArray(normalizedInput?.tasks)) {
          tasks = normalizedInput.tasks as BuildTask[]
        } else if (normalizedInput?.tasks_json) {
          const parsed = parseJsonArrayLoose(normalizedInput.tasks_json)
          if (parsed) {
            tasks = parsed as BuildTask[]
          } else {
            void addToolOutput({
              state: 'output-error',
              tool: toolName,
              toolCallId,
              errorText: 'build_tasks failed: tasks_json must be a valid JSON array string. Re-read the tool schema and retry with strict JSON.',
            })
            return
          }
        } else {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: 'build_tasks failed: missing tasks or tasks_json input.',
          })
          return
        }

        let signature: string | null = null
        try {
          signature = JSON.stringify(tasks)
        } catch {
          signature = null
        }

        if (signature && signature === lastTasksSignatureRef.current) {
          // Avoid re-applying identical task lists (prevents render churn / loops).
        } else {
          lastTasksSignatureRef.current = signature
          onTasksUpdate(tasks)
        }

        const allCompleted = tasks.length > 0 && tasks.every(t => t.status === 'completed')
        if (allCompleted && !completedRef.current) {
          completedRef.current = true
          setTimeout(() => onComplete(), 500)
        }

        void addToolOutput({
          tool: toolName,
          toolCallId,
          output: JSON.stringify({ success: true, taskCount: tasks.length, tasks }),
        })
        return
      }

      if (toolName === 'mark_complete') {
        console.log('[Builder] mark_complete called with summary:', normalizedInput.summary)
        if (!completedRef.current) {
          completedRef.current = true
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify({ success: true, message: 'Build marked as complete' }),
          })
          setTimeout(() => onComplete(), 500)
        } else {
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify({ success: true, message: 'Build was already completed' }),
          })
        }
        return
      }

      if (toolName === 'create_file') {
        await withFileLocks([normalizedInput.filePath], async () => {
          const result = await window.electronAPI.project.writeFile({
            projectPath: localPath,
            filePath: normalizedInput.filePath,
            content: normalizedInput.content,
          })

          if (!result.success) {
            throw new Error(result.error || 'Failed to create file')
          }

          onFileCreated({ path: normalizedInput.filePath, content: normalizedInput.content })
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify({ success: true, path: normalizedInput.filePath }),
          })
        })
        return
      }

      if (toolName === 'read_file') {
        const result = await window.electronAPI.project.readFile({
          projectPath: localPath,
          filePath: normalizedInput.filePath,
        })
        if (result.success) {
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: result.content || '',
          })
        } else {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: result.error || 'File not found',
          })
        }
        return
      }

      if (toolName === 'list_dir') {
        const targetPath = normalizeProjectPath(normalizedInput.path)
        const entries = await window.electronAPI.fs.readDir(targetPath || localPath)
        void addToolOutput({
          tool: toolName,
          toolCallId,
          output: JSON.stringify(entries || []),
        })
        return
      }

      if (toolName === 'replace_string_in_file') {
        await withFileLocks([normalizedInput.filePath], async () => {
          const result = await window.electronAPI.project.readFile({
            projectPath: localPath,
            filePath: normalizedInput.filePath,
          })
          if (!result.success || result.content === undefined) {
            throw new Error(result.error || 'File not found')
          }
          const content = result.content
          const occurrences = content.split(normalizedInput.oldString).length - 1
          if (occurrences === 0) {
            throw new Error('Old string not found in file')
          }
          if (occurrences > 1) {
            throw new Error('Old string must match exactly one occurrence')
          }
          const updated = content.replace(normalizedInput.oldString, normalizedInput.newString)
          const writeResult = await window.electronAPI.project.writeFile({
            projectPath: localPath,
            filePath: normalizedInput.filePath,
            content: updated,
          })
          if (!writeResult.success) {
            throw new Error(writeResult.error || 'Failed to write file')
          }
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify({ filePath: normalizedInput.filePath, replacements: 1 }),
          })
        })
        return
      }

      if (toolName === 'multi_replace_string_in_file') {
        const replacements = (normalizedInput.replacements || []) as Array<{
          filePath: string
          oldString: string
          newString: string
        }>

        const paths = replacements.map((r) => r.filePath)
        await withFileLocks(paths, async () => {
          const results: Array<{ filePath: string; replacements: number }> = []
          for (const replacement of replacements) {
            const readResult = await window.electronAPI.project.readFile({
              projectPath: localPath,
              filePath: replacement.filePath,
            })
            if (!readResult.success || readResult.content === undefined) {
              throw new Error(readResult.error || `File not found: ${replacement.filePath}`)
            }
            const content = readResult.content
            const occurrences = content.split(replacement.oldString).length - 1
            if (occurrences === 0) {
              throw new Error(`Old string not found in file: ${replacement.filePath}`)
            }
            if (occurrences > 1) {
              throw new Error(`Old string must match exactly one occurrence in file: ${replacement.filePath}`)
            }
            const updated = content.replace(replacement.oldString, replacement.newString)
            const writeResult = await window.electronAPI.project.writeFile({
              projectPath: localPath,
              filePath: replacement.filePath,
              content: updated,
            })
            if (!writeResult.success) {
              throw new Error(writeResult.error || `Failed to write file: ${replacement.filePath}`)
            }
            results.push({ filePath: replacement.filePath, replacements: 1 })
          }
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify({ results }),
          })
        })
        return
      }

      if (toolName === 'run_in_terminal' && normalizedInput?.command && localPath) {
        const command = normalizedInput.command as string
        const isBackground = Boolean(normalizedInput.isBackground)
        const timeout = typeof normalizedInput.timeout === 'number' ? normalizedInput.timeout : 120000 // 2 min default

        try {
          // Create a PTY terminal session for interactive command execution
          const createResult = await window.electronAPI.terminal.create({
            projectPath: localPath,
            cwd: localPath,
            cols: 120,
            rows: 30,
          })

          if (!createResult.terminalId) {
            throw new Error('Failed to create terminal session')
          }

          const terminalId = createResult.terminalId
          let output = ''
          let exitCode: number | null = null
          let completed = false

          // Track this terminal session for live UI rendering
          setTerminalSessions(prev => {
            const next = new Map(prev)
            next.set(toolCallId, terminalId)
            return next
          })

          // Set up output listener
          const outputHandler = (event: { terminalId: string; data: string }) => {
            if (event.terminalId === terminalId) {
              output += event.data
            }
          }

          // Set up exit listener
          const exitPromise = new Promise<{ exitCode: number | null }>((resolve) => {
            const exitHandler = (event: { terminalId: string; exitCode: number | null }) => {
              if (event.terminalId === terminalId) {
                completed = true
                // Remove from active sessions when terminal exits
                setTerminalSessions(prev => {
                  const next = new Map(prev)
                  next.delete(toolCallId)
                  return next
                })
                resolve({ exitCode: event.exitCode })
              }
            }
            window.electronAPI.terminal.onExit(exitHandler)
          })

          // Subscribe to output
          const unsubOutput = window.electronAPI.terminal.onOutput(outputHandler)

          // Send the command to the terminal
          setTimeout(() => {
            window.electronAPI.terminal.input({
              terminalId,
              data: command + '\r',
            })
          }, 100)

          if (isBackground) {
            // For background processes, return immediately with terminal ID
            void addToolOutput({
              tool: toolName,
              toolCallId,
              output: JSON.stringify({
                id: terminalId,
                command,
                isBackground: true,
                message: 'Background process started. Use get_terminal_output to check status.',
              }),
            })
            // Keep terminal running - don't clean up (session stays in terminalSessions)
          } else {
            // For foreground processes, wait for completion or timeout
            const timeoutPromise = timeout > 0
              ? new Promise<{ exitCode: number | null }>((resolve) => {
                  setTimeout(() => {
                    if (!completed) {
                      resolve({ exitCode: -1 })
                    }
                  }, timeout)
                })
              : new Promise<never>(() => {}) // Never resolves if no timeout

            const result = await Promise.race([exitPromise, timeoutPromise])
            exitCode = result.exitCode

            // Clean up
            unsubOutput()

            // If timed out, kill the process
            if (!completed && timeout > 0) {
              try {
                await window.electronAPI.terminal.kill({ terminalId })
              } catch {
                // Ignore kill errors
              }
              // Remove from active sessions on timeout
              setTerminalSessions(prev => {
                const next = new Map(prev)
                next.delete(toolCallId)
                return next
              })
              output += '\n[Process timed out after ' + (timeout / 1000) + ' seconds]'
            }

            void addToolOutput({
              tool: toolName,
              toolCallId,
              output: JSON.stringify({
                command,
                stdout: output,
                stderr: '',
                exitCode,
                timedOut: !completed && timeout > 0,
              }),
            })
          }
        } catch (err) {
          // Remove from active sessions on error
          setTerminalSessions(prev => {
            const next = new Map(prev)
            next.delete(toolCallId)
            return next
          })
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: err instanceof Error ? err.message : 'Failed to run command',
          })
        }
        return
      }

      const runtimeResult = await localRuntime.requestToolExecution(conversationId, {
        toolName,
        input: normalizedInput,
        toolCallId,
      })

      if (runtimeResult.success) {
        void addToolOutput({
          tool: toolName,
          toolCallId,
          output: runtimeResult.output,
        })
      } else {
        void addToolOutput({
          state: 'output-error',
          tool: toolName,
          toolCallId,
          errorText: runtimeResult.error || 'Tool failed',
        })
      }
    } catch (err) {
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: err instanceof Error ? err.message : 'Tool failed',
      })
    }
  }, [
    conversationId,
    localPath,
    localRuntime,
    normalizeProjectPath,
    onComplete,
    onFileCreated,
    onTasksUpdate,
    withFileLocks,
  ])

  const handleApprovedTool = useCallback(async (
    toolName: string,
    toolCallId: string,
    input: any
  ) => {
    await runLocalTool(toolName, toolCallId, input)
  }, [runLocalTool])

  const handleDeniedTool = useCallback(async (
    toolName: string,
    toolCallId: string
  ) => {
    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return
    void addToolOutput({
      state: 'output-error',
      tool: toolName,
      toolCallId,
      errorText: 'User denied tool execution',
    })
  }, [])

  // Handle tool calls - intercept build_tasks and file operations
  const handleToolCall = useCallback(async ({ toolCall }: { toolCall: any }) => {
    if (toolCall?.dynamic) return
    if (toolCall?.providerExecuted) return

    const { toolName, input, toolCallId } = toolCall
    const toolMeta = toolsByNameRef.current[toolName]

    // Check if this is a builder-local tool (may not be in toolsByName)
    const isBuilderLocalTool = BUILDER_LOCAL_TOOLS.has(toolName)
    const isLocalTool = isBuilderLocalTool || toolMeta?.executionEnvironment === 'local'

    if (isLocalTool && !isBuilderLocalTool && shouldRequireLocalApproval(toolMeta)) {
      return
    }

    if (isLocalTool) {
      await runLocalTool(toolName, toolCallId, input)
    }
  }, [runLocalTool, shouldRequireLocalApproval])

  // Track if auto-continue is handling errors (don't propagate to parent during recovery)
  const isRecoveringRef = useRef(false)
  const lastErrorRef = useRef<string | null>(null)

  // Check if we should allow auto-continue to handle the error
  const shouldAllowRecovery = useCallback(() => {
    const tasks = latestTasksRef.current
    const hasIncompleteTasks = tasks.length > 0 && tasks.some((t: BuildTask) => t.status !== 'completed')
    const canContinue = continuationCountRef.current < MAX_CONTINUATIONS
    return hasIncompleteTasks && canContinue && !completedRef.current
  }, [])

  // useChat hook
  const {
    messages,
    status,
    error,
    sendMessage,
    addToolOutput,
  } = useChat({
    transport: chatTransport,
    sendAutomaticallyWhen: ({ messages }) =>
      lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
      lastAssistantMessageIsCompleteWithApprovalResponses({ messages }),
    onToolCall: handleToolCall,
    onError: (err: any) => {
      console.error('Builder chat error:', err)

      const billingErr = parseBillingError(err)
      if (billingErr) {
        // Billing errors are always fatal
        setBillingError(billingErr)
        onBillingError?.(billingErr)
        onError(billingErr.title || 'Billing Error')
        return
      }

      const message = err?.message || 'Build failed'
      lastErrorRef.current = message

      // Check if we should let auto-continue recover from this error
      if (shouldAllowRecovery()) {
        console.log('[Builder] Error occurred but allowing recovery via auto-continue:', message)
        isRecoveringRef.current = true
        // Don't propagate error yet - auto-continue will try to recover
        return
      }

      onError(message)
    },
  })

  addToolOutputRef.current = addToolOutput

  // Send initial message on mount
  useEffect(() => {
    if (!hasSentInitialMessageRef.current && accessToken && project._id) {
      hasSentInitialMessageRef.current = true
      void sendMessage({ text: initialPrompt })
    }
  }, [accessToken, project._id, initialPrompt, sendMessage])

  // Track error state - only propagate if recovery isn't possible
  useEffect(() => {
    if (error) {
      const billingErr = parseBillingError(error)
      if (billingErr) {
        setBillingError(billingErr)
        onBillingError?.(billingErr)
        onError(billingErr.title || 'Billing Error')
        return
      }

      // Check if we should let auto-continue recover from this error
      if (shouldAllowRecovery()) {
        console.log('[Builder] Error state detected but allowing recovery')
        isRecoveringRef.current = true
        return
      }

      const message = (error as { message?: string }).message || 'Build failed'
      onError(message)
    }
  }, [error, onError, shouldAllowRecovery])

  // Clear recovery state when streaming starts (continuation is working)
  useEffect(() => {
    if (status === 'streaming' && isRecoveringRef.current) {
      console.log('[Builder] Recovery successful, clearing error state')
      isRecoveringRef.current = false
      lastErrorRef.current = null
    }
  }, [status])

  // Fallback: extract build_tasks updates directly from streamed messages
  useEffect(() => {
    let latestTasks: BuildTask[] | null = null

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.role !== 'assistant') continue
      for (const part of message.parts) {
        if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) {
          continue
        }
        const toolPart = part as any
        const toolName = part.type === 'dynamic-tool'
          ? toolPart.toolName
          : part.type.replace(/^tool-/, '')
        if (toolName !== 'build_tasks') continue

        // Handle both formats: direct tasks array (Anthropic/OpenAI) or tasks_json string (Google/Gemini)
        if (toolPart.input?.tasks) {
          latestTasks = toolPart.input.tasks as BuildTask[]
          break
        }
        if (toolPart.input?.tasks_json) {
          const parsed = parseJsonArrayLoose(toolPart.input.tasks_json)
          if (parsed) {
            latestTasks = parsed as BuildTask[]
            break
          }
        }

        if (typeof toolPart.output === 'string') {
          try {
            const parsed = JSON.parse(toolPart.output)
            if (parsed?.tasks) {
              latestTasks = parsed.tasks as BuildTask[]
              break
            }
          } catch {
            // ignore parse errors
          }
        } else if (toolPart.output?.tasks) {
          latestTasks = toolPart.output.tasks as BuildTask[]
          break
        }
      }
      if (latestTasks) break
    }

    if (latestTasks) {
      let signature: string | null = null
      try {
        signature = JSON.stringify(latestTasks)
      } catch {
        signature = null
      }

      if (!signature || signature !== lastTasksSignatureRef.current) {
        lastTasksSignatureRef.current = signature
        onTasksUpdate(latestTasks)
      }
      const allCompleted = latestTasks.length > 0 && latestTasks.every(t => t.status === 'completed')
      console.log('[Builder] Task completion check:', {
        taskCount: latestTasks.length,
        allCompleted,
        completedRefCurrent: completedRef.current,
        statuses: latestTasks.map(t => t.status),
      })
      if (allCompleted && !completedRef.current) {
        console.log('[Builder] All tasks completed, calling onComplete()')
        completedRef.current = true
        setTimeout(() => onComplete(), 500)
      }
    }
  }, [messages, onTasksUpdate, onComplete])

  // Track latest tasks for continuation logic
  useEffect(() => {
    // Extract latest tasks from messages (same logic as above effect)
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.role !== 'assistant') continue
      for (const part of message.parts) {
        if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) continue
        const toolPart = part as any
        const toolName = part.type === 'dynamic-tool' ? toolPart.toolName : part.type.replace(/^tool-/, '')
        if (toolName !== 'build_tasks') continue
        // Handle both formats: direct tasks array (Anthropic/OpenAI) or tasks_json string (Google/Gemini)
        if (toolPart.input?.tasks) {
          latestTasksRef.current = toolPart.input.tasks as BuildTask[]
          return
        }
        if (toolPart.input?.tasks_json) {
          const parsed = parseJsonArrayLoose(toolPart.input.tasks_json)
          if (parsed) {
            latestTasksRef.current = parsed as BuildTask[]
            return
          }
        }
      }
    }
  }, [messages])

  // Auto-continue when model stops without completing all tasks (fixes Gemini stopping early)
  useEffect(() => {
    // Only check when not loading and not completed
    if (status === 'streaming' || status === 'submitted' || completedRef.current) {
      continuationSentRef.current = false
      return
    }

    // Check if there are incomplete tasks
    const tasks = latestTasksRef.current
    const hasIncompleteTasks = tasks.length > 0 && tasks.some((t: BuildTask) => t.status !== 'completed')

    // Safety check - don't continue forever
    if (continuationCountRef.current >= MAX_CONTINUATIONS) {
      console.log('[Builder] Max continuations reached, stopping auto-continue')
      return
    }

    if (!continuationSentRef.current && messages.length > 0 && hasIncompleteTasks) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role === 'assistant') {
        // Check if message only has reasoning/metadata (no actual output)
        const hasOnlyReasoning = lastMessage.parts.length > 0 &&
          lastMessage.parts.every(p =>
            p.type === 'reasoning' ||
            p.type === 'step-start' ||
            p.type === 'data-usage' ||
            (p.type === 'text' && !(p as { type: 'text'; text: string }).text?.trim())
          )

        // Always continue if there are incomplete tasks and model stopped
        // This handles both: MALFORMED_FUNCTION_CALL (only reasoning) and normal stops after tool calls
        console.log('[Builder] Model stopped with incomplete tasks, forcing continuation', {
          hasOnlyReasoning,
          taskCount: tasks.length,
          incompleteTasks: tasks.filter((t: BuildTask) => t.status !== 'completed').length,
          continuationCount: continuationCountRef.current
        })

        continuationSentRef.current = true
        continuationCountRef.current += 1

        const prompt = hasOnlyReasoning
          ? 'You stopped mid-thought. Continue and use tools to complete the current task.'
          : 'Continue with the next task. Use tools to create files and update build_tasks.'

        setTimeout(() => {
          void sendMessage({ text: prompt })
        }, 500)
      }
    }
  }, [status, messages, sendMessage])

  const toolsByName = useMemo(() => {
    const map = new Map<string, MessageToolMeta>()
    for (const tool of availableTools) {
      map.set(tool.name, {
        displayName: tool.displayName,
        toolType: tool.toolType ?? 'function',
        requiresApproval: tool.requiresApproval,
        executionEnvironment: tool.executionEnvironment,
      })
    }
    return map
  }, [availableTools])

  const isLoading = status === 'streaming' || status === 'submitted'

  // Filter out the initial plan prompt message (first user message with plan context)
  const visibleMessages = useMemo(() => {
    return messages.filter((message, index) => {
      // Hide the first user message (the auto-sent plan prompt)
      if (message.role === 'user' && index === 0) {
        return false
      }
      return true
    })
  }, [messages])

  return (
    <div className={cn('flex flex-col overflow-hidden w-full', className)}>
      <div className="flex-1 min-h-0 relative w-full">
        {/* Top fade */}
        <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none" />
        <Conversation className="h-full">
          <ConversationContent className="w-full max-w-none px-4 pt-4 pb-4">
            {visibleMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                toolsByName={toolsByName}
                status={status}
                shouldRequireLocalApproval={shouldRequireLocalApproval}
                onApproveTool={handleApprovedTool}
                onDenyTool={handleDeniedTool}
                terminalSessions={terminalSessions}
                projectPath={localPath}
              />
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground py-2">
                <Loader className="h-4 w-4" />
                <span className="text-sm">Building...</span>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>
    </div>
  )
}

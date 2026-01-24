import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { LocalAgentRuntime } from '@/agents/localRuntime'
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
    toolsEnabled: boolean
    webSearchEnabled: boolean
    thinkingEffort?: 'low' | 'medium' | 'high'
    providerOptions?: Record<string, unknown>
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
  className,
}: BuilderConversationProps) {
  const { accessToken, currentOrganization } = useAuth()

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

  const addToolOutputRef = useRef<((args: any) => void | PromiseLike<void>) | null>(null)
  const toolsByNameRef = useRef<Record<string, ToolMeta>>({})

  const localRuntime = useMemo(() => new LocalAgentRuntime(), [])
  const promptSettings = project.promptSettings
  const model = promptSettings?.model ?? 'claude-sonnet-4-5'
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
  const enableWebSearch = Boolean(promptSettings?.webSearchEnabled ?? true)
    && (toolPolicy?.allowWebSearch ?? true)
    && (toolPolicy?.allowProviderTools ?? true)
  const actionType = promptSettings?.agentType ?? 'agent'
  const thinkingEffort = promptSettings?.thinkingEffort
  const providerOptions = promptSettings?.providerOptions

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

Start by calling build_tasks to define your task list, then create the project structure and files.`
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
        providerOptions,
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
  }, [model, actionType, enableTools, enableWebSearch, effectiveReasoningDepth, thinkingEffort, providerOptions])

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

  const runLocalTool = useCallback(async (
    toolName: string,
    toolCallId: string,
    input: any
  ) => {
    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

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
      const validation = validateInputAgainstSchema(toolMeta.inputSchema, input)
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
        const tasks = input.tasks as BuildTask[]
        onTasksUpdate(tasks)

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
        console.log('[Builder] mark_complete called with summary:', input.summary)
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
        const result = await window.electronAPI.project.writeFile({
          projectPath: localPath,
          filePath: input.filePath,
          content: input.content,
        })

        if (result.success) {
          onFileCreated({ path: input.filePath, content: input.content })
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify({ success: true, path: input.filePath }),
          })
        } else {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: result.error || 'Failed to create file',
          })
        }
        return
      }

      if (toolName === 'read_file') {
        const result = await window.electronAPI.project.readFile({
          projectPath: localPath,
          filePath: input.filePath,
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
        const targetPath = normalizeProjectPath(input.path)
        const entries = await window.electronAPI.fs.readDir(targetPath || localPath)
        void addToolOutput({
          tool: toolName,
          toolCallId,
          output: JSON.stringify(entries || []),
        })
        return
      }

      if (toolName === 'replace_string_in_file') {
        const result = await window.electronAPI.project.readFile({
          projectPath: localPath,
          filePath: input.filePath,
        })
        if (!result.success || result.content === undefined) {
          throw new Error(result.error || 'File not found')
        }
        const content = result.content
        const occurrences = content.split(input.oldString).length - 1
        if (occurrences === 0) {
          throw new Error('Old string not found in file')
        }
        if (occurrences > 1) {
          throw new Error('Old string must match exactly one occurrence')
        }
        const updated = content.replace(input.oldString, input.newString)
        const writeResult = await window.electronAPI.project.writeFile({
          projectPath: localPath,
          filePath: input.filePath,
          content: updated,
        })
        if (!writeResult.success) {
          throw new Error(writeResult.error || 'Failed to write file')
        }
        void addToolOutput({
          tool: toolName,
          toolCallId,
          output: JSON.stringify({ filePath: input.filePath, replacements: 1 }),
        })
        return
      }

      if (toolName === 'multi_replace_string_in_file') {
        const results: Array<{ filePath: string; replacements: number }> = []
        for (const replacement of input.replacements || []) {
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
        return
      }

      if (toolName === 'run_in_terminal' && input?.command && localPath) {
        const command = input.command
        const safeCwd = localPath.replace(/"/g, '\\"')
        const commandWithCwd = `cd "${safeCwd}" && ${command}`
        const runtimeResult = await localRuntime.requestToolExecution(conversationId, {
          toolName,
          input: { ...input, command: commandWithCwd },
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
        return
      }

      const runtimeResult = await localRuntime.requestToolExecution(conversationId, {
        toolName,
        input,
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
  }, [localPath, onTasksUpdate, onFileCreated, onComplete, localRuntime, conversationId, normalizeProjectPath])

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
      const message = err?.message || 'Build failed'
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

  // Track error state
  useEffect(() => {
    if (error) {
      const message = (error as { message?: string }).message || 'Build failed'
      onError(message)
    }
  }, [error, onError])

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

        if (toolPart.input?.tasks) {
          latestTasks = toolPart.input.tasks as BuildTask[]
          break
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
      onTasksUpdate(latestTasks)
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

  return (
    <div className={cn('flex flex-col overflow-hidden w-full', className)}>
      <div className="flex-1 min-h-0 relative w-full">
        <Conversation className="h-full">
          <ConversationContent className="max-w-2xl mx-auto pt-4 pb-4">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                toolsByName={toolsByName}
                status={status}
                shouldRequireLocalApproval={shouldRequireLocalApproval}
                onApproveTool={handleApprovedTool}
                onDenyTool={handleDeniedTool}
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

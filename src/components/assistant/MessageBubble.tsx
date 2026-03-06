import type { UIMessage } from 'ai'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import { ChatAttachmentCard } from '@/components/assistant/ChatAttachmentCard'
import { Button } from '@/components/ui/button'
import {
  Tool,
  ToolStatic,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '@/components/ai-elements/reasoning'
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from '@/components/ai-elements/sources'
import { ConfirmationDialog, type ConfirmationState } from '@/components/ai-elements/confirmation'
import { TaskProgress, type TaskData } from '@/components/assistant/TaskProgress'
import { BuilderTerminalOutput } from '@/components/builder/BuilderTerminalOutput'
import { BuilderTerminal } from '@/components/builder/BuilderTerminal'
import { ToolDiffOutput, isFileEditTool } from '@/components/ai-elements/tool-diff-output'
import { parseInjectedPromptForCompaction } from '@/components/assistant/injectedPromptCompaction'
import { parseJsonArrayLoose } from '@/lib/ai/parseJsonLoose'
import { cn } from '@/lib/utils'
import { AlertCircle, AlertTriangle, Check, Copy, MousePointer2, Terminal, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface MessageToolMeta {
  displayName?: string
  toolType?: string
  requiresApproval?: boolean
  executionEnvironment?: 'local' | 'server' | 'provider'
}

export interface MessageBubbleProps {
  message: UIMessage
  toolsByName: Map<string, MessageToolMeta>
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  showTodowriteTools?: boolean
  shouldRequireLocalApproval?: (toolMeta?: MessageToolMeta) => boolean
  onApproveTool?: (toolName: string, toolCallId: string, input: unknown, approvalId?: string) => void
  onDenyTool?: (toolName: string, toolCallId: string, approvalId?: string) => void
  // For live terminal rendering
  terminalSessions?: Map<string, string> // toolCallId -> terminalId
  projectPath?: string
}

interface ExtractedSource {
  url: string
  title: string
  favicon?: string
}

interface ToolPart {
  type: string
  toolCallId?: string
  toolName?: string
  state?: string
  input?: Record<string, unknown>
  output?: unknown
  errorText?: string
  approval?: { id?: string }
}

interface ReasoningPart {
  duration?: number
  text?: string
}

interface ErrorPart {
  error?: string
  message?: string
  text?: string
}

interface SourcePart {
  url?: string
  uri?: string
  title?: string
  favicon?: string
  source?: { url?: string; title?: string }
}

interface FilePart {
  type: 'file'
  mediaType: string
  filename?: string
  url: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'

const TOOL_STATES: ToolState[] = [
  'input-streaming',
  'input-available',
  'approval-requested',
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied',
]

function getToolName(part: ToolPart): string | null {
  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' && part.toolName.length > 0 ? part.toolName : null
  }
  if (part.type.startsWith('tool-')) {
    const derived = part.type.replace(/^tool-/, '')
    return derived.length > 0 ? derived : null
  }
  return null
}

function getToolState(state: string | undefined): ToolState {
  if (state && TOOL_STATES.includes(state as ToolState)) {
    return state as ToolState
  }
  return 'input-streaming'
}

function getToolCallId(part: ToolPart, messageId: string, index: number): string {
  return (typeof part.toolCallId === 'string' && part.toolCallId.length > 0)
    ? part.toolCallId
    : `${messageId}-tool-${index}`
}

function MessageBubbleComponent({
  message,
  toolsByName,
  status,
  showTodowriteTools = false,
  shouldRequireLocalApproval,
  onApproveTool,
  onDenyTool,
  terminalSessions,
  projectPath,
  }: MessageBubbleProps) {
  const isStreaming = status === 'streaming'
  const sourceItems = extractSourcesFromParts(message.parts)
  const [dismissedErrors, setDismissedErrors] = useState<Set<number>>(new Set())
  const [isCopied, setIsCopied] = useState(false)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyableText = useMemo(
    () => extractCopyableTextFromParts(message.parts),
    [message.parts]
  )
  const canCopy = message.role === 'user' && copyableText.length > 0
  const hasStandaloneAttachments = useMemo(
    () => message.role === 'user' && message.parts.some(isFilePart),
    [message.parts, message.role]
  )

  const handleCopyMessage = useCallback(async () => {
    if (!canCopy) return
    if (!navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(copyableText)
      setIsCopied(true)
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current)
      }
      copyResetRef.current = setTimeout(() => {
        setIsCopied(false)
        copyResetRef.current = null
      }, 1400)
    } catch {
      // Ignore clipboard errors.
    }
  }, [canCopy, copyableText])

  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current)
      }
    }
  }, [])

  return (
    <Message from={message.role}>
      <MessageContent
        className={cn(
          hasStandaloneAttachments && [
            'group-[.is-user]:w-full',
            'group-[.is-user]:bg-transparent',
            'group-[.is-user]:rounded-none',
            'group-[.is-user]:px-0',
            'group-[.is-user]:py-0',
          ]
        )}
      >
        {message.parts.map((part, index) => {
          // Skip step-start separators (no visual divider needed)
          if (part.type === 'step-start') {
            return null
          }

          if (isFilePart(part)) {
            return (
              <div
                key={`${message.id}-file-${index}`}
                className={message.role === 'user' ? 'flex justify-end' : 'flex'}
              >
                <ChatAttachmentCard
                  mediaType={part.mediaType}
                  name={part.filename || defaultAttachmentName(part.mediaType)}
                  url={part.url}
                  size="message"
                />
              </div>
            )
          }

          if (part.type === 'text') {
            const compactedPrompt =
              message.role === 'user'
                ? parseInjectedPromptForCompaction(part.text)
                : null

            if (compactedPrompt) {
              if (compactedPrompt.kind === 'terminal') {
                return (
                  <div key={`${message.id}-text-${index}`} className="flex">
                    <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-sky-200 px-2.5 py-1 text-[11px] text-foreground dark:bg-sky-900">
                      <Terminal className="h-3 w-3 shrink-0 text-sky-700/80 dark:text-sky-200/90" />
                      <span className="min-w-0 truncate">{compactedPrompt.pillText || 'Terminal output'}</span>
                    </div>
                  </div>
                )
              }

              if (compactedPrompt.kind === 'inspector') {
                return (
                  <div key={`${message.id}-text-${index}`} className="flex">
                    <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-teal-200 px-2.5 py-1 text-[11px] text-foreground dark:bg-teal-900">
                      <MousePointer2 className="h-3 w-3 shrink-0 text-teal-700/80 dark:text-teal-200/90" />
                      <span className="min-w-0 truncate">{compactedPrompt.pillText || 'Inspected element'}</span>
                    </div>
                  </div>
                )
              }

              if (compactedPrompt.kind === 'problem') {
                return (
                  <div key={`${message.id}-text-${index}`} className="flex">
                    <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-amber-200 px-2.5 py-1 text-[11px] text-foreground dark:bg-amber-900">
                      <AlertTriangle className="h-3 w-3 shrink-0 text-amber-700/80 dark:text-amber-200/90" />
                      <span className="min-w-0 truncate">{compactedPrompt.pillText || 'Problem'}</span>
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={`${message.id}-text-${index}`}
                  className="rounded-lg border border-border/60 bg-secondary/55 px-2.5 py-2"
                >
                  <div className="text-xs font-medium text-foreground">{compactedPrompt.title}</div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{compactedPrompt.subtitle}</p>
                  {compactedPrompt.snippet ? (
                    <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{compactedPrompt.snippet}</p>
                  ) : null}
                  {compactedPrompt.fields && compactedPrompt.fields.length > 0 ? (
                    <div className="mt-1.5 space-y-0.5">
                      {compactedPrompt.fields.map((field) => (
                        <div key={field.label} className="flex items-start gap-1 text-[11px]">
                          <span className="shrink-0 text-muted-foreground">{field.label}:</span>
                          <span className="min-w-0 truncate text-foreground/90">{field.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            }

            return (
              hasStandaloneAttachments && message.role === 'user'
                ? (
                  <div key={`${message.id}-text-${index}`} className="flex justify-end">
                    <div className="max-w-full rounded-3xl bg-secondary px-3.5 py-2.5 text-foreground">
                      <MessageResponse>{part.text}</MessageResponse>
                    </div>
                  </div>
                )
                : (
                  <MessageResponse key={`${message.id}-text-${index}`}>
                    {part.text}
                  </MessageResponse>
                )
            )
          }

          if (part.type === 'reasoning') {
            const reasoningPart = part as ReasoningPart
            // Only mark as streaming if this is the last reasoning block AND message is still streaming
            // If there are subsequent parts after this reasoning, it's already complete
            const hasSubsequentParts = message.parts.slice(index + 1).some(
              p => p.type !== 'step-start'
            )
            const isThisReasoningStreaming = isStreaming && !hasSubsequentParts
            return (
              <Reasoning
                key={`${message.id}-reasoning-${index}`}
                isStreaming={isThisReasoningStreaming}
                duration={reasoningPart.duration}
              >
                <ReasoningTrigger />
                <ReasoningContent>{reasoningPart.text || ''}</ReasoningContent>
              </Reasoning>
            )
          }



          const partType = (part as { type?: string }).type

          // Handle error parts (data-error or error type)
          if (partType === 'error' || partType === 'data-error') {
            if (dismissedErrors.has(index)) {
              return null
            }
            const errorPart = part as ErrorPart
            const errorMessage = errorPart.error || errorPart.message || errorPart.text || 'Error'
            return (
              <div
                key={`${message.id}-error-${index}`}
                className="flex items-center gap-2 rounded-lg bg-background/90 backdrop-blur-md border border-destructive/30 px-3 py-2"
              >
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                <span className="text-sm text-destructive flex-1">{errorMessage}</span>
                <button
                  type="button"
                  className="text-destructive/70 hover:text-destructive transition-colors"
                  onClick={() => setDismissedErrors(prev => new Set(prev).add(index))}
                  aria-label="Dismiss error"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )
          }

          if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
            const toolPart = part as ToolPart
            const toolName = getToolName(toolPart)
            if (!toolName) return null
            const toolCallId = getToolCallId(toolPart, message.id, index)
            const toolInput = isRecord(toolPart.input) ? toolPart.input : undefined
            const toolMeta = toolsByName.get(toolName)
            const requiresApproval = toolMeta?.executionEnvironment === 'local'
              ? (shouldRequireLocalApproval ? shouldRequireLocalApproval(toolMeta) : toolMeta.requiresApproval ?? false)
              : toolMeta?.requiresApproval ?? false

            const toolState = getToolState(toolPart.state)

            // Special handling for task-based tools (like Claude Code's TodoWrite)
            const isTaskTool = toolName === 'todowrite'
            const hasTaskInput =
              Array.isArray(toolInput?.tasks) ||
              Array.isArray(toolInput?.todos) ||
              typeof toolInput?.tasks_json === 'string'

            // Builder surface keeps todowrite in the controls pill.
            if (toolName === 'todowrite' && !showTodowriteTools) {
              return null
            }
            // Special handling for terminal tools
            const isTerminalTool = toolName === 'bash'
            // Special handling for file edit tools (show Monaco diff)
            const isEditTool = isFileEditTool(toolName)
            // Special handling for web search tools (show only sources)
            const isWebSearchTool = toolName.toLowerCase().includes('search') ||
              toolName.toLowerCase().includes('web') ||
              toolName === 'tavily_search' ||
              toolName === 'brave_search' ||
              toolName === 'bing_search'

            // Non-expandable tools (output is not useful to display)
            const isStaticTool = toolName === 'read'

            // Render static (non-expandable) tools
            if (isStaticTool) {
              return (
                <ToolStatic
                  key={`${message.id}-tool-${index}`}
                  toolName={toolName}
                  input={toolInput}
                  type={toolMeta?.toolType || 'function'}
                  state={toolState}
                />
              )
            }

            return (
              <Tool key={`${message.id}-tool-${index}`}>
                <ToolHeader
                  toolName={toolName}
                  input={toolInput}
                  type={toolMeta?.toolType || 'function'}
                  state={toolState}
                />
                <ToolContent>
                  {/* For task tools, show TaskProgress from input while running/streaming */}
                  {isTaskTool && toolState !== 'output-available' && hasTaskInput && (
                    <TaskProgress tasks={extractTasksFromInput(toolInput)} showSummary />
                  )}

                  {/* For terminal tools, show live terminal if session is active, otherwise show command */}
                  {isTerminalTool && typeof toolInput?.command === 'string' && (() => {
                    const activeTerminalId = terminalSessions?.get(toolCallId)
                    if (activeTerminalId && projectPath && toolState !== 'output-available') {
                      // Show live interactive terminal
                      return (
                        <div className="px-4 py-2">
                          <BuilderTerminal
                            terminalId={activeTerminalId}
                            command={toolInput.command}
                            projectPath={projectPath}
                            isStreaming={true}
                          />
                        </div>
                      )
                    }
                    // Show command header only when no live terminal and not complete
                    if (toolState !== 'output-available') {
                      return (
                        <div className="px-4 py-2 text-sm text-muted-foreground font-mono">
                          $ {toolInput.command}
                        </div>
                      )
                    }
                    return null
                  })()}

                  {/* For file edit tools, show Monaco diff viewer */}
                  {isEditTool && toolInput && (
                    <ToolDiffOutput
                      toolName={toolName}
                      input={toolInput}
                      maxHeight={300}
                    />
                  )}

                  {/* For non-task/non-terminal/non-edit/non-list/non-web_search tools, show raw input */}
                  {!isTaskTool && !isTerminalTool && !isEditTool && !isWebSearchTool && toolName !== 'list' && toolInput && (
                    <ToolInput input={formatToolPayload(toolInput)} />
                  )}

                  {requiresApproval && onApproveTool && onDenyTool && (
                    <ConfirmationDialog
                      state={(toolState === 'output-denied'
                        ? 'rejected'
                        : toolState === 'output-available'
                          ? 'approved'
                          : 'pending') as ConfirmationState}
                      toolName={toolMeta?.displayName || toolName}
                      toolCallId={toolCallId}
                      description="This tool requires your approval to execute."
                      onApprove={() => onApproveTool(toolName, toolCallId, toolInput, toolPart.approval?.id)}
                      onReject={() => onDenyTool(toolName, toolCallId, toolPart.approval?.id)}
                    />
                  )}

                  {toolState === 'output-available' && (
                    <>
                      {isTaskTool
                        ? (() => {
                          const tasks = extractTasksFromToolOutput(toolPart.output)
                          if (tasks.length === 0) {
                            return <ToolOutput output={formatToolPayload(toolPart.output)} toolName={toolName} />
                          }
                          return <TaskProgress tasks={tasks} showSummary />
                        })()
                        : isTerminalTool
                          ? <BuilderTerminalOutput
                            command={typeof toolInput?.command === 'string' ? toolInput.command : undefined}
                            output={extractTerminalOutput(toolPart.output)}
                            className="border-t"
                          />
                          : isEditTool
                            ? null // Diff viewer already shows the edit, no need to show output
                            : isWebSearchTool
                              ? null // Web search shows only sources below, no raw output
                              : <ToolOutput output={formatToolPayload(toolPart.output)} toolName={toolName} />}
                      {(() => {
                        const sources = extractSourcesFromToolOutput(toolPart.output, toolName)
                        if (sources.length === 0) return null
                        return (
                          <div className="px-4 pb-4">
                            <Sources defaultOpen={isWebSearchTool}>
                              <SourcesTrigger count={sources.length} />
                              <SourcesContent>
                                {sources.map((source, idx) => (
                                  <Source
                                    key={`${source.url}-${idx}`}
                                    href={source.url}
                                    title={source.title}
                                    favicon={source.favicon}
                                  />
                                ))}
                              </SourcesContent>
                            </Sources>
                          </div>
                        )
                      })()}
                    </>
                  )}

                  {toolState === 'output-error' && (
                    <ToolOutput
                      output={null}
                      errorText={typeof toolPart.errorText === 'string' ? toolPart.errorText : 'Tool execution failed'}
                      toolName={toolName}
                    />
                  )}

                  {toolState === 'output-denied' && (
                    <ToolOutput output={null} errorText="Tool execution denied" toolName={toolName} />
                  )}
                </ToolContent>
              </Tool>
            )
          }

          return null
        })}
        {sourceItems.length > 0 && (
          <div className="px-2 pb-2">
            <Sources>
              <SourcesTrigger count={sourceItems.length} />
              <SourcesContent>
                {sourceItems.map((source, idx) => (
                  <Source
                    key={`${source.url}-${idx}`}
                    href={source.url}
                    title={source.title}
                    favicon={source.favicon}
                  />
                ))}
              </SourcesContent>
            </Sources>
          </div>
        )}
      </MessageContent>
      {canCopy && (
        <div className="mt-0.5 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void handleCopyMessage()}
            className="h-6 w-6 rounded-md text-muted-foreground opacity-0 pointer-events-none transition-opacity hover:text-foreground group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
            aria-label="Copy message"
          >
            {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}
    </Message>
  )
}

export const MessageBubble = memo(MessageBubbleComponent)

function defaultAttachmentName(mediaType: string): string {
  if (mediaType.toLowerCase() === 'application/pdf') {
    return 'Attachment.pdf'
  }

  if (mediaType.toLowerCase().startsWith('image/')) {
    return 'Image attachment'
  }

  return 'Attachment'
}

function isFilePart(part: UIMessage['parts'][number]): part is FilePart {
  return (
    part.type === 'file' &&
    typeof (part as FilePart).mediaType === 'string' &&
    typeof (part as FilePart).url === 'string'
  )
}

function extractCopyableTextFromParts(parts: UIMessage['parts']): string {
  const textParts = parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
  return textParts.join('\n\n')
}

function formatToolPayload(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value, null, 2)
    return serialized ?? String(value)
  } catch {
    return String(value)
  }
}

function extractTerminalOutput(output: unknown): string {
  if (typeof output === 'string') {
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(output)
      // If it has an output field, use that
      if (typeof parsed?.output === 'string') return parsed.output
      if (typeof parsed?.stdout === 'string') return parsed.stdout
      if (typeof parsed?.result === 'string') return parsed.result
      // Otherwise stringify the parsed object
      return JSON.stringify(parsed, null, 2)
    } catch {
      // Not JSON, return as-is
      return output
    }
  }
  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>
    if (typeof obj.output === 'string') return obj.output
    if (typeof obj.stdout === 'string') return obj.stdout
    if (typeof obj.result === 'string') return obj.result
    return JSON.stringify(obj, null, 2)
  }
  return String(output)
}

function extractTasksFromInput(input: unknown): TaskData[] {
  const payload = isRecord(input) ? input : null
  // Handle tasks/todos arrays and tasks_json compatibility payloads.
  let tasks: unknown[] = []
  if (payload && Array.isArray(payload.tasks)) {
    tasks = payload.tasks
  } else if (payload && Array.isArray(payload.todos)) {
    tasks = payload.todos
  } else if (payload && typeof payload.tasks_json === 'string') {
    const parsed = parseJsonArrayLoose(payload.tasks_json)
    if (parsed) tasks = parsed
  }
  return tasks
    .filter(isRecord)
    .map((task) => {
      const titleValue = typeof task.title === 'string'
        ? task.title
        : typeof task.content === 'string'
          ? task.content
          : 'Untitled task'
      const statusValue = typeof task.status === 'string' ? task.status : 'pending'
      return {
        id: String(task.id ?? titleValue ?? crypto.randomUUID()),
        title: String(titleValue),
        status: statusValue as TaskData['status'],
        files: Array.isArray(task.files) ? task.files.map((f) => String(f)) : undefined,
        details: task.activeForm ? String(task.activeForm) : undefined,
      }
    })
}

function extractTasksFromToolOutput(output: unknown): TaskData[] {
  let payload: unknown = output
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return []
    }
  }

  const taskContainer = isRecord(payload) ? payload : null
  const tasks = Array.isArray(taskContainer?.tasks)
    ? taskContainer.tasks
    : Array.isArray(taskContainer?.todos)
      ? taskContainer.todos
      : typeof taskContainer?.tasks_json === 'string'
        ? parseJsonArrayLoose(taskContainer.tasks_json) ?? []
        : []
  return tasks
    .filter(isRecord)
    .map((task) => {
      const titleValue = typeof task.title === 'string'
        ? task.title
        : typeof task.content === 'string'
          ? task.content
          : 'Untitled task'
      const statusValue = typeof task.status === 'string' ? task.status : 'pending'
      return {
        id: String(task.id ?? titleValue ?? crypto.randomUUID()),
        title: String(titleValue),
        status: statusValue as TaskData['status'],
        files: Array.isArray(task.files) ? task.files.map((f) => String(f)) : undefined,
        details: task.activeForm ? String(task.activeForm) : undefined,
      }
    })
}

function extractSourcesFromParts(parts: UIMessage['parts']): ExtractedSource[] {
  const sources: ExtractedSource[] = []
  for (const part of parts) {
    // Check for source-url type or any source-like part
    if (part.type !== 'source-url' && !part.type.startsWith('source')) continue
    const sourcePart = part as SourcePart
    const url = sourcePart.url || sourcePart.uri || sourcePart.source?.url
    if (!url) continue
    sources.push({
      url,
      title: sourcePart.title || sourcePart.source?.title || url,
      favicon: sourcePart.favicon,
    })
  }
  return sources
}

function extractSourcesFromToolOutput(output: unknown, toolName: string): ExtractedSource[] {
  const isWebSearchTool = toolName.toLowerCase().includes('search') ||
    toolName.toLowerCase().includes('web') ||
    toolName === 'tavily_search' ||
    toolName === 'brave_search' ||
    toolName === 'bing_search'

  if (!isWebSearchTool) return []

  const sources: ExtractedSource[] = []

  try {
    if (typeof output === 'string') {
      try {
        const parsed = JSON.parse(output)
        return extractSourcesFromToolOutput(parsed, toolName)
      } catch {
        const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
        const urls = output.match(urlRegex) || []
        urls.forEach((url) => {
          try {
            const urlObj = new URL(url)
            sources.push({
              url,
              title: urlObj.hostname,
            })
          } catch {
            // Ignore invalid URLs
          }
        })
      }
    } else if (Array.isArray(output)) {
      output.forEach((item) => {
        if (!isRecord(item)) return
        const url = typeof item.url === 'string' ? item.url : typeof item.link === 'string' ? item.link : null
        if (!url) return
        sources.push({
          url,
          title: (typeof item.title === 'string' && item.title)
            || (typeof item.name === 'string' && item.name)
            || new URL(url).hostname,
          favicon: typeof item.favicon === 'string' ? item.favicon : typeof item.icon === 'string' ? item.icon : undefined,
        })
      })
    } else if (typeof output === 'object' && output !== null) {
      const obj = output as Record<string, unknown>
      if (Array.isArray(obj.results)) {
        return extractSourcesFromToolOutput(obj.results, toolName)
      }
      if (Array.isArray(obj.sources)) {
        return extractSourcesFromToolOutput(obj.sources, toolName)
      }
      if (Array.isArray(obj.organic)) {
        return extractSourcesFromToolOutput(obj.organic, toolName)
      }
      if (typeof obj.url === 'string') {
        sources.push({
          url: obj.url,
          title: (typeof obj.title === 'string' && obj.title)
            || (typeof obj.name === 'string' && obj.name)
            || new URL(obj.url).hostname,
          favicon: typeof obj.favicon === 'string' ? obj.favicon : typeof obj.icon === 'string' ? obj.icon : undefined,
        })
      }
    }
  } catch {
    return []
  }

  const seen = new Set<string>()
  return sources.filter((source) => {
    if (seen.has(source.url)) return false
    seen.add(source.url)
    return true
  })
}

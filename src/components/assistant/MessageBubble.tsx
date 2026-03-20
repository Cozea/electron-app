import type { UIMessage } from 'ai'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import { ChatAttachmentCard } from '@/components/assistant/ChatAttachmentCard'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
import {
  ToolDiffOutput,
  extractToolDiffData,
  isFileEditTool,
  type ToolDiffData,
} from '@/components/ai-elements/tool-diff-output'
import { ToolPreviewBrowserOutput } from '@/components/ai-elements/tool-preview-browser-output'
import {
  MessageChangedFilesTray,
} from '@/components/assistant/MessageChangedFilesTray'
import { InjectedPromptPreviewChip } from '@/components/assistant/InjectedPromptPreviewChip'
import { parseInjectedPromptForCompaction } from '@/components/assistant/injectedPromptCompaction'
import { parseJsonArrayLoose } from '@/lib/ai/parseJsonLoose'
import { cn } from '@/lib/utils'
import { AlertCircle, Check, Copy, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

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
  showUserErrorIndicator?: boolean
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
  showUserErrorIndicator = false,
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
  const changedFiles = useMemo(() => collectMessageToolDiffs(message.parts), [message.parts])

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

  const renderToolPart = (toolPart: ToolPart, index: number, grouped = false): ReactNode => {
    const toolName = getToolName(toolPart)
    if (!toolName) return null
    const toolCallId = getToolCallId(toolPart, message.id, index)
    const toolInput = isRecord(toolPart.input) ? toolPart.input : undefined
    const toolMeta = toolsByName.get(toolName)
    const requiresApproval = toolMeta?.executionEnvironment === 'local'
      ? (shouldRequireLocalApproval ? shouldRequireLocalApproval(toolMeta) : toolMeta.requiresApproval ?? false)
      : toolMeta?.requiresApproval ?? false

    const toolState = getToolState(toolPart.state)
    const isTaskTool = toolName === 'todowrite'
    const hasTaskInput =
      Array.isArray(toolInput?.tasks) ||
      Array.isArray(toolInput?.todos) ||
      typeof toolInput?.tasks_json === 'string'

    if (toolName === 'todowrite' && !showTodowriteTools) {
      return null
    }

    const isTerminalTool = toolName === 'bash'
    const terminalOutput = isTerminalTool ? extractTerminalOutput(toolPart.output) : ''
    const isEditTool = isFileEditTool(toolName)
    const isPreviewBrowserTool = toolName === 'preview_browser'
    const isWebSearchTool = toolName.toLowerCase().includes('search') ||
      toolName.toLowerCase().includes('web') ||
      toolName === 'tavily_search' ||
      toolName === 'brave_search' ||
      toolName === 'bing_search'

    const isStaticTool =
      toolName === 'read' ||
      toolName === 'grep' ||
      (isTerminalTool && toolState === 'output-available' && !hasMeaningfulTerminalOutput(terminalOutput))

    if (isStaticTool) {
      return (
        <ToolStatic
          key={`${message.id}-tool-${index}`}
          className={cn(
            'mb-0',
            grouped && 'rounded-none px-0.5'
          )}
          toolName={toolName}
          input={toolInput}
          type={toolMeta?.toolType || 'function'}
          state={toolState}
        />
      )
    }

    return (
      <Tool
        key={`${message.id}-tool-${index}`}
        className={cn(
          'data-[state=closed]:mb-0',
          grouped ? 'rounded-none data-[state=open]:mb-0' : 'data-[state=open]:mb-1'
        )}
      >
        <ToolHeader
          className={grouped ? 'rounded-none px-0.5 hover:bg-background/60' : undefined}
          toolName={toolName}
          input={toolInput}
          type={toolMeta?.toolType || 'function'}
          state={toolState}
        />
        <ToolContent>
          {isTaskTool && toolState !== 'output-available' && hasTaskInput && (
            <TaskProgress tasks={extractTasksFromInput(toolInput)} showSummary />
          )}

          {isTerminalTool && typeof toolInput?.command === 'string' && (() => {
            const activeTerminalId = terminalSessions?.get(toolCallId)
            if (activeTerminalId && projectPath && toolState !== 'output-available') {
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
            if (toolState !== 'output-available') {
              return (
                <div className="px-4 py-2 text-sm text-muted-foreground font-mono">
                  $ {toolInput.command}
                </div>
              )
            }
            return null
          })()}

          {isEditTool && toolInput && (
            <ToolDiffOutput
              toolName={toolName}
              input={toolInput}
              maxHeight={300}
            />
          )}

          {isPreviewBrowserTool && toolInput && toolState !== 'output-available' && (
            <div className="px-2 pb-2">
              <ToolPreviewBrowserOutput
                input={toolInput}
                state={toolState}
              />
            </div>
          )}

          {!isTaskTool && !isTerminalTool && !isEditTool && !isPreviewBrowserTool && !isWebSearchTool && toolName !== 'list' && toolInput && (
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
                  ? (
                    <div className="px-2 pb-2">
                      <BuilderTerminalOutput
                        command={typeof toolInput?.command === 'string' ? toolInput.command : undefined}
                        output={terminalOutput}
                      />
                    </div>
                  )
                  : isPreviewBrowserTool
                    ? (
                      <div className="px-2 pb-2">
                        <ToolPreviewBrowserOutput
                          input={toolInput}
                          output={toolPart.output}
                          state={toolState}
                        />
                      </div>
                    )
                    : isEditTool
                      ? null
                      : isWebSearchTool
                        ? null
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

  return (
    <Message from={message.role}>
      <div className={cn(message.role === 'user' ? 'flex justify-end' : 'w-full')}>
        <div className={cn('flex items-start gap-2', message.role === 'user' ? 'w-fit max-w-full' : 'w-full')}>
          {message.role === 'user' && showUserErrorIndicator ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  aria-label="Request failed"
                  tabIndex={0}
                  className="mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive text-[11px] font-semibold text-destructive-foreground outline-none"
                >
                  !
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Request failed</p>
              </TooltipContent>
            </Tooltip>
          ) : null}
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
          {(() => {
            const renderedParts: ReactNode[] = []

            for (let index = 0; index < message.parts.length; index += 1) {
              const part = message.parts[index]

              if (part.type === 'step-start') {
                continue
              }

              if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
                const groupedToolParts: Array<{ part: ToolPart; index: number }> = []
                let cursor = index

                while (cursor < message.parts.length) {
                  const groupedPart = message.parts[cursor]
                  if (groupedPart.type === 'step-start') {
                    cursor += 1
                    continue
                  }
                  if (!(groupedPart.type === 'dynamic-tool' || groupedPart.type.startsWith('tool-'))) {
                    break
                  }

                  groupedToolParts.push({ part: groupedPart as ToolPart, index: cursor })
                  cursor += 1
                }

                const useGroupedRows = groupedToolParts.length > 1
                const toolNodes = groupedToolParts
                  .map(({ part: groupedToolPart, index: groupedIndex }) =>
                    renderToolPart(groupedToolPart, groupedIndex, useGroupedRows)
                  )
                  .filter(Boolean)

                if (toolNodes.length > 0) {
                  renderedParts.push(
                    <div
                      key={`${message.id}-tool-group-${index}`}
                      className="rounded-xl border border-border/45 bg-card/25 px-2 py-1.5"
                    >
                      {toolNodes.length > 1 ? (
                        <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
                          <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
                            Tool calls ({toolNodes.length})
                          </p>
                        </div>
                      ) : null}
                      <div className={cn(useGroupedRows && 'divide-y divide-border/35')}>
                        {toolNodes}
                      </div>
                    </div>
                  )
                }

                index = cursor - 1
                continue
              }

              if (isFilePart(part)) {
                renderedParts.push(
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
                continue
              }

              if (part.type === 'text') {
                const compactedPrompt =
                  message.role === 'user'
                    ? parseInjectedPromptForCompaction(part.text)
                    : null

                if (compactedPrompt) {
                  renderedParts.push(
                    <div key={`${message.id}-text-${index}`} className="flex">
                      <InjectedPromptPreviewChip preview={compactedPrompt} />
                    </div>
                  )
                  continue
                }

                renderedParts.push(
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
                continue
              }

              if (part.type === 'reasoning') {
                const reasoningPart = part as ReasoningPart
                const hasSubsequentParts = message.parts.slice(index + 1).some(
                  nextPart => nextPart.type !== 'step-start'
                )
                const isThisReasoningStreaming = isStreaming && !hasSubsequentParts
                renderedParts.push(
                  <Reasoning
                    key={`${message.id}-reasoning-${index}`}
                    isStreaming={isThisReasoningStreaming}
                    duration={reasoningPart.duration}
                  >
                    <ReasoningTrigger />
                    <ReasoningContent>{reasoningPart.text || ''}</ReasoningContent>
                  </Reasoning>
                )
                continue
              }

              const partType = (part as { type?: string }).type
              if (partType === 'error' || partType === 'data-error') {
                if (dismissedErrors.has(index)) {
                  continue
                }
                const errorPart = part as ErrorPart
                const errorMessage = errorPart.error || errorPart.message || errorPart.text || 'Error'
                renderedParts.push(
                  <div
                    key={`${message.id}-error-${index}`}
                    className="flex items-center gap-2 rounded-lg bg-background/90 border border-destructive/30 px-3 py-2"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                    <span className="flex-1 text-sm text-destructive">{errorMessage}</span>
                    <button
                      type="button"
                      className="text-destructive/70 transition-colors hover:text-destructive"
                      onClick={() => setDismissedErrors(prev => new Set(prev).add(index))}
                      aria-label="Dismiss error"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )
              }
            }

            return renderedParts
          })()}
          {message.role === 'assistant' && !isStreaming && changedFiles.length > 0 ? (
            <MessageChangedFilesTray changes={changedFiles} />
          ) : null}
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
        </div>
      </div>
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

function collectMessageToolDiffs(parts: UIMessage['parts']): ToolDiffData[] {
  const diffs: ToolDiffData[] = []

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!(part.type === 'dynamic-tool' || part.type.startsWith('tool-'))) continue

    const toolPart = part as ToolPart
    const toolName = getToolName(toolPart)
    if (!toolName || !isFileEditTool(toolName)) continue
    if (getToolState(toolPart.state) !== 'output-available') continue

    const toolInput = isRecord(toolPart.input) ? toolPart.input : undefined
    if (!toolInput) continue

    const extracted = extractToolDiffData(toolName, toolInput)
    if (!extracted) continue

    if (Array.isArray(extracted)) {
      diffs.push(...extracted)
    } else {
      diffs.push(extracted)
    }
  }

  return diffs
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

function hasMeaningfulTerminalOutput(output: string): boolean {
  // eslint-disable-next-line no-control-regex
  const strippedAnsi = output.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
  return strippedAnsi.trim().length > 0
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

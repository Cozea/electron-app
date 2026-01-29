import type { UIMessage } from 'ai'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
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
import { parseJsonArrayLoose } from '@/lib/ai/parseJsonLoose'

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
  shouldRequireLocalApproval?: (toolMeta?: MessageToolMeta) => boolean
  onApproveTool?: (toolName: string, toolCallId: string, input: any, approvalId?: string) => void
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

export function MessageBubble({
  message,
  toolsByName,
  status,
  shouldRequireLocalApproval,
  onApproveTool,
  onDenyTool,
  terminalSessions,
  projectPath,
}: MessageBubbleProps) {
  const isStreaming = status === 'streaming'
  const sourceItems = extractSourcesFromParts(message.parts)

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) => {
          // Skip step-start separators (no visual divider needed)
          if (part.type === 'step-start') {
            return null
          }

          if (part.type === 'text') {
            return (
              <MessageResponse key={`${message.id}-text-${index}`}>
                {part.text}
              </MessageResponse>
            )
          }

          if (part.type === 'reasoning') {
            const reasoningPart = part as any
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

          if (part.type === 'data-usage') {
            const usage = (part as any).data as {
              model?: string
              provider?: string
              creditsUsed?: number
              promptTokens?: number
              completionTokens?: number
              totalTokens?: number
            } | undefined

            if (!usage) return null

            const stats: string[] = []
            if (usage.creditsUsed !== undefined) {
              stats.push(`${usage.creditsUsed} credits`)
            }
            if (usage.totalTokens !== undefined) {
              stats.push(`${usage.totalTokens} tokens`)
            } else if (
              usage.promptTokens !== undefined &&
              usage.completionTokens !== undefined
            ) {
              stats.push(`${usage.promptTokens + usage.completionTokens} tokens`)
            }
            if (usage.model) {
              stats.push(usage.model)
            }

            if (stats.length === 0) return null

            return (
              <div
                key={`${message.id}-usage-${index}`}
                className="rounded-md bg-background/70 px-2 py-1 text-[11px] text-muted-foreground"
              >
                Usage: {stats.join(' · ')}
              </div>
            )
          }

          if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
            const toolPart = part as any
            const toolName = part.type === 'dynamic-tool'
              ? toolPart.toolName
              : part.type.replace(/^tool-/, '')
            const toolMeta = toolsByName.get(toolName)
            const requiresApproval = toolMeta?.executionEnvironment === 'local'
              ? (shouldRequireLocalApproval ? shouldRequireLocalApproval(toolMeta) : toolMeta.requiresApproval ?? false)
              : toolMeta?.requiresApproval ?? false

            const toolState = toolPart.state || 'input-streaming'

            // Special handling for task-based tools (like Claude Code's TodoWrite)
            const isTaskTool = toolName === 'todo_list' || toolName === 'build_tasks'

            // Skip rendering build_tasks entirely - it's shown in the controls pill
            if (toolName === 'build_tasks') {
              return null
            }
            // Special handling for terminal tools
            const isTerminalTool = toolName === 'run_in_terminal' || toolName === 'get_terminal_output'
            // Special handling for file edit tools (show Monaco diff)
            const isEditTool = isFileEditTool(toolName)
            // Special handling for web search tools (show only sources)
            const isWebSearchTool = toolName.toLowerCase().includes('search') ||
              toolName.toLowerCase().includes('web') ||
              toolName === 'tavily_search' ||
              toolName === 'brave_search' ||
              toolName === 'bing_search'

            // Non-expandable tools (output is not useful to display)
            const isStaticTool = toolName === 'read_file'

            // Render static (non-expandable) tools
            if (isStaticTool) {
              return (
                <ToolStatic
                  key={`${message.id}-tool-${index}`}
                  toolName={toolName}
                  input={toolPart.input as Record<string, unknown> | undefined}
                  type={toolMeta?.toolType || 'function'}
                  state={toolState}
                />
              )
            }

            return (
              <Tool key={`${message.id}-tool-${index}`}>
                <ToolHeader
                  toolName={toolName}
                  input={toolPart.input as Record<string, unknown> | undefined}
                  type={toolMeta?.toolType || 'function'}
                  state={toolState}
                />
                <ToolContent>
                  {/* For task tools, show TaskProgress from input while running/streaming */}
                  {isTaskTool && toolPart.state !== 'output-available' && (toolPart.input?.tasks || toolPart.input?.tasks_json) && (
                    <TaskProgress tasks={extractTasksFromInput(toolPart.input)} showSummary />
                  )}

                  {/* For terminal tools, show live terminal if session is active, otherwise show command */}
                  {isTerminalTool && toolPart.input?.command && (() => {
                    const activeTerminalId = terminalSessions?.get(toolPart.toolCallId)
                    if (activeTerminalId && projectPath && toolPart.state !== 'output-available') {
                      // Show live interactive terminal
                      return (
                        <div className="px-4 py-2">
                          <BuilderTerminal
                            terminalId={activeTerminalId}
                            command={toolPart.input.command as string}
                            projectPath={projectPath}
                            isStreaming={true}
                          />
                        </div>
                      )
                    }
                    // Show command header only when no live terminal and not complete
                    if (toolPart.state !== 'output-available') {
                      return (
                        <div className="px-4 py-2 text-sm text-muted-foreground font-mono">
                          $ {toolPart.input.command}
                        </div>
                      )
                    }
                    return null
                  })()}

                  {/* For file edit tools, show Monaco diff viewer */}
                  {isEditTool && toolPart.input && (
                    <ToolDiffOutput
                      toolName={toolName}
                      input={toolPart.input as Record<string, unknown>}
                      maxHeight={300}
                    />
                  )}

                  {/* For non-task/non-terminal/non-edit/non-list_dir/non-web_search tools, show raw input */}
                  {!isTaskTool && !isTerminalTool && !isEditTool && !isWebSearchTool && toolName !== 'list_dir' && toolPart.input && (
                    <ToolInput input={formatToolPayload(toolPart.input)} />
                  )}

                  {requiresApproval && onApproveTool && onDenyTool && (
                    <ConfirmationDialog
                      state={
                        (toolPart.state === 'input-available' || toolPart.state === 'approval-requested')
                          ? 'pending'
                          : toolPart.state === 'output-denied'
                            ? 'rejected'
                            : toolPart.state === 'output-available'
                              ? 'approved'
                              : 'pending' as ConfirmationState
                      }
                      toolName={toolMeta?.displayName || toolName}
                      toolCallId={toolPart.toolCallId}
                      description="This tool requires your approval to execute."
                      onApprove={() => onApproveTool(toolName, toolPart.toolCallId, toolPart.input, toolPart.approval?.id)}
                      onReject={() => onDenyTool(toolName, toolPart.toolCallId, toolPart.approval?.id)}
                    />
                  )}

                  {toolPart.state === 'output-available' && (
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
                            command={toolPart.input?.command as string | undefined}
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

                  {toolPart.state === 'output-error' && (
                    <ToolOutput output={null} errorText={toolPart.errorText} toolName={toolName} />
                  )}

                  {toolPart.state === 'output-denied' && (
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
    </Message>
  )
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
  const payload = input as any
  // Handle both formats: direct tasks array (Anthropic/OpenAI) or tasks_json string (Google/Gemini)
  let tasks: any[] = []
  if (Array.isArray(payload?.tasks)) {
    tasks = payload.tasks
  } else if (payload?.tasks_json) {
    const parsed = parseJsonArrayLoose(payload.tasks_json)
    if (parsed) tasks = parsed
  }
  return tasks
    .filter((task: any) => task && typeof task === 'object')
    .map((task: any) => {
      const title = task.title ?? task.content ?? 'Untitled task'
      return {
        id: String(task.id ?? title ?? crypto.randomUUID()),
        title: String(title),
        status: (task.status ?? 'pending') as TaskData['status'],
        files: Array.isArray(task.files) ? task.files.map((f: any) => String(f)) : undefined,
        details: task.activeForm ? String(task.activeForm) : undefined,
      }
    })
}

function extractTasksFromToolOutput(output: unknown): TaskData[] {
  let payload = output as any
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return []
    }
  }

  const tasks = Array.isArray(payload?.tasks) ? payload.tasks : []
  return tasks
    .filter((task: any) => task && typeof task === 'object')
    .map((task: any) => {
      const title = task.title ?? task.content ?? 'Untitled task'
      return {
        id: String(task.id ?? title ?? crypto.randomUUID()),
        title: String(title),
        status: (task.status ?? 'pending') as TaskData['status'],
        files: Array.isArray(task.files) ? task.files.map((f: any) => String(f)) : undefined,
        details: task.activeForm ? String(task.activeForm) : undefined,
      }
    })
}

function extractSourcesFromParts(parts: UIMessage['parts']): ExtractedSource[] {
  const sources: ExtractedSource[] = []
  for (const part of parts) {
    // Check for source-url type or any source-like part
    if (part.type !== 'source-url' && !part.type.startsWith('source')) continue
    const sourcePart = part as any
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
      output.forEach((item: any) => {
        if (item?.url) {
          sources.push({
            url: item.url,
            title: item.title || item.name || new URL(item.url).hostname,
            favicon: item.favicon || item.icon,
          })
        } else if (item?.link) {
          sources.push({
            url: item.link,
            title: item.title || item.name || new URL(item.link).hostname,
            favicon: item.favicon || item.icon,
          })
        }
      })
    } else if (typeof output === 'object' && output !== null) {
      const obj = output as Record<string, any>
      if (obj.results && Array.isArray(obj.results)) {
        return extractSourcesFromToolOutput(obj.results, toolName)
      }
      if (obj.sources && Array.isArray(obj.sources)) {
        return extractSourcesFromToolOutput(obj.sources, toolName)
      }
      if (obj.organic && Array.isArray(obj.organic)) {
        return extractSourcesFromToolOutput(obj.organic, toolName)
      }
      if (obj.url) {
        sources.push({
          url: obj.url,
          title: obj.title || obj.name || new URL(obj.url).hostname,
          favicon: obj.favicon || obj.icon,
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

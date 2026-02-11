import type { UIMessage } from 'ai'
import { memo } from 'react'

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
import { Sources, SourcesTrigger, SourcesContent, Source } from '@/components/ai-elements/sources'
import { TaskProgress, type TaskData } from '@/components/assistant/TaskProgress'
import { ToolDiffOutput, isFileEditTool } from '@/components/ai-elements/tool-diff-output'
import type { ToolMetaShape } from '@/lib/ai/toolTypes'

interface ToolPart {
  type: string
  toolCallId?: string
  toolName?: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

interface ReasoningPart {
  duration?: number
  text?: string
}

interface UsageData {
  model?: string
  provider?: string
  creditsUsed?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

interface SourcePart {
  url?: string
  uri?: string
  title?: string
  favicon?: string
  source?: { url?: string; title?: string }
}

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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

function formatToolPayload(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
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

  if (!isRecord(payload)) return []
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : []
  return tasks
    .filter((task): task is Record<string, unknown> => isRecord(task))
    .map((task) => {
      const status = typeof task.status === 'string' ? task.status : 'pending'
      return {
        id: String(task.id ?? crypto.randomUUID()),
        title: String(task.title ?? 'Untitled task'),
        status: status as TaskData['status'],
        files: Array.isArray(task.files) ? task.files.map((file) => String(file)) : undefined,
        details: task.details ? String(task.details) : undefined,
      }
    })
}

function extractSourcesFromParts(parts: UIMessage['parts']) {
  const sources: Array<{ url: string; title: string; favicon?: string }> = []
  for (const part of parts) {
    if (part.type !== 'source-url') continue
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

interface WizardMessageBubbleProps {
  message: UIMessage
  toolsByName: Map<string, ToolMetaShape>
  status: 'ready' | 'submitted' | 'streaming' | 'error'
}

function WizardMessageBubbleComponent({ message, toolsByName, status }: WizardMessageBubbleProps) {
  const isStreaming = status === 'streaming'
  const sourceItems = extractSourcesFromParts(message.parts)

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) => {
          if (part.type === 'step-start') {
            return (
              <div key={`${message.id}-step-${index}`} className="py-2">
                <div className="h-px bg-border" />
              </div>
            )
          }

          if (part.type === 'text') {
            return (
              <MessageResponse key={`${message.id}-text-${index}`}>
                {part.text}
              </MessageResponse>
            )
          }

          if (part.type === 'reasoning') {
            const reasoningPart = part as ReasoningPart
            return (
              <Reasoning
                key={`${message.id}-reasoning-${index}`}
                isStreaming={isStreaming}
                duration={reasoningPart.duration}
              >
                <ReasoningTrigger />
                <ReasoningContent>{reasoningPart.text || ''}</ReasoningContent>
              </Reasoning>
            )
          }

          if (part.type === 'data-usage') {
            const usage = (part as { data?: UsageData }).data

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

          // Tool calls
          if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
            const toolPart = part as ToolPart
            const toolName = getToolName(toolPart)
            if (!toolName) return null
            const toolInput = isRecord(toolPart.input) ? toolPart.input : undefined

            // Skip present_plans tool - it's rendered as PlanSelector below messages
            if (toolName === 'present_plans') {
              return null
            }

            const toolMeta = toolsByName.get(toolName)
            const toolState = getToolState(toolPart.state)
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
                  {/* For file edit tools, show Monaco diff viewer */}
                  {isEditTool && toolInput && (
                    <ToolDiffOutput
                      toolName={toolName}
                      input={toolInput}
                      maxHeight={300}
                    />
                  )}
                  {/* For non-edit/non-list_dir/non-web_search tools, show raw input */}
                  {!isEditTool && !isWebSearchTool && toolName !== 'list_dir' && toolInput && (
                    <ToolInput input={formatToolPayload(toolInput)} />
                  )}
                  {toolPart.state === 'output-available' && (
                    toolName === 'todo_list'
                      ? (() => {
                        const tasks = extractTasksFromToolOutput(toolPart.output)
                        if (tasks.length === 0) {
                          return <ToolOutput output={formatToolPayload(toolPart.output)} toolName={toolName} />
                        }
                        return <TaskProgress tasks={tasks} showSummary />
                      })()
                      : isEditTool
                        ? null // Diff viewer already shows the edit
                        : isWebSearchTool
                          ? null // Web search shows only sources, no raw output
                          : <ToolOutput output={formatToolPayload(toolPart.output)} toolName={toolName} />
                  )}
                  {toolPart.state === 'output-error' && (
                    <ToolOutput output={null} errorText={toolPart.errorText} toolName={toolName} />
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

function areWizardMessageBubblePropsEqual(
  prev: WizardMessageBubbleProps,
  next: WizardMessageBubbleProps
): boolean {
  return (
    prev.message === next.message &&
    prev.toolsByName === next.toolsByName &&
    prev.status === next.status
  )
}

export const WizardMessageBubble = memo(
  WizardMessageBubbleComponent,
  areWizardMessageBubblePropsEqual
)

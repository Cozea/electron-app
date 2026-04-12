import {
  ApprovalRequestId,
  MessageId,
  type ModelSelection,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderKind,
  type RuntimeMode,
  type ServerProvider,
  type TurnId,
} from "@cozea/assistant-contracts"
import { ArrowPathIcon as Loader2, ChevronLeftIcon, ChevronRightIcon, CpuChipIcon as BotIcon, ListBulletIcon as ListTodoIcon, LockClosedIcon as LockIcon, LockOpenIcon, XMarkIcon as XIcon } from "@heroicons/react/24/outline"
import {
  type ClipboardEventHandler,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
import { ComposerPendingApprovalActions } from "@/features/projects/components/assistant/chat/ComposerPendingApprovalActions"
import { ComposerPendingApprovalPanel } from "@/features/projects/components/assistant/chat/ComposerPendingApprovalPanel"
import { ComposerPendingUserInputPanel } from "@/features/projects/components/assistant/chat/ComposerPendingUserInputPanel"
import { ComposerPlanFollowUpBanner } from "@/features/projects/components/assistant/chat/ComposerPlanFollowUpBanner"
import { ContextWindowMeter } from "@/features/projects/components/assistant/chat/ContextWindowMeter"
import type {
  ExpandedImageItem,
  ExpandedImagePreview,
} from "@/features/projects/components/assistant/chat/ExpandedImagePreview"
import { MessagesTimeline } from "@/features/projects/components/assistant/chat/MessagesTimeline"
import { ProviderModelPicker } from "@/features/projects/components/assistant/chat/ProviderModelPicker"
import { ProviderStatusBanner } from "@/features/projects/components/assistant/chat/ProviderStatusBanner"
import { ThreadErrorBanner } from "@/features/projects/components/assistant/chat/ThreadErrorBanner"
import {
  deriveActiveWorkStartedAt,
  derivePhase,
  deriveTimelineEntries,
  deriveWorkLogEntries,
  findLatestProposedPlan,
  formatElapsed,
  hasActionableProposedPlan,
  hasToolActivityForTurn,
  inferCheckpointTurnCountByTurnId,
  isLatestTurnSettled,
  type PendingApproval,
  type PendingUserInput,
} from "@/features/projects/components/assistant/chat/session-logic"
import { ComposerPromptEditor } from "@/features/projects/components/assistant/chat/ComposerPromptEditor"
import type { ContextWindowSnapshot } from "@/features/projects/components/assistant/lib/contextWindow"
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  findFirstUnansweredPendingUserInputQuestionIndex,
  type PendingUserInputDraftAnswer,
} from "@/features/projects/components/assistant/pendingUserInput"
import { type Thread } from "@/stores/types"
import { cn } from "@/lib/utils"

export type UserInputAnswerDrafts = Record<string, Record<string, string>>

export interface ProviderModelOptionsByProvider {
  codex: ReadonlyArray<{ slug: string; name: string }>
  claudeAgent: ReadonlyArray<{ slug: string; name: string }>
}

interface CozeaChatSurfaceProps {
  isRuntimeReady: boolean
  runtimeErrorMessage: string | null
  projectPath: string | null
  thread: Thread | null
  providerSnapshot: ServerProvider | null
  isRunning: boolean
  isBinding: boolean
  isConfigLoading: boolean
  bindingError: string | null
  timelineRef: RefObject<HTMLDivElement | null>
  pendingApprovals: PendingApproval[]
  pendingUserInputs: PendingUserInput[]
  activeRequestKey: string | null
  userInputDrafts: UserInputAnswerDrafts
  activeContextWindow: ContextWindowSnapshot | null
  composerStatus: ReactNode
  composer: string
  composerCursor: number
  isSending: boolean
  isInterrupting: boolean
  isRevertingCheckpoint?: boolean
  selectedProvider: ProviderKind
  selectedModelSelection: ModelSelection
  selectedRuntimeMode: RuntimeMode
  selectedInteractionMode: ProviderInteractionMode
  providers: ReadonlyArray<ServerProvider>
  modelOptionsByProvider: ProviderModelOptionsByProvider
  onProviderModelChange: (provider: ProviderKind, model: string) => void | Promise<void>
  onToggleInteractionMode: () => void | Promise<void>
  onToggleRuntimeMode: () => void | Promise<void>
  onComposerChange: (nextValue: string, nextCursor: number) => void
  onComposerCommandKey: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => boolean
  onComposerPaste: ClipboardEventHandler<HTMLElement>
  onSend: () => void | Promise<void>
  onInterrupt: () => void | Promise<void>
  onApprovalDecision: (
    requestId: string,
    decision: ProviderApprovalDecision,
  ) => void | Promise<void>
  onUserInputDraftChange: (requestId: string, questionId: string, value: string) => void
  onSubmitUserInput: (requestId: string) => void | Promise<void>
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void | Promise<void>
  onDismissThreadError?: () => void
  onRevertToTurnCount?: (turnCount: number) => void | Promise<void>
  /** Workbench tiles: bottom composer floats and expands on card hover or focus (like the browser omnibar). */
  dockComposerOnHover?: boolean
}

function isNonEmptyReactNode(node: ReactNode): boolean {
  if (node == null || node === false) {
    return false
  }
  return true
}

function resolveTimelineTheme(): "light" | "dark" {
  if (typeof document !== "undefined") {
    const classes = document.documentElement.classList
    if (
      classes.contains("dark") ||
      classes.contains("navy") ||
      classes.contains("wine") ||
      classes.contains("clay") ||
      classes.contains("forest")
    ) {
      return "dark"
    }
  }
  return "light"
}

function planTitleFromMarkdown(markdown: string): string | null {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return null
  }

  const heading = lines.find((line) => line.startsWith("#"))
  if (!heading) {
    return null
  }

  const normalized = heading.replace(/^#+\s*/, "").trim()
  return normalized.length > 0 ? normalized : null
}

function toPendingUserInputDraftAnswers(
  request: PendingUserInput | null,
  drafts: Record<string, string> | undefined,
): Record<string, PendingUserInputDraftAnswer> {
  if (!request) {
    return {}
  }

  const next: Record<string, PendingUserInputDraftAnswer> = {}
  for (const question of request.questions) {
    const value = drafts?.[question.id]
    if (typeof value !== "string") {
      continue
    }

    if (question.options.some((option) => option.label === value)) {
      next[question.id] = { selectedOptionLabel: value }
      continue
    }

    next[question.id] = { customAnswer: value }
  }
  return next
}

function renderSendIcon(isBusy: boolean) {
  if (isBusy) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        className="animate-spin"
        aria-hidden="true"
      >
        <circle
          cx="7"
          cy="7"
          r="5.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="20 12"
        />
      </svg>
    )
  }

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export const CozeaChatSurface = memo(function CozeaChatSurface(props: CozeaChatSurfaceProps) {
  const resolvedTheme = resolveTimelineTheme()
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [expandedWorkGroups, setExpandedWorkGroups] = useState<Record<string, boolean>>({})
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null)
  const [pendingQuestionIndexByRequestId, setPendingQuestionIndexByRequestId] = useState<
    Record<string, number>
  >({})
  const [composerDockHover, setComposerDockHover] = useState(false)
  const [composerDockFocused, setComposerDockFocused] = useState(false)

  const activeTurn = props.thread?.latestTurn ?? null
  const latestTurnSettled = isLatestTurnSettled(activeTurn, props.thread?.session ?? null)
  const phase = props.thread ? derivePhase(props.thread.session ?? null) : "disconnected"
  const isWorking =
    props.isRunning || props.isSending || props.isInterrupting || Boolean(props.isRevertingCheckpoint)
  const nowIso = new Date(nowTick).toISOString()
  const activeTurnStartedAt = deriveActiveWorkStartedAt(
    activeTurn,
    props.thread?.session ?? null,
    null,
  )
  const threadActivities = props.thread?.activities ?? []
  const workLogEntries = useMemo(
    () => deriveWorkLogEntries(threadActivities, activeTurn?.turnId ?? undefined),
    [activeTurn?.turnId, threadActivities],
  )
  const timelineEntries = useMemo(
    () => deriveTimelineEntries(props.thread?.messages ?? [], props.thread?.proposedPlans ?? [], workLogEntries),
    [props.thread?.messages, props.thread?.proposedPlans, workLogEntries],
  )
  const latestTurnHasToolActivity = useMemo(
    () => hasToolActivityForTurn(threadActivities, activeTurn?.turnId),
    [activeTurn?.turnId, threadActivities],
  )
  const inferredCheckpointTurnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(props.thread?.turnDiffSummaries ?? []),
    [props.thread?.turnDiffSummaries],
  )
  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const byMessageId = new Map<MessageId, Thread["turnDiffSummaries"][number]>()
    for (const summary of props.thread?.turnDiffSummaries ?? []) {
      if (!summary.assistantMessageId) {
        continue
      }
      byMessageId.set(summary.assistantMessageId, summary)
    }
    return byMessageId
  }, [props.thread?.turnDiffSummaries])
  const revertTurnCountByUserMessageId = useMemo(() => {
    const byUserMessageId = new Map<MessageId, number>()

    for (let index = 0; index < timelineEntries.length; index += 1) {
      const entry = timelineEntries[index]
      if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
        continue
      }

      for (let nextIndex = index + 1; nextIndex < timelineEntries.length; nextIndex += 1) {
        const nextEntry = timelineEntries[nextIndex]
        if (!nextEntry || nextEntry.kind !== "message") {
          continue
        }
        if (nextEntry.message.role === "user") {
          break
        }
        const summary = turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id)
        if (!summary) {
          continue
        }
        const turnCount =
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId]
        if (typeof turnCount !== "number") {
          break
        }
        byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1))
        break
      }
    }

    return byUserMessageId
  }, [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId])
  const completionSummary = useMemo(() => {
    if (!latestTurnSettled) return null
    if (!activeTurn?.startedAt || !activeTurn.completedAt) return null
    if (!latestTurnHasToolActivity) return null

    const elapsed = formatElapsed(activeTurn.startedAt, activeTurn.completedAt)
    return elapsed ? `Worked for ${elapsed}` : null
  }, [activeTurn?.completedAt, activeTurn?.startedAt, latestTurnHasToolActivity, latestTurnSettled])
  const completionDividerBeforeEntryId = useMemo(() => {
    if (!latestTurnSettled) return null
    if (!activeTurn?.startedAt || !activeTurn.completedAt || !completionSummary) return null

    const turnStartedAt = Date.parse(activeTurn.startedAt)
    const turnCompletedAt = Date.parse(activeTurn.completedAt)
    if (Number.isNaN(turnStartedAt) || Number.isNaN(turnCompletedAt)) {
      return null
    }

    let inRangeMatch: string | null = null
    let fallbackMatch: string | null = null

    for (const entry of timelineEntries) {
      if (entry.kind !== "message" || entry.message.role !== "assistant") {
        continue
      }
      const messageAt = Date.parse(entry.message.createdAt)
      if (Number.isNaN(messageAt) || messageAt < turnStartedAt) {
        continue
      }
      fallbackMatch = entry.id
      if (messageAt <= turnCompletedAt) {
        inRangeMatch = entry.id
      }
    }

    return inRangeMatch ?? fallbackMatch
  }, [activeTurn?.completedAt, activeTurn?.startedAt, completionSummary, latestTurnSettled, timelineEntries])
  const activeProposedPlan = useMemo(
    () => findLatestProposedPlan(props.thread?.proposedPlans ?? [], activeTurn?.turnId ?? null),
    [activeTurn?.turnId, props.thread?.proposedPlans],
  )
  const showPlanFollowUpPrompt =
    props.pendingUserInputs.length === 0 &&
    props.selectedInteractionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan)
  const activePendingApproval = props.pendingApprovals[0] ?? null
  const activePendingUserInput = props.pendingUserInputs[0] ?? null
  const activePendingDraftAnswers = useMemo(
    () =>
      toPendingUserInputDraftAnswers(
        activePendingUserInput,
        activePendingUserInput
          ? props.userInputDrafts[String(activePendingUserInput.requestId)]
          : undefined,
      ),
    [activePendingUserInput, props.userInputDrafts],
  )
  const defaultPendingQuestionIndex = activePendingUserInput
    ? findFirstUnansweredPendingUserInputQuestionIndex(
        activePendingUserInput.questions,
        activePendingDraftAnswers,
      )
    : 0
  const activePendingQuestionIndex = activePendingUserInput
    ? Math.max(
        0,
        Math.min(
          pendingQuestionIndexByRequestId[String(activePendingUserInput.requestId)] ??
            defaultPendingQuestionIndex,
          Math.max(activePendingUserInput.questions.length - 1, 0),
        ),
      )
    : 0
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  )
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  )
  const activePendingIsResponding = activePendingUserInput
    ? props.activeRequestKey === String(activePendingUserInput.requestId)
    : false
  const isComposerApprovalState = activePendingApproval !== null
  const hasComposerHeader =
    isComposerApprovalState || activePendingUserInput !== null || showPlanFollowUpPrompt
  const composerValue = activePendingProgress?.customAnswer ?? props.composer
  const hasThread = Boolean(props.thread)
  const composerDisabled =
    !props.isRuntimeReady ||
    !hasThread ||
    props.isBinding ||
    isComposerApprovalState ||
    activePendingIsResponding ||
    (!activePendingProgress && props.isSending)
  const markdownCwd = props.thread?.worktreePath ?? props.projectPath ?? undefined
  const workspaceRoot = props.projectPath ?? undefined
  const threadError = props.thread?.error ?? null

  const dockComposerOnHover = Boolean(props.dockComposerOnHover)
  const handleComposerDockBlurCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) {
      return
    }
    setComposerDockFocused(false)
  }, [])
  const showComposerDockChrome =
    !dockComposerOnHover ||
    composerDockHover ||
    composerDockFocused ||
    activePendingApproval !== null ||
    activePendingUserInput !== null ||
    showPlanFollowUpPrompt ||
    isNonEmptyReactNode(props.composerStatus) ||
    props.composer.trim().length > 0 ||
    props.isRunning ||
    props.isSending ||
    props.isInterrupting

  useEffect(() => {
    if (!isWorking) {
      setNowTick(Date.now())
      return
    }

    const intervalId = window.setInterval(() => {
      setNowTick(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isWorking])

  useEffect(() => {
    if (!activePendingUserInput) {
      return
    }

    const requestId = String(activePendingUserInput.requestId)
    setPendingQuestionIndexByRequestId((current) => {
      if (requestId in current) {
        return current
      }
      return {
        ...current,
        [requestId]: defaultPendingQuestionIndex,
      }
    })
  }, [activePendingUserInput, defaultPendingQuestionIndex])

  useEffect(() => {
    const activeRequestIds = new Set(props.pendingUserInputs.map((request) => String(request.requestId)))
    setPendingQuestionIndexByRequestId((current) => {
      const nextEntries = Object.entries(current).filter(([requestId]) => activeRequestIds.has(requestId))
      if (nextEntries.length === Object.keys(current).length) {
        return current
      }
      return Object.fromEntries(nextEntries)
    })
  }, [props.pendingUserInputs])

  const toggleWorkGroup = (groupId: string) => {
    setExpandedWorkGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }))
  }

  const handleExpandImage = (preview: ExpandedImagePreview) => {
    setExpandedImage(preview)
  }

  const closeExpandedImage = () => {
    setExpandedImage(null)
  }

  const navigateExpandedImage = (offset: number) => {
    setExpandedImage((current) => {
      if (!current || current.images.length <= 1) {
        return current
      }
      const nextIndex =
        (current.index + offset + current.images.length) % current.images.length
      return {
        ...current,
        index: nextIndex,
      }
    })
  }

  const handleComposerChange = (nextValue: string, nextCursor: number) => {
    if (activePendingProgress?.activeQuestion && activePendingUserInput) {
      props.onUserInputDraftChange(
        String(activePendingUserInput.requestId),
        activePendingProgress.activeQuestion.id,
        nextValue,
      )
      return
    }

    props.onComposerChange(nextValue, nextCursor)
  }

  const setActivePendingQuestionIndex = (requestId: string, nextIndex: number) => {
    setPendingQuestionIndexByRequestId((current) => ({
      ...current,
      [requestId]: nextIndex,
    }))
  }

  const handleAdvancePendingQuestion = () => {
    if (!activePendingUserInput || !activePendingProgress) {
      return
    }
    setActivePendingQuestionIndex(
      String(activePendingUserInput.requestId),
      Math.min(activePendingProgress.questionIndex + 1, activePendingUserInput.questions.length - 1),
    )
  }

  const handlePreviousPendingQuestion = () => {
    if (!activePendingUserInput || !activePendingProgress) {
      return
    }
    setActivePendingQuestionIndex(
      String(activePendingUserInput.requestId),
      Math.max(activePendingProgress.questionIndex - 1, 0),
    )
  }

  const handleSelectPendingUserInputOption = (questionId: string, optionLabel: string) => {
    if (!activePendingUserInput) {
      return
    }
    props.onUserInputDraftChange(String(activePendingUserInput.requestId), questionId, optionLabel)
  }

  const handleSubmitPendingUserInput = () => {
    if (!activePendingUserInput) {
      return
    }
    void props.onSubmitUserInput(String(activePendingUserInput.requestId))
  }

  const handleRevertUserMessage = (messageId: MessageId) => {
    const turnCount = revertTurnCountByUserMessageId.get(messageId)
    if (typeof turnCount !== "number") {
      return
    }
    void props.onRevertToTurnCount?.(turnCount)
  }

  const expandedImageItem: ExpandedImageItem | null = expandedImage
    ? expandedImage.images[expandedImage.index] ?? null
    : null

  const composerForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void props.onSend()
      }}
      className="mx-auto w-full min-w-0 max-w-2xl"
    >
      {props.composerStatus}

      <div className="mt-3 overflow-hidden rounded-2xl bg-secondary">
        {activePendingApproval ? (
          <div className="border-b border-border/30 bg-background/10">
            <ComposerPendingApprovalPanel
              approval={activePendingApproval}
              pendingCount={props.pendingApprovals.length}
            />
          </div>
        ) : activePendingUserInput ? (
          <div className="border-b border-border/30 bg-background/10">
            <ComposerPendingUserInputPanel
              pendingUserInputs={props.pendingUserInputs}
              respondingRequestIds={
                activePendingIsResponding && activePendingUserInput
                  ? [ApprovalRequestId.makeUnsafe(String(activePendingUserInput.requestId))]
                  : []
              }
              answers={activePendingDraftAnswers}
              questionIndex={activePendingQuestionIndex}
              onSelectOption={handleSelectPendingUserInputOption}
              onAdvance={handleAdvancePendingQuestion}
            />
          </div>
        ) : showPlanFollowUpPrompt && activeProposedPlan ? (
          <div className="border-b border-border/30 bg-background/10">
            <ComposerPlanFollowUpBanner
              key={activeProposedPlan.id}
              planTitle={planTitleFromMarkdown(activeProposedPlan.planMarkdown)}
            />
          </div>
        ) : null}

        <div
          className={cn(
            "relative px-3 pb-2",
            hasComposerHeader ? "pt-2.5" : "pt-3",
          )}
        >
          <ComposerPromptEditor
            value={composerValue}
            cursor={props.composerCursor}
            terminalContexts={[]}
            onRemoveTerminalContext={() => {}}
            onChange={handleComposerChange}
            onCommandKeyDown={props.onComposerCommandKey}
            onPaste={props.onComposerPaste}
            placeholder={
              isComposerApprovalState
                ? (activePendingApproval?.detail ?? "Resolve this approval request to continue")
                : activePendingProgress
                  ? "Type your own answer, or leave this blank to use the selected option"
                  : showPlanFollowUpPrompt
                    ? "Add feedback to refine the plan"
                    : props.runtimeErrorMessage
                      ? "Local chat runtime unavailable. Waiting for recovery..."
                      : phase === "disconnected"
                        ? "Ask for follow-up changes or attach images"
                        : "Ask anything, @tag files/folders, or use / to show available commands"
            }
            className="min-h-6 max-h-[25vh] p-0 text-sm leading-6"
            disabled={composerDisabled}
          />
        </div>

        {activePendingApproval ? (
          <div className="mb-2 flex items-center justify-end gap-2 px-2">
            <ComposerPendingApprovalActions
              requestId={ApprovalRequestId.makeUnsafe(String(activePendingApproval.requestId))}
              isResponding={props.activeRequestKey === String(activePendingApproval.requestId)}
              onRespondToApproval={async (requestId, decision) => {
                await props.onApprovalDecision(String(requestId), decision)
              }}
            />
          </div>
        ) : (
          <div
            data-chat-composer-footer="true"
            className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2 sm:flex-nowrap"
          >
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-max sm:overflow-visible">
              <ProviderModelPicker
                provider={props.selectedProvider}
                model={props.selectedModelSelection.model}
                lockedProvider={null}
                providers={props.providers}
                modelOptionsByProvider={props.modelOptionsByProvider}
                compact
                disabled={!props.isRuntimeReady || props.isRunning}
                triggerClassName="h-7 rounded-full border border-transparent px-2 text-xs font-normal leading-none text-muted-foreground hover:bg-accent sm:text-xs"
                onProviderModelChange={props.onProviderModelChange}
              />
            </div>

            <div data-chat-composer-actions="right" className="flex shrink-0 items-center gap-2">
              {activePendingProgress ? (
                <div className="flex items-center gap-2">
                  {activePendingProgress.questionIndex > 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      type="button"
                      onClick={handlePreviousPendingQuestion}
                      disabled={activePendingIsResponding}
                    >
                      Previous
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full px-4"
                    onClick={() => {
                      if (activePendingProgress.isLastQuestion) {
                        handleSubmitPendingUserInput()
                        return
                      }
                      handleAdvancePendingQuestion()
                    }}
                    disabled={
                      activePendingIsResponding ||
                      (activePendingProgress.isLastQuestion
                        ? !activePendingResolvedAnswers
                        : !activePendingProgress.canAdvance)
                    }
                  >
                    {activePendingIsResponding
                      ? "Submitting..."
                      : activePendingProgress.isLastQuestion
                        ? "Submit answers"
                        : "Next question"}
                  </Button>
                </div>
              ) : props.isRunning ? (
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    void props.onInterrupt()
                  }}
                  aria-label="Stop generation"
                  disabled={!props.isRuntimeReady || props.isInterrupting}
                >
                  {props.isInterrupting ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                      <rect x="2" y="2" width="8" height="8" rx="1.5" />
                    </svg>
                  )}
                </button>
              ) : (
                <button
                  type="submit"
                  className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
                  disabled={
                    !props.isRuntimeReady ||
                    !props.thread ||
                    !props.composer.trim() ||
                    props.isSending ||
                    props.isBinding
                  }
                  aria-label={
                    !props.isRuntimeReady
                      ? "Local runtime unavailable"
                      : props.isBinding
                        ? "Binding agent"
                        : props.isSending
                          ? "Sending"
                          : "Send message"
                  }
                >
                  {renderSendIcon(props.isSending)}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {!activePendingApproval ? (
        <div className="flex items-center justify-between gap-3 px-1 pt-2">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              className="h-6 shrink-0 whitespace-nowrap rounded-full border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              size="sm"
              type="button"
              disabled={!props.isRuntimeReady || props.isRunning}
              onClick={() => {
                void props.onToggleInteractionMode()
              }}
              title={
                props.selectedInteractionMode === "plan"
                  ? "Plan mode - click to return to normal chat mode"
                  : "Default mode - click to enter plan mode"
              }
            >
              {showPlanFollowUpPrompt ? <ListTodoIcon /> : <BotIcon />}
              <span>{props.selectedInteractionMode === "plan" ? "Plan" : "Chat"}</span>
            </Button>

            <Button
              variant="ghost"
              className="h-6 shrink-0 whitespace-nowrap rounded-full border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              size="sm"
              type="button"
              disabled={!props.isRuntimeReady || props.isRunning}
              onClick={() => {
                void props.onToggleRuntimeMode()
              }}
              title={
                props.selectedRuntimeMode === "full-access"
                  ? "Full access - click to require approvals"
                  : "Approval required - click for full access"
              }
            >
              {props.selectedRuntimeMode === "full-access" ? <LockOpenIcon /> : <LockIcon />}
              <span>
                {props.selectedRuntimeMode === "full-access" ? "Full access" : "Supervised"}
              </span>
            </Button>
          </div>

          {props.activeContextWindow ? (
            <div className="shrink-0">
              <ContextWindowMeter usage={props.activeContextWindow} />
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden bg-background">
      <ProviderStatusBanner status={props.providerSnapshot} />
      <ThreadErrorBanner error={threadError} onDismiss={props.onDismissThreadError} />

      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col",
          dockComposerOnHover && "overflow-hidden",
        )}
        onMouseEnter={
          dockComposerOnHover
            ? () => {
                setComposerDockHover(true)
              }
            : undefined
        }
        onMouseLeave={
          dockComposerOnHover
            ? () => {
                setComposerDockHover(false)
              }
            : undefined
        }
      >
        {!props.projectPath ? (
          <div className="px-3 py-3 sm:px-5 sm:py-4">
            <div className="rounded-3xl border border-dashed border-border/80 bg-secondary/20 p-6 text-sm text-muted-foreground">
              This agent tile needs a local project path before it can start a thread.
            </div>
          </div>
        ) : (
          <div
            ref={props.timelineRef}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-5 sm:py-4"
          >
            <MessagesTimeline
              key={props.thread?.id ?? "cozea-chat-surface-empty"}
              hasMessages={timelineEntries.length > 0}
              isWorking={isWorking}
              activeTurnInProgress={isWorking || !latestTurnSettled}
              activeTurnStartedAt={activeTurnStartedAt}
              scrollContainer={props.timelineRef.current}
              timelineEntries={timelineEntries}
              completionDividerBeforeEntryId={completionDividerBeforeEntryId}
              completionSummary={completionSummary}
              turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
              nowIso={nowIso}
              expandedWorkGroups={expandedWorkGroups}
              onToggleWorkGroup={toggleWorkGroup}
              onOpenTurnDiff={props.onOpenTurnDiff}
              revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
              onRevertUserMessage={handleRevertUserMessage}
              isRevertingCheckpoint={Boolean(props.isRevertingCheckpoint)}
              onImageExpand={handleExpandImage}
              markdownCwd={markdownCwd}
              resolvedTheme={resolvedTheme}
              workspaceRoot={workspaceRoot}
            />
          </div>
        )}
        {dockComposerOnHover ? (
          <div
            className={cn(
              "pointer-events-none absolute bottom-0 left-0 right-3 z-10 px-3 pb-4 sm:right-4 sm:px-5 sm:pb-5",
            )}
          >
            <div
              className={cn(
                "relative mx-auto w-full max-w-2xl",
              )}
            >
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-[-0.75rem] bottom-[-1rem] top-[-4.5rem] bg-gradient-to-t from-background via-background/86 via-55% to-transparent transition-opacity duration-300 sm:inset-x-[-1rem] sm:bottom-[-1.25rem] sm:top-[-5rem]",
                  showComposerDockChrome ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
              <div
                className={cn(
                  "relative z-[1] w-full space-y-2 overflow-hidden transition-all duration-200 ease-out",
                  showComposerDockChrome
                    ? "max-h-[min(28rem,85vh)] translate-y-0 opacity-100 pointer-events-auto"
                    : "max-h-0 translate-y-1 opacity-0 pointer-events-none",
                )}
                onFocusCapture={() => {
                  setComposerDockFocused(true)
                }}
                onBlurCapture={handleComposerDockBlurCapture}
              >
                {composerForm}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {!dockComposerOnHover ? (
        <div className="px-3 pt-1.5 pb-4 sm:px-5 sm:pt-2 sm:pb-5">{composerForm}</div>
      ) : null}

      {expandedImage && expandedImageItem ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="Expanded image preview"
        >
          <button
            type="button"
            className="absolute inset-0 z-0 cursor-zoom-out"
            aria-label="Close image preview"
            onClick={closeExpandedImage}
          />
          {expandedImage.images.length > 1 ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute left-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:left-6"
              aria-label="Previous image"
              onClick={() => {
                navigateExpandedImage(-1)
              }}
            >
              <ChevronLeftIcon className="size-5" />
            </Button>
          ) : null}
          <div className="relative isolate z-10 max-h-[92vh] max-w-[92vw]">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute right-2 top-2"
              onClick={closeExpandedImage}
              aria-label="Close image preview"
            >
              <XIcon className="size-4" />
            </Button>
            <img
              src={expandedImageItem.src}
              alt={expandedImageItem.name}
              className="max-h-[86vh] max-w-[92vw] select-none rounded-lg border border-border/70 bg-background object-contain shadow-2xl"
              draggable={false}
            />
            <p className="mt-2 max-w-[92vw] truncate text-center text-xs text-muted-foreground/80">
              {expandedImageItem.name}
              {expandedImage.images.length > 1
                ? ` (${expandedImage.index + 1}/${expandedImage.images.length})`
                : ""}
            </p>
          </div>
          {expandedImage.images.length > 1 ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute right-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:right-6"
              aria-label="Next image"
              onClick={() => {
                navigateExpandedImage(1)
              }}
            >
              <ChevronRightIcon className="size-5" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

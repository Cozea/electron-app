import {

  ApprovalRequestId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type MessageId,
  type ModelSelection,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderKind,
  type RuntimeMode,
  type ServerProvider,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
  type TurnId,
} from "@cozea/assistant-contracts"
import {
  type ClipboardEventHandler,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
import { buildExpandedImagePreview } from "@/features/projects/components/assistant/chat/ExpandedImagePreview"
import { MessagesTimeline } from "@/features/projects/components/assistant/chat/MessagesTimeline"
import { ProviderModelPicker } from "@/features/projects/components/assistant/chat/ProviderModelPicker"
import { ProviderStatusBanner } from "@/features/projects/components/assistant/chat/ProviderStatusBanner"
import type { PendingApproval, PendingUserInput } from "@/features/projects/components/assistant/chat/pendingRequests"
import { useAssistantThreadViewModel } from "@/features/projects/components/assistant/chat/useAssistantThreadViewModel"
import { ComposerPromptEditor } from "@/features/projects/components/assistant/chat/ComposerPromptEditor"
import { detectComposerTrigger, replaceTextRange } from "@/features/projects/components/assistant/composer-logic"
import { basenameOfPath, getVscodeIconUrlForEntry } from "@/features/projects/components/assistant/vscode-icons"
import type { ContextWindowSnapshot } from "@/features/projects/components/assistant/lib/contextWindow"
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  findFirstUnansweredPendingUserInputQuestionIndex,
  type PendingUserInputDraftAnswer,
} from "@/features/projects/components/assistant/pendingUserInput"
import { type Thread } from "@/stores/types"
import { ensureNativeApi } from "@/lib/nativeApi"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from '@hugeicons/react'
import { BubbleChatIcon as __ChatIconHugeIcon, Cancel01Icon as __XIconHugeIcon, ChevronDoubleCloseIcon as __ChevronLeftIconHugeIcon, ChevronDoubleCloseIcon as __ChevronRightIconHugeIcon, CircleUnlock02Icon as __LockOpenIconHugeIcon, LeftToRightListBulletIcon as __ListTodoIconHugeIcon, LockIcon as __LockIconHugeIcon } from '@hugeicons/core-free-icons'

export type UserInputAnswerDrafts = Record<string, Record<string, string>>

export interface ProviderModelOptionsByProvider {
  codex: ReadonlyArray<{ slug: string; name: string }>
  claudeAgent: ReadonlyArray<{ slug: string; name: string }>
  cursor: ReadonlyArray<{ slug: string; name: string }>
  opencode: ReadonlyArray<{ slug: string; name: string }>
}

export interface ComposerImageDraft {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  previewUrl: string
  file?: File
}

type ComposerPathMenuItem = {
  id: string
  type: "path"
  path: string
  kind: "file" | "directory"
  description: string
}

type ComposerSlashMenuItem =
  | {
      id: string
      type: "slash-command"
      command: "model" | "plan" | "default"
      label: string
      description: string
    }
  | {
      id: string
      type: "provider-slash-command"
      command: ServerProviderSlashCommand
      label: string
      description: string
    }
  | {
      id: string
      type: "model"
      provider: ProviderKind
      model: string
      label: string
      description: string
    }

type ComposerSkillMenuItem = {
  id: string
  type: "skill"
  skill: ServerProviderSkill
  label: string
  description: string
}

type ComposerMenuItem = ComposerPathMenuItem | ComposerSlashMenuItem | ComposerSkillMenuItem

const DOCKED_COMPOSER_SCROLL_GAP_PX = 16
const DOCKED_COMPOSER_FALLBACK_SCROLL_INSET_PX = 128

function includesNormalized(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase())
}

function filterSlashItems<T extends { label: string; description: string }>(
  items: ReadonlyArray<T>,
  query: string,
): T[] {
  const normalizedQuery = query.trim().replace(/^\/+/, "").toLowerCase()
  if (!normalizedQuery) return [...items]
  return items.filter(
    (item) =>
      includesNormalized(item.label, normalizedQuery) ||
      includesNormalized(item.description, normalizedQuery),
  )
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
  composerImages: ReadonlyArray<ComposerImageDraft>
  isSending: boolean
  isInterrupting: boolean
  isForceStopAvailable?: boolean
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
  onAttachFiles: (files: File[]) => void
  onRemoveComposerImage: (imageId: string) => void
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

function SkillGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  )
}

export const CozeaChatSurface = memo(function CozeaChatSurface(props: CozeaChatSurfaceProps) {
  const resolvedTheme = resolveTimelineTheme()
  const [expandedWorkGroups, setExpandedWorkGroups] = useState<Record<string, boolean>>({})
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null)
  const [pendingQuestionIndexByRequestId, setPendingQuestionIndexByRequestId] = useState<
    Record<string, number>
  >({})
  const [composerDockHover, setComposerDockHover] = useState(false)
  const [composerDockFocused, setComposerDockFocused] = useState(false)
  const [isDragOverComposer, setIsDragOverComposer] = useState(false)
  const [composerPathMenuItems, setComposerPathMenuItems] = useState<ComposerPathMenuItem[]>([])
  const [isComposerMenuLoading, setIsComposerMenuLoading] = useState(false)
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null)
  const dragDepthRef = useRef(0)
  const composerFileInputRef = useRef<HTMLInputElement | null>(null)
  const composerQueryCacheRef = useRef<Map<string, ComposerPathMenuItem[]>>(new Map())
  const dockedComposerFrameRef = useRef<HTMLDivElement | null>(null)
  const [dockedComposerMeasuredInsetPx, setDockedComposerMeasuredInsetPx] = useState(0)

  const {
    latestTurnSettled,
    phase,
    isWorking,
    activeTurnStartedAt,
    timelineEntries,
    completionDividerBeforeEntryId,
    completionSummary,
    turnDiffSummaryByAssistantMessageId,
    revertTurnCountByUserMessageId,
    activeProposedPlan,
    showPlanFollowUpPrompt,
  } = useAssistantThreadViewModel({
    thread: props.thread,
    isRunning: props.isRunning,
    isSending: props.isSending,
    isInterrupting: props.isInterrupting,
    isRevertingCheckpoint: props.isRevertingCheckpoint,
    pendingUserInputs: props.pendingUserInputs,
    selectedInteractionMode: props.selectedInteractionMode,
  })
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
  const composerTrigger = useMemo(
    () => detectComposerTrigger(composerValue, props.composerCursor),
    [composerValue, props.composerCursor],
  )
  const composerPathTrigger = composerTrigger?.kind === "path" ? composerTrigger : null
  const composerSlashTrigger = composerTrigger?.kind === "slash-command" ? composerTrigger : null
  const composerModelTrigger = composerTrigger?.kind === "slash-model" ? composerTrigger : null
  const composerSkillTrigger = composerTrigger?.kind === "skill" ? composerTrigger : null
  const slashMenuItems = useMemo<ComposerSlashMenuItem[]>(() => {
    const builtInItems: ComposerSlashMenuItem[] = [
      {
        id: "slash:model",
        type: "slash-command",
        command: "model",
        label: "/model",
        description: "Switch response model for this thread",
      },
      {
        id: "slash:plan",
        type: "slash-command",
        command: "plan",
        label: "/plan",
        description: "Switch this thread into plan mode",
      },
      {
        id: "slash:default",
        type: "slash-command",
        command: "default",
        label: "/default",
        description: "Switch this thread back to chat mode",
      },
    ]
    const providerItems: ComposerSlashMenuItem[] = (props.providerSnapshot?.slashCommands ?? []).map(
      (command) => ({
        id: `provider-slash-command:${props.selectedProvider}:${command.name}`,
        type: "provider-slash-command",
        command,
        label: `/${command.name}`,
        description: command.description ?? command.input?.hint ?? "Run provider command",
      }),
    )
    return filterSlashItems([...builtInItems, ...providerItems], composerSlashTrigger?.query ?? "")
  }, [composerSlashTrigger?.query, props.providerSnapshot?.slashCommands, props.selectedProvider])
  const modelMenuItems = useMemo<ComposerSlashMenuItem[]>(() => {
    const allItems = (Object.entries(props.modelOptionsByProvider) as Array<
      [ProviderKind, ReadonlyArray<{ slug: string; name: string }>]
    >).flatMap(([provider, models]) =>
      models.map((model) => ({
        id: `model:${provider}:${model.slug}`,
        type: "model" as const,
        provider,
        model: model.slug,
        label: model.name,
        description: `${provider} · ${model.slug}`,
      })),
    )
    return filterSlashItems(allItems, composerModelTrigger?.query ?? "")
  }, [composerModelTrigger?.query, props.modelOptionsByProvider])
  const skillMenuItems = useMemo<ComposerSkillMenuItem[]>(() => {
    const allItems = (props.providerSnapshot?.skills ?? [])
      .filter((skill) => skill.enabled)
      .map((skill) => ({
        id: `skill:${props.selectedProvider}:${skill.name}`,
        type: "skill" as const,
        skill,
        label: skill.displayName ?? skill.name,
        description: skill.shortDescription ?? skill.description ?? skill.scope ?? "Provider skill",
      }))
    return filterSlashItems(allItems, composerSkillTrigger?.query ?? "")
  }, [composerSkillTrigger?.query, props.providerSnapshot?.skills, props.selectedProvider])
  const composerMenuItems = composerPathTrigger
    ? composerPathMenuItems
    : composerSlashTrigger
      ? slashMenuItems
      : composerModelTrigger
        ? modelMenuItems
        : composerSkillTrigger
          ? skillMenuItems
          : []
  const composerMenuOpen = Boolean(
    composerPathTrigger || composerSlashTrigger || composerModelTrigger || composerSkillTrigger,
  )
  const visibleComposerMenuItems = composerMenuItems.slice(0, composerPathTrigger ? 3 : 6)
  const hiddenComposerMenuItemCount = Math.max(0, composerMenuItems.length - visibleComposerMenuItems.length)
  const hasThread = Boolean(props.thread)
  const composerDisabled =
    !props.isRuntimeReady ||
    !hasThread ||
    props.isBinding ||
    isComposerApprovalState ||
    activePendingIsResponding ||
    (!activePendingProgress && props.isSending)
  const stopButtonLabel = props.isForceStopAvailable ? "Force stop agent" : "Stop generation"
  const attachDisabled =
    !props.isRuntimeReady ||
    props.isRunning ||
    isComposerApprovalState ||
    activePendingUserInput !== null
  const imageSizeLimitLabel = `${Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB`
  const markdownCwd = props.thread?.worktreePath ?? props.projectPath ?? undefined
  const workspaceRoot = props.projectPath ?? undefined

  const dockComposerOnHover = Boolean(props.dockComposerOnHover)
  const handleComposerDockBlurCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) {
      return
    }
    setComposerDockFocused(false)
  }, [])
  const dockComposerChromeReasons =
    composerDockHover ||
    composerDockFocused ||
    activePendingApproval !== null ||
    activePendingUserInput !== null ||
    showPlanFollowUpPrompt ||
    isNonEmptyReactNode(props.composerStatus) ||
    props.composer.trim().length > 0 ||
    props.composerImages.length > 0 ||
    props.isRunning ||
    props.isSending ||
    props.isInterrupting

  const showComposerDockChrome = !dockComposerOnHover || dockComposerChromeReasons

  const reserveScrollSpaceForDockedComposer =
    dockComposerOnHover && dockComposerChromeReasons

  useLayoutEffect(() => {
    if (!dockComposerOnHover || !reserveScrollSpaceForDockedComposer) {
      setDockedComposerMeasuredInsetPx(0)
      return
    }

    const frame = dockedComposerFrameRef.current
    if (!frame) {
      return
    }

    const findDockContent = () =>
      frame.querySelector<HTMLElement>("[data-chat-composer-dock-content]")

    let animationFrameId: number | null = null
    const updateInset = () => {
      const dockContent = findDockContent()
      const measuredHeight = dockContent
        ? dockContent.getBoundingClientRect().height
        : frame.getBoundingClientRect().height
      const nextInset = Math.ceil(measuredHeight + DOCKED_COMPOSER_SCROLL_GAP_PX)
      setDockedComposerMeasuredInsetPx((currentInset) => {
        if (Math.abs(currentInset - nextInset) < 1) {
          return currentInset
        }
        return nextInset
      })
    }

    updateInset()
    animationFrameId = window.requestAnimationFrame(updateInset)

    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId)
        }
      }
    }

    const resizeObserver = new ResizeObserver(updateInset)
    const dockContent = findDockContent()
    if (dockContent) {
      resizeObserver.observe(dockContent)
    } else {
      resizeObserver.observe(frame)
    }

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }
      resizeObserver.disconnect()
    }
  }, [dockComposerOnHover, reserveScrollSpaceForDockedComposer])

  const dockedComposerScrollInsetPx = reserveScrollSpaceForDockedComposer
    ? dockedComposerMeasuredInsetPx || DOCKED_COMPOSER_FALLBACK_SCROLL_INSET_PX
    : 0
  const nowIso = new Date().toISOString()

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

  useEffect(() => {
    if (!composerPathTrigger || !props.projectPath) {
      setComposerPathMenuItems([])
      setIsComposerMenuLoading(false)
      return
    }
    const projectPath = props.projectPath

    const normalizedQuery = composerPathTrigger.query.trim()
    const effectiveQuery = normalizedQuery.length > 0 ? normalizedQuery : "."
    const cacheKey = `${projectPath}::${effectiveQuery.toLowerCase()}`
    const cached = composerQueryCacheRef.current.get(cacheKey)
    if (cached) {
      setComposerPathMenuItems(cached)
      setIsComposerMenuLoading(false)
    } else {
      setIsComposerMenuLoading(true)
    }

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const api = ensureNativeApi()
          const result = await api.projects.searchEntries({
            cwd: projectPath,
            query: effectiveQuery,
            limit: 80,
          })
          if (cancelled) return
          const nextItems = result.entries.map((entry) => ({
            id: `${entry.kind}:${entry.path}`,
            type: "path" as const,
            path: entry.path,
            kind: entry.kind,
            description: entry.parentPath ?? "",
          }))
          composerQueryCacheRef.current.set(cacheKey, nextItems)
          setComposerPathMenuItems(nextItems)
          setIsComposerMenuLoading(false)
        } catch {
          if (cancelled) return
          setComposerPathMenuItems([])
          setIsComposerMenuLoading(false)
        }
      })()
    }, 120)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [composerPathTrigger, props.projectPath])

  useEffect(() => {
    if (!composerMenuOpen) {
      setComposerHighlightedItemId(null)
      return
    }
    if (composerMenuItems.length === 0) {
      setComposerHighlightedItemId(null)
      return
    }
    setComposerHighlightedItemId((current) =>
      current && composerMenuItems.some((item) => item.id === current) ? current : composerMenuItems[0]!.id,
    )
  }, [composerMenuItems, composerMenuOpen])

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

  const handleComposerDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragOverComposer(true)
  }

  const handleComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setIsDragOverComposer(true)
  }

  const handleComposerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    // Leaving the composer container should fully clear drag state.
    dragDepthRef.current = 0
    setIsDragOverComposer(false)
  }

  const handleComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragOverComposer(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    props.onAttachFiles(files)
  }

  const applyComposerMentionItem = (item: { path: string }) => {
    if (!composerPathTrigger) return
    const replacement = `@${item.path} `
    const replacementRangeEnd =
      composerValue[composerPathTrigger.rangeEnd] === " "
        ? composerPathTrigger.rangeEnd + 1
        : composerPathTrigger.rangeEnd
    const next = replaceTextRange(
      composerValue,
      composerPathTrigger.rangeStart,
      replacementRangeEnd,
      replacement,
    )
    props.onComposerChange(next.text, next.cursor)
    setComposerHighlightedItemId(null)
  }

  const clearComposerTriggerRange = (rangeStart: number, rangeEnd: number) => {
    const next = replaceTextRange(composerValue, rangeStart, rangeEnd, "")
    props.onComposerChange(next.text, next.cursor)
    setComposerHighlightedItemId(null)
  }

  const applyComposerSlashItem = (item: ComposerSlashMenuItem) => {
    if (item.type === "model") {
      if (!composerModelTrigger) return
      void props.onProviderModelChange(item.provider, item.model)
      clearComposerTriggerRange(composerModelTrigger.rangeStart, composerModelTrigger.rangeEnd)
      return
    }

    if (!composerSlashTrigger) return

    if (item.type === "slash-command") {
      if (item.command === "model") {
        const next = replaceTextRange(
          composerValue,
          composerSlashTrigger.rangeStart,
          composerSlashTrigger.rangeEnd,
          "/model ",
        )
        props.onComposerChange(next.text, next.cursor)
        setComposerHighlightedItemId(null)
        return
      }

      if (item.command === "plan" && props.selectedInteractionMode !== "plan") {
        void props.onToggleInteractionMode()
      }
      if (item.command === "default" && props.selectedInteractionMode === "plan") {
        void props.onToggleInteractionMode()
      }
      clearComposerTriggerRange(composerSlashTrigger.rangeStart, composerSlashTrigger.rangeEnd)
      return
    }

    const replacement = `/${item.command.name} `
    const replacementRangeEnd =
      composerValue[composerSlashTrigger.rangeEnd] === " "
        ? composerSlashTrigger.rangeEnd + 1
        : composerSlashTrigger.rangeEnd
    const next = replaceTextRange(
      composerValue,
      composerSlashTrigger.rangeStart,
      replacementRangeEnd,
      replacement,
    )
    props.onComposerChange(next.text, next.cursor)
    setComposerHighlightedItemId(null)
  }

  const applyComposerMenuItem = (item: ComposerMenuItem) => {
    if (item.type === "path") {
      applyComposerMentionItem(item)
      return
    }
    if (item.type === "skill") {
      if (!composerSkillTrigger) return
      const replacement = `$${item.skill.name} `
      const replacementRangeEnd =
        composerValue[composerSkillTrigger.rangeEnd] === " "
          ? composerSkillTrigger.rangeEnd + 1
          : composerSkillTrigger.rangeEnd
      const next = replaceTextRange(
        composerValue,
        composerSkillTrigger.rangeStart,
        replacementRangeEnd,
        replacement,
      )
      props.onComposerChange(next.text, next.cursor)
      setComposerHighlightedItemId(null)
      return
    }
    applyComposerSlashItem(item)
  }

  const handleComposerCommandKey = (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => {
    if (composerMenuOpen && composerMenuItems.length > 0) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        const currentIndex = composerMenuItems.findIndex((item) => item.id === composerHighlightedItemId)
        const fallbackIndex = key === "ArrowDown" ? -1 : 0
        const normalizedIndex = currentIndex >= 0 ? currentIndex : fallbackIndex
        const offset = key === "ArrowDown" ? 1 : -1
        const nextIndex =
          (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length
        setComposerHighlightedItemId(composerMenuItems[nextIndex]?.id ?? null)
        return true
      }
      if (key === "Enter" || key === "Tab") {
        const selected =
          composerMenuItems.find((item) => item.id === composerHighlightedItemId) ??
          composerMenuItems[0]
        if (selected) {
          applyComposerMenuItem(selected)
          return true
        }
      }
    }
    return props.onComposerCommandKey(key, event)
  }

  useEffect(() => {
    const clearDragState = () => {
      dragDepthRef.current = 0
      setIsDragOverComposer(false)
    }
    window.addEventListener("drop", clearDragState)
    window.addEventListener("dragend", clearDragState)
    return () => {
      window.removeEventListener("drop", clearDragState)
      window.removeEventListener("dragend", clearDragState)
    }
  }, [])

  const handleComposerFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : []
    if (files.length > 0) {
      props.onAttachFiles(files)
    }
    // Allow selecting the same file repeatedly.
    event.currentTarget.value = ""
  }

  const composerForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void props.onSend()
      }}
      className="relative z-30 mx-auto flex h-full max-h-full min-h-0 w-full min-w-0 max-w-3xl flex-col"
    >
      {props.composerStatus ? (
        <div className="shrink-0">{props.composerStatus}</div>
      ) : null}

      <div
        className={cn(
          "mt-3 flex min-h-0 flex-1 flex-col rounded-2xl border border-sidebar-border/50 bg-secondary transition-colors",
          composerMenuOpen ? "overflow-visible" : "overflow-hidden",
          isDragOverComposer && "border-primary/70 bg-accent/30",
        )}
        onDragEnter={handleComposerDragEnter}
        onDragOver={handleComposerDragOver}
        onDragLeave={handleComposerDragLeave}
        onDrop={handleComposerDrop}
      >
        {activePendingApproval ? (
          <div className="border-b border-border/30 bg-background/10">
            <ComposerPendingApprovalPanel
              approval={activePendingApproval}
              pendingCount={props.pendingApprovals.length}
            />
          </div>
        ) : activePendingUserInput ? (
          <div className="min-h-0 flex-1 overflow-hidden border-b border-border/30 bg-background/10">
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

        {composerMenuOpen ? (
          <div className="shrink-0 border-b border-border/30 bg-background/10 py-1 pl-1 pr-8">
            <div className="w-[min(34rem,calc(100%-2rem))]">
              <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">
                  {composerPathTrigger
                    ? "Files & Folders"
                    : composerModelTrigger
                      ? "Models"
                      : composerSkillTrigger
                        ? "Skills"
                        : "Commands"}
              </div>
              {isComposerMenuLoading ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching files...</div>
              ) : composerMenuItems.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {composerPathTrigger
                    ? "No matching files or folders."
                    : composerModelTrigger
                      ? "No matching models."
                      : composerSkillTrigger
                        ? "No matching skills."
                        : "No matching commands."}
                </div>
              ) : (
                <>
                  {visibleComposerMenuItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        "flex w-full cursor-default items-start gap-3 rounded-sm px-2 py-1.5 text-left outline-none",
                        composerHighlightedItemId === item.id
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                      onMouseEnter={() => {
                        setComposerHighlightedItemId(item.id)
                      }}
                      onClick={() => {
                        applyComposerMenuItem(item)
                      }}
                    >
                      {item.type === "path" ? (
                        <img
                          src={getVscodeIconUrlForEntry(item.path, item.kind, resolvedTheme)}
                          alt=""
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0"
                        />
                      ) : item.type === "model" ? (
                        <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded border border-border/70 text-[9px] text-muted-foreground">
                          M
                        </span>
                      ) : item.type === "skill" ? (
                        <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                          <SkillGlyph className="size-3.5" />
                        </span>
                      ) : item.type === "provider-slash-command" ? (
                        <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                          <SkillGlyph className="size-3.5" />
                        </span>
                      ) : (
                        <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                          <HugeiconsIcon icon={__ChatIconHugeIcon} className="size-4" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {item.type === "path" ? basenameOfPath(item.path) : item.label}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {item.type === "path" ? (item.description || item.path) : item.description}
                        </span>
                      </span>
                    </button>
                  ))}
                  {hiddenComposerMenuItemCount > 0 ? (
                    <div className="px-2 pt-1 text-[11px] text-muted-foreground/80">
                      Show {hiddenComposerMenuItemCount} more
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}

        {!isComposerApprovalState &&
        !activePendingUserInput &&
        props.composerImages.length > 0 ? (
          <div className="px-3 pt-3">
            <div className="flex flex-wrap gap-2">
              {props.composerImages.map((image) => (
                <div
                  key={image.id}
                  className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
                >
                  <button
                    type="button"
                    className="h-full w-full cursor-zoom-in"
                    aria-label={`Preview ${image.name}`}
                    onClick={() => {
                      const preview = buildExpandedImagePreview(props.composerImages, image.id)
                      if (!preview) return
                      handleExpandImage(preview)
                    }}
                  >
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 h-5 w-5 bg-background/80 p-0 hover:bg-background/90"
                    onClick={() => {
                      props.onRemoveComposerImage(image.id)
                    }}
                    aria-label={`Remove ${image.name}`}
                  >
                    <HugeiconsIcon icon={__XIconHugeIcon} className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "relative shrink-0 px-3 pb-2",
            hasComposerHeader ? "pt-2.5" : "pt-3",
          )}
        >
          <input
            ref={composerFileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleComposerFileInputChange}
            tabIndex={-1}
          />
          <ComposerPromptEditor
            value={composerValue}
            cursor={props.composerCursor}
            skills={props.providerSnapshot?.skills ?? []}
            terminalContexts={[]}
            onRemoveTerminalContext={() => {}}
            onChange={handleComposerChange}
            onCommandKeyDown={handleComposerCommandKey}
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
                        ? "Ask for follow-up changes"
                        : "Ask anything, @tag files/folders, or use / to show available commands"
            }
            className="min-h-6 max-h-[25vh] p-0 text-sm leading-6"
            disabled={composerDisabled}
          />
        </div>

        {activePendingApproval ? (
          <div className="mb-2 shrink-0 flex items-center justify-end gap-2 px-2">
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
            className="mb-2 shrink-0 flex flex-wrap items-center justify-between gap-2 px-2 sm:flex-nowrap"
          >
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-max sm:overflow-visible">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-full border border-transparent px-2 text-xs font-normal leading-none text-muted-foreground transition-colors hover:border-border/60 hover:bg-accent/80 hover:text-foreground sm:text-xs"
                disabled={attachDisabled}
                onClick={() => {
                  composerFileInputRef.current?.click()
                }}
                title={`Attach images (max ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}, ${imageSizeLimitLabel} each)`}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  className="mr-1 shrink-0"
                >
                  <path
                    d="M21.44 11.05l-8.49 8.49a6 6 0 11-8.49-8.49l8.49-8.49a4 4 0 115.66 5.66l-8.5 8.49a2 2 0 11-2.82-2.83l7.78-7.78"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Attach
                {props.composerImages.length > 0 ? (
                  <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[10px] leading-none text-primary">
                    {props.composerImages.length}
                  </span>
                ) : null}
              </Button>
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
                  aria-label={stopButtonLabel}
                  title={stopButtonLabel}
                  disabled={
                    !props.isRuntimeReady ||
                    (props.isInterrupting && !props.isForceStopAvailable)
                  }
                >
                  {props.isInterrupting && !props.isForceStopAvailable ? (
                    <div className="loader" />
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
                    (props.composer.trim().length === 0 && props.composerImages.length === 0) ||
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
        <div className="flex shrink-0 items-center justify-between gap-3 px-1 pt-2">
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
              {props.selectedInteractionMode === "plan" ? <HugeiconsIcon icon={__ListTodoIconHugeIcon} /> : <HugeiconsIcon icon={__ChatIconHugeIcon} />}
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
              {props.selectedRuntimeMode === "full-access" ? <HugeiconsIcon icon={__LockOpenIconHugeIcon} /> : <HugeiconsIcon icon={__LockIconHugeIcon} />}
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

  const hasProviderBanner = props.providerSnapshot && props.providerSnapshot.status !== "ready" && props.providerSnapshot.status !== "disabled";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden bg-background">
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
        ) : hasProviderBanner ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-12 overflow-y-auto px-6 py-8">
            <ProviderStatusBanner status={props.providerSnapshot} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <MessagesTimeline
              key={props.thread?.id ?? "cozea-chat-surface-empty"}
              hasMessages={timelineEntries.length > 0}
              isWorking={isWorking}
              selectedProvider={props.selectedProvider}
              nowIso={nowIso}
              activeTurnInProgress={isWorking || !latestTurnSettled}
              activeTurnStartedAt={activeTurnStartedAt}
              scrollContainerRef={props.timelineRef}
              timelineEntries={timelineEntries}
              completionDividerBeforeEntryId={completionDividerBeforeEntryId}
              completionSummary={completionSummary}
              turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
              expandedWorkGroups={expandedWorkGroups}
              onToggleWorkGroup={toggleWorkGroup}
              onOpenTurnDiff={props.onOpenTurnDiff}
              revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
              onRevertUserMessage={handleRevertUserMessage}
              isRevertingCheckpoint={Boolean(props.isRevertingCheckpoint)}
              onImageExpand={handleExpandImage}
              markdownCwd={markdownCwd}
              dockedComposerScrollInsetPx={dockedComposerScrollInsetPx}
              resolvedTheme={resolvedTheme}
              workspaceRoot={workspaceRoot}
            />
          </div>
        )}
        {dockComposerOnHover ? (
          <div
            ref={dockedComposerFrameRef}
            className={cn(
              "pointer-events-none absolute inset-y-0 left-0 right-0 z-10 flex flex-col justify-end px-3 pb-4 sm:px-5 sm:pb-5",
            )}
          >
            <div
              className={cn(
                "relative mx-auto flex min-h-0 w-full min-w-0 max-w-3xl flex-col justify-end",
              )}
            >
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 bottom-[-1rem] top-[-4.5rem] bg-gradient-to-t from-background via-background/86 via-55% to-transparent transition-opacity duration-300 sm:bottom-[-1.25rem] sm:top-[-5rem]",
                  showComposerDockChrome ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
              <div
                data-chat-composer-dock-content="true"
                className={cn(
                  "relative z-[1] flex w-full min-h-0 flex-col overflow-hidden transition-all duration-200 ease-out",
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
              <HugeiconsIcon icon={__ChevronLeftIconHugeIcon} className="size-5" />
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
              <HugeiconsIcon icon={__XIconHugeIcon} className="size-4" />
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
              <HugeiconsIcon icon={__ChevronRightIconHugeIcon} className="size-5" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

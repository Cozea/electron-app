import {

  ApprovalRequestId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type MessageId,
  type ModelSelection,
  type ProviderOptionDescriptor,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderInstanceId,
  type ProviderKind,
  type RuntimeMode,
  type ServerProvider,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
  type TurnId,
} from "@cozea/assistant-contracts"
import type { TerminalContextDraft } from "@/features/projects/components/assistant/lib/terminalContext"
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
import { ModelPickerContent } from "@/features/projects/components/assistant/chat/ModelPickerContent"
import { ProviderStatusBanner } from "@/features/projects/components/assistant/chat/ProviderStatusBanner"
import { ProviderRemediationAction } from "@/features/projects/components/assistant/chat/ProviderRemediationAction"
import { ThreadRuntimeBanner } from "@/features/projects/components/assistant/chat/ThreadRuntimeBanner"
import type { PendingApproval, PendingUserInput } from "@/features/projects/components/assistant/chat/pendingRequests"
import { useAssistantThreadViewModel } from "@/features/projects/components/assistant/chat/useAssistantThreadViewModel"
import { ComposerPromptEditor } from "@/features/projects/components/assistant/chat/ComposerPromptEditor"
import { detectComposerTrigger, replaceTextRange, collapseExpandedComposerCursor, expandCollapsedComposerCursor } from "@/features/projects/components/assistant/composer-logic"
import { basenameOfPath, getVscodeIconUrlForEntry } from "@/features/projects/components/assistant/vscode-icons"
import type { ContextWindowSnapshot } from "@/features/projects/components/assistant/lib/contextWindow"
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  findFirstUnansweredPendingUserInputQuestionIndex,
  type PendingUserInputDraftAnswer,
} from "@/features/projects/components/assistant/pendingUserInput"
import { type Thread } from "@/stores/types"
import { useElementPointerHover } from "@/hooks/useElementPointerHover"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/lib/i18n"

import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon as __PlusIconHugeIcon,
  AlertCircleIcon as __CircleAlertIconHugeIcon,
  BubbleChatIcon as __ChatIconHugeIcon,
  Cancel01Icon as __XIconHugeIcon,
  ChevronDoubleCloseIcon as __ChevronLeftIconHugeIcon,
  ChevronDoubleCloseIcon as __ChevronRightIconHugeIcon,
  CircleUnlock02Icon as __LockOpenIconHugeIcon,
  ImageAdd01Icon as __ImageAdd01IconHugeIcon,
  LeftToRightListBulletIcon as __ListTodoIconHugeIcon,
  LockIcon as __LockIconHugeIcon,
  Mic01Icon as __Mic01IconHugeIcon,
} from '@hugeicons/core-free-icons'

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
      command: "model" | "plan" | "default" | "clear" | "help"
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
const MODEL_PICKER_PANEL_TRANSITION_MS = 150

function includesNormalized(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase())
}

function parentPathOf(projectPath: string): string {
  const normalizedPath = projectPath.replace(/\\/g, "/")
  const index = normalizedPath.lastIndexOf("/")
  return index > 0 ? normalizedPath.slice(0, index) : ""
}

function buildComposerPathMenuItems(
  files: ReadonlyArray<{ path: string }>,
  query: string,
  limit = 80,
): ComposerPathMenuItem[] {
  const normalizedQuery = query.trim()
  const includeAll = normalizedQuery.length === 0 || normalizedQuery === "."
  const byPath = new Map<string, ComposerPathMenuItem>()

  const addItem = (projectPath: string, kind: ComposerPathMenuItem["kind"]) => {
    const normalizedPath = projectPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
    if (!normalizedPath || byPath.has(`${kind}:${normalizedPath}`)) {
      return
    }

    if (
      !includeAll &&
      !includesNormalized(normalizedPath, normalizedQuery) &&
      !includesNormalized(basenameOfPath(normalizedPath), normalizedQuery)
    ) {
      return
    }

    byPath.set(`${kind}:${normalizedPath}`, {
      id: `${kind}:${normalizedPath}`,
      type: "path",
      path: normalizedPath,
      kind,
      description: parentPathOf(normalizedPath),
    })
  }

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, "/").replace(/^\/+/, "").trim()
    if (!normalizedPath) continue

    const parts = normalizedPath.split("/").filter(Boolean)
    for (let index = 1; index < parts.length; index += 1) {
      addItem(parts.slice(0, index).join("/"), "directory")
    }
    addItem(normalizedPath, "file")
  }

  return Array.from(byPath.values())
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1
      }
      return left.path.localeCompare(right.path)
    })
    .slice(0, limit)
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
  /** When set, gates composer/send/model picker. Defaults to `isRuntimeReady`. */
  isChatReady?: boolean
  runtimeErrorMessage: string | null
  workspaceId: string | null
  /**
   * Absolute filesystem root of the bound workspace. Used only to trim
   * absolute tool/changedFiles paths down to a `projectName/relative/path`
   * label in the timeline. This is the real path, NOT the opaque
   * `workspaceId` catalog id (which only resolves file opens in main).
   */
  workspaceRoot?: string | null
  thread: Thread | null
  artifactUrlsById?: Readonly<Record<string, string>>
  onOpenArtifact?: (artifactId: string) => void
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
  terminalContexts: ReadonlyArray<TerminalContextDraft>
  onRemoveTerminalContext: (contextId: string) => void
  isSending: boolean
  pendingTurnStartStartedAtIso?: string | null
  isInterrupting: boolean
  isForceStopAvailable?: boolean
  isRevertingCheckpoint?: boolean
  selectedProvider: ProviderKind
  selectedModelSelection: ModelSelection
  selectedRuntimeMode: RuntimeMode
  selectedInteractionMode: ProviderInteractionMode
  providers: ReadonlyArray<ServerProvider>
  modelOptionsByProvider: ProviderModelOptionsByProvider
  modelOptionDescriptors: ReadonlyArray<ProviderOptionDescriptor>
  onProviderModelChange: (provider: ProviderKind, model: string, instanceId?: ProviderInstanceId) => void | Promise<void>
  onModelOptionChange: (id: string, value: string | boolean) => void | Promise<void>
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
  onUserInputDraftChange: (requestId: string, questionId: string, value: string, cursor?: number) => void
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
  const { t } = useTranslation()
  const isChatReady = props.isChatReady ?? props.isRuntimeReady
  const resolvedTheme = resolveTimelineTheme()
  const [expandedWorkGroups, setExpandedWorkGroups] = useState<Record<string, boolean>>({})
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null)
  const [pendingQuestionIndexByRequestId, setPendingQuestionIndexByRequestId] = useState<
    Record<string, number>
  >({})
  const [composerDockFocused, setComposerDockFocused] = useState(false)
  const [isDragOverSurface, setIsDragOverSurface] = useState(false)
  const [composerPathMenuItems, setComposerPathMenuItems] = useState<ComposerPathMenuItem[]>([])
  const [isComposerMenuLoading, setIsComposerMenuLoading] = useState(false)
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false)
  const [shouldRenderModelPicker, setShouldRenderModelPicker] = useState(false)
  const [isModelPickerVisible, setIsModelPickerVisible] = useState(false)
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null)
  const dockComposerOnHover = Boolean(props.dockComposerOnHover)
  const composerDockHoverState = useElementPointerHover<HTMLDivElement>({
    enabled: dockComposerOnHover,
  })
  const composerDockHover = composerDockHoverState.isHovered
  const dragDepthRef = useRef(0)
  const composerFileInputRef = useRef<HTMLInputElement | null>(null)
  const composerQueryCacheRef = useRef<Map<string, ComposerPathMenuItem[]>>(new Map())
  const dockedComposerFrameRef = useRef<HTMLDivElement | null>(null)
  const modelPickerAnimationFrameRef = useRef<number | null>(null)
  const modelPickerCloseTimerRef = useRef<number | null>(null)
  const [dockedComposerMeasuredInsetPx, setDockedComposerMeasuredInsetPx] = useState(0)

  const {
    activeTurn,
    latestTurnSettled,
    phase,
    isWorking,
    activeWorkStartedAt,
    isWorkActive,
    generationStatusPhase,
    timelineEntries,
    completionSummary,
    completionSummariesByMessageId,
    turnDiffSummaryByAssistantMessageId,
    revertTurnCountByUserMessageId,
    activeProposedPlan,
    showPlanFollowUpPrompt,
  } = useAssistantThreadViewModel({
    thread: props.thread,
    isRunning: props.isRunning,
    isSending: props.isSending,
    isInterrupting: props.isInterrupting,
    pendingTurnStartStartedAtIso: props.pendingTurnStartStartedAtIso,
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
  const composerExpandedCursor = useMemo(
    () => expandCollapsedComposerCursor(composerValue, props.composerCursor),
    [composerValue, props.composerCursor]
  )
  const composerTrigger = useMemo(
    () => detectComposerTrigger(composerValue, composerExpandedCursor),
    [composerValue, composerExpandedCursor],
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
      {
        id: "slash:clear",
        type: "slash-command",
        command: "clear",
        label: "/clear",
        description: "Clear composer input",
      },
      {
        id: "slash:help",
        type: "slash-command",
        command: "help",
        label: "/help",
        description: "Show available commands and provider skills",
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
  const composerDisabled =
    !isChatReady ||
    props.isBinding ||
    isComposerApprovalState ||
    activePendingIsResponding ||
    (!activePendingProgress && props.isSending)
  const stopButtonLabel = props.isForceStopAvailable ? "Force stop agent" : "Stop generation"
  const attachDisabled =
    !isChatReady ||
    props.isRunning ||
    isComposerApprovalState ||
    activePendingUserInput !== null
  const imageSizeLimitLabel = `${Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB`
  const markdownCwd = props.workspaceId ?? undefined
  const workspaceIdForFileActions = props.workspaceId ?? undefined
  const threadRuntimeBannerState = props.isInterrupting
    ? "interrupting"
    : phase === "error" || phase === "interrupted" || phase === "connecting"
      ? phase
      : null
  const threadRuntimeDetail =
    props.thread?.session?.lastError ?? props.thread?.error ?? props.runtimeErrorMessage ?? null

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

  // No workspace / provider unavailable: the banner replaces the timeline and
  // sending is impossible — hide the composer entirely (hover included).
  const composerSuppressed =
    !props.workspaceId ||
    Boolean(
      props.providerSnapshot &&
        props.providerSnapshot.status !== "ready" &&
        props.providerSnapshot.status !== "disabled",
    )

  // Empty thread: keep the composer visible so new sessions have an obvious input.
  const showComposerDockChrome =
    !composerSuppressed &&
    (!dockComposerOnHover || dockComposerChromeReasons || timelineEntries.length === 0)

  const reserveScrollSpaceForDockedComposer =
    dockComposerOnHover && dockComposerChromeReasons && !composerSuppressed

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
  useEffect(() => {
    if (modelPickerAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(modelPickerAnimationFrameRef.current)
      modelPickerAnimationFrameRef.current = null
    }
    if (modelPickerCloseTimerRef.current !== null) {
      window.clearTimeout(modelPickerCloseTimerRef.current)
      modelPickerCloseTimerRef.current = null
    }

    if (isModelPickerOpen) {
      setShouldRenderModelPicker(true)
      modelPickerAnimationFrameRef.current = window.requestAnimationFrame(() => {
        modelPickerAnimationFrameRef.current = null
        setIsModelPickerVisible(true)
      })
      return
    }

    setIsModelPickerVisible(false)
    modelPickerCloseTimerRef.current = window.setTimeout(() => {
      modelPickerCloseTimerRef.current = null
      setShouldRenderModelPicker(false)
    }, MODEL_PICKER_PANEL_TRANSITION_MS)
  }, [isModelPickerOpen])

  useEffect(() => {
    return () => {
      if (modelPickerAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(modelPickerAnimationFrameRef.current)
      }
      if (modelPickerCloseTimerRef.current !== null) {
        window.clearTimeout(modelPickerCloseTimerRef.current)
      }
    }
  }, [])

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const [surfaceHeightPx, setSurfaceHeightPx] = useState(0)

  useLayoutEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const updateHeight = () => {
      setSurfaceHeightPx(el.getBoundingClientRect().height)
    }
    updateHeight()
    const ro = new ResizeObserver(updateHeight)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const maxModelPickerHeightPx = useMemo(() => {
    if (surfaceHeightPx <= 0) return 260
    // Reserved space for prompt editor (~48px) + footer (~40px) + bottom padding (~20px) + top clearance (~80px) = ~188px
    const available = surfaceHeightPx - 188
    return Math.max(90, Math.min(260, Math.floor(available)))
  }, [surfaceHeightPx])

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
    if (!composerPathTrigger || !props.workspaceId) {
      setComposerPathMenuItems([])
      setIsComposerMenuLoading(false)
      return
    }
    const workspaceId = props.workspaceId

    const normalizedQuery = composerPathTrigger.query.trim()
    const effectiveQuery = normalizedQuery.length > 0 ? normalizedQuery : "."
    const cacheKey = `${workspaceId}::${effectiveQuery.toLowerCase()}`
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
          const result = await window.electronAPI.project.listFiles({ workspaceId })
          if (cancelled) return
          const nextItems =
            result.success && result.files
              ? buildComposerPathMenuItems(result.files, effectiveQuery, 80)
              : []
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
  }, [composerPathTrigger, props.workspaceId])

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
        nextCursor
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

  const handleSurfaceDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragOverSurface(true)
  }

  const handleSurfaceDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setIsDragOverSurface(true)
  }

  const handleSurfaceDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    // Leaving the container should fully clear drag state.
    dragDepthRef.current = 0
    setIsDragOverSurface(false)
  }

  const handleSurfaceDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragOverSurface(false)
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
    const collapsedCursor = collapseExpandedComposerCursor(next.text, next.cursor)
    props.onComposerChange(next.text, collapsedCursor)
    setComposerHighlightedItemId(null)
  }

  const clearComposerTriggerRange = (rangeStart: number, rangeEnd: number) => {
    const next = replaceTextRange(composerValue, rangeStart, rangeEnd, "")
    const collapsedCursor = collapseExpandedComposerCursor(next.text, next.cursor)
    props.onComposerChange(next.text, collapsedCursor)
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
        const collapsedCursor = collapseExpandedComposerCursor(next.text, next.cursor)
        props.onComposerChange(next.text, collapsedCursor)
        setComposerHighlightedItemId(null)
        return
      }

      if (item.command === "clear") {
        props.onComposerChange("", 0)
        setComposerHighlightedItemId(null)
        return
      }

      if (item.command === "help") {
        const next = replaceTextRange(
          composerValue,
          composerSlashTrigger.rangeStart,
          composerSlashTrigger.rangeEnd,
          "What commands and skills are available?",
        )
        const collapsedCursor = collapseExpandedComposerCursor(next.text, next.cursor)
        props.onComposerChange(next.text, collapsedCursor)
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
    const collapsedCursor = collapseExpandedComposerCursor(next.text, next.cursor)
    props.onComposerChange(next.text, collapsedCursor)
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
      setIsDragOverSurface(false)
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

  const handleComposerShellBlurCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) {
      return
    }
    setIsModelPickerOpen(false)
  }, [])
  const composerForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void props.onSend()
      }}
      className="relative z-30 mx-auto flex w-full min-w-0 max-w-3xl flex-col"
    >
      <div
        className={cn(
          "mt-3 flex flex-col rounded-2xl border border-border/60 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-colors dark:border-white/[0.08] dark:bg-surface-raised dark:shadow-[0_2px_12px_rgba(0,0,0,0.35),0_1px_2px_rgba(0,0,0,0.2)]",
          composerMenuOpen ? "overflow-visible" : "overflow-hidden",
        )}
        onBlurCapture={handleComposerShellBlurCapture}
      >
        {props.composerStatus ? (
          <div className="shrink-0">{props.composerStatus}</div>
        ) : null}
        {threadRuntimeBannerState ? (
          <ThreadRuntimeBanner
            state={threadRuntimeBannerState}
            detail={threadRuntimeDetail}
            isForceStopAvailable={props.isForceStopAvailable}
            action={
              <ProviderRemediationAction
                provider={props.selectedProvider}
                message={threadRuntimeDetail}
                authenticationRequired={props.providerSnapshot?.auth.status === "unauthenticated"}
              />
            }
          />
        ) : null}
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

        <div
          className={cn(
            "shrink-0 overflow-hidden border-b bg-background/10 transition-all duration-200 ease-out",
            isModelPickerVisible
              ? "translate-y-0 border-border/30 opacity-100"
              : "pointer-events-none max-h-0 -translate-y-1 border-transparent opacity-0",
          )}
          style={isModelPickerVisible ? { maxHeight: `${maxModelPickerHeightPx}px` } : undefined}
        >
          {shouldRenderModelPicker ? (
            <div className="w-full" style={{ maxHeight: `${maxModelPickerHeightPx}px` }}>
              <ModelPickerContent
                maxAvailableHeightPx={maxModelPickerHeightPx}
                provider={props.selectedProvider}
                activeInstanceId={props.selectedModelSelection.instanceId}
                model={props.selectedModelSelection.model}
                lockedProvider={props.selectedProvider}
                providers={props.providers}
                modelOptionsByProvider={props.modelOptionsByProvider}
                optionDescriptors={props.modelOptionDescriptors}
                onOptionChange={props.onModelOptionChange}
                terminalOpen={false}
                onRequestClose={() => setIsModelPickerOpen(false)}
                onProviderModelChange={(provider, model, instanceId) => {
                  void props.onProviderModelChange(provider, model, instanceId)
                  setIsModelPickerOpen(false)
                }}
              />
            </div>
          ) : null}
        </div>

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
          <div
            className={cn(
              "px-3 py-2",
              composerDisabled && "opacity-70",
            )}
          >
          <ComposerPromptEditor
            value={composerValue}
            cursor={props.composerCursor}
            skills={props.providerSnapshot?.skills ?? []}
            terminalContexts={props.terminalContexts}
            onRemoveTerminalContext={props.onRemoveTerminalContext}
            onChange={handleComposerChange}
            onCommandKeyDown={handleComposerCommandKey}
            onPaste={props.onComposerPaste}
            placeholder={
              isComposerApprovalState
                ? (activePendingApproval?.detail ?? (t as any)("assistant.chat.placeholder.resolveApproval"))
                : activePendingProgress
                  ? (t as any)("assistant.chat.placeholder.customAnswer")
                  : showPlanFollowUpPrompt
                    ? (t as any)("assistant.chat.placeholder.planFeedback")
                    : props.isInterrupting
                      ? props.isForceStopAvailable
                        ? (t as any)("assistant.chat.placeholder.forceStop")
                        : (t as any)("assistant.chat.placeholder.stopping")
                    : props.runtimeErrorMessage
                      ? (t as any)("assistant.chat.placeholder.runtimeUnavailable")
                      : phase === "error"
                        ? (t as any)("assistant.chat.placeholder.error")
                        : phase === "interrupted"
                          ? (t as any)("assistant.chat.placeholder.interrupted")
                          : phase === "stopped"
                            ? (t as any)("assistant.chat.placeholder.stopped")
                      : phase === "disconnected"
                        ? (t as any)("assistant.chat.placeholder.disconnected")
                        : (t as any)("assistant.chat.placeholder.default")
            }
            className="min-h-6 max-h-[25vh] p-0 text-sm leading-6"
            disabled={composerDisabled}
          />
          </div>
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
            className="mb-2.5 shrink-0 flex flex-nowrap items-center justify-between gap-2 px-3 pb-0.5"
          >
            <div className="flex min-w-0 shrink-0 items-center gap-1">
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
                <HugeiconsIcon icon={__PlusIconHugeIcon} className="size-3.5 shrink-0 stroke-[2.25]" strokeWidth={2.25} />
                {props.composerImages.length > 0 ? (
                  <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[10px] leading-none text-primary">
                    {props.composerImages.length}
                  </span>
                ) : null}
              </Button>
              <button
                type="button"
                onClick={() => void props.onToggleRuntimeMode()}
                className={cn(
                  "inline-flex h-7 shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full px-2 text-xs font-normal cursor-pointer transition-colors",
                  props.selectedRuntimeMode === "full-access"
                    ? "text-amber-600 hover:bg-accent/60 dark:text-amber-500"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                title={`Runtime mode: ${props.selectedRuntimeMode === "full-access" ? "Full access (runs tools without approval)" : "Approval required (asks before running tools)"}. Click to toggle.`}
              >
                <HugeiconsIcon
                  icon={
                    props.selectedRuntimeMode === "full-access"
                      ? __CircleAlertIconHugeIcon
                      : __LockIconHugeIcon
                  }
                  className="size-3.5 shrink-0"
                />
                <span className="whitespace-nowrap">
                  {props.selectedRuntimeMode === "full-access"
                    ? "Full"
                    : "Approval"}
                </span>
              </button>
            </div>

            <div data-chat-composer-actions="right" className="flex min-w-0 max-w-[calc(100%-48px)] shrink items-center gap-1.5">
              <ProviderModelPicker
                provider={props.selectedProvider}
                activeInstanceId={props.selectedModelSelection.instanceId}
                model={props.selectedModelSelection.model}
                lockedProvider={props.selectedProvider}
                providers={props.providers}
                modelOptionsByProvider={props.modelOptionsByProvider}
                optionDescriptors={props.modelOptionDescriptors}
                showProviderIcon={false}
                disabled={!isChatReady || props.isRunning}
                triggerClassName="h-7 rounded-full border border-transparent px-2 text-xs font-normal leading-none text-foreground hover:bg-accent sm:text-xs"
                onProviderModelChange={props.onProviderModelChange}
                open={isModelPickerOpen}
                onOpenChange={setIsModelPickerOpen}
              />
              {!activePendingProgress && props.activeContextWindow ? (
                <ContextWindowMeter usage={props.activeContextWindow} hidePercentage className="px-0.5" />
              ) : null}
              <button
                type="button"
                disabled
                className="flex size-7 items-center justify-center rounded-full text-muted-foreground/50 transition-colors cursor-pointer"
                title="Voice input (coming soon)"
                aria-label="Voice input"
              >
                <HugeiconsIcon icon={__Mic01IconHugeIcon} className="size-4" />
              </button>
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
                  className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/25 transition-all duration-150 hover:scale-105 hover:bg-destructive active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                  onClick={() => {
                    void props.onInterrupt()
                  }}
                  aria-label={stopButtonLabel}
                  title={stopButtonLabel}
                  disabled={
                    !isChatReady ||
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
                  className="flex size-8 items-center justify-center rounded-full bg-zinc-800 text-white shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:hover:scale-105 enabled:hover:bg-zinc-900 enabled:active:scale-95 disabled:pointer-events-none disabled:opacity-35 disabled:shadow-none dark:bg-primary dark:text-primary-foreground"
                  disabled={
                    !isChatReady ||
                    (props.composer.trim().length === 0 && props.composerImages.length === 0) ||
                    props.isSending ||
                    props.isBinding
                  }
                  aria-label={
                    !isChatReady
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
    </form>
  )

  const hasProviderBanner =
    props.providerSnapshot &&
    (props.providerSnapshot.versionAdvisory?.status === "behind_latest" ||
      (props.providerSnapshot.status !== "ready" && props.providerSnapshot.status !== "disabled"));

  return (
    <div
      ref={surfaceRef}
      className="flex h-full min-h-0 flex-col overflow-x-hidden bg-content-surface relative"
      onDragEnter={handleSurfaceDragEnter}
      onDragOver={handleSurfaceDragOver}
      onDragLeave={handleSurfaceDragLeave}
      onDrop={handleSurfaceDrop}
    >
      {isDragOverSurface && (
        <div className="absolute top-[1px] bottom-[1px] left-[1px] right-[1px] z-50 flex flex-col items-center justify-center bg-background/40 backdrop-blur-sm text-center rounded-[inherit]">
          <HugeiconsIcon icon={__ImageAdd01IconHugeIcon} className="size-7 text-muted-foreground mb-4" />
          <h3 className="text-base font-medium text-foreground">Drop images to attach</h3>
          <p className="text-sm text-muted-foreground mt-1">Images will be added to your draft</p>
        </div>
      )}
      <div
        ref={dockComposerOnHover ? composerDockHoverState.ref : undefined}
        className={cn(
          "relative flex min-h-0 flex-1 flex-col",
          dockComposerOnHover && "overflow-hidden",
        )}
        onPointerEnter={
          dockComposerOnHover
            ? composerDockHoverState.onPointerEnter
            : undefined
        }
        onPointerLeave={
          dockComposerOnHover
            ? composerDockHoverState.onPointerLeave
            : undefined
        }
        onPointerMove={
          dockComposerOnHover
            ? composerDockHoverState.onPointerMove
            : undefined
        }
      >
        {!props.workspaceId ? (
          <div className="px-3 py-3 sm:px-5 sm:py-4">
            <div className="rounded-3xl border border-dashed border-border/80 bg-secondary/20 p-6 text-sm text-muted-foreground">
              This agent tile needs a local project path before it can start a thread.
            </div>
          </div>
        ) : hasProviderBanner ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-12 overflow-y-auto px-6 py-8 pb-24">
            <ProviderStatusBanner status={props.providerSnapshot} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <MessagesTimeline
              key={props.thread?.id ?? "cozea-chat-surface-empty"}
              hasMessages={timelineEntries.length > 0}
              isWorking={isWorking}
              selectedProvider={props.selectedProvider}
              activeTurnInProgress={isWorking || !latestTurnSettled}
              activeTurnId={activeTurn?.turnId ?? null}
              activeWorkStartedAt={activeWorkStartedAt}
              isWorkActive={isWorkActive}
              generationStatusPhase={generationStatusPhase}
              scrollContainerRef={props.timelineRef}
              timelineEntries={timelineEntries}
              completionSummary={completionSummary}
              completionSummariesByMessageId={completionSummariesByMessageId}
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
              workspaceId={workspaceIdForFileActions}
              workspaceRoot={props.workspaceRoot ?? undefined}
              artifactUrlsById={props.artifactUrlsById}
              onOpenArtifact={props.onOpenArtifact}
            />
          </div>
        )}
        {dockComposerOnHover && !composerSuppressed ? (
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
                data-chat-composer-dock-content="true"
                className={cn(
                  "relative z-[1] flex w-full min-h-0 flex-col transition-all duration-200 ease-out",
                  showComposerDockChrome
                    ? "max-h-full translate-y-0 opacity-100 pointer-events-auto"
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

      {!dockComposerOnHover && !composerSuppressed ? (
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

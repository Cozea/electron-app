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
} from "@cozea/assistant-contracts";
import type { TerminalContextDraft } from "@/features/assistant/lib/terminalContext";
import type { PreviewAnnotationPayload } from "@cozea/contracts/t3/ipc";
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
} from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppOverlayPortal } from "@/components/ui/app-overlay-portal";
import { ComposerPendingApprovalActions } from "@/features/assistant/chat/ComposerPendingApprovalActions";
import { ComposerPendingApprovalPanel } from "@/features/assistant/chat/ComposerPendingApprovalPanel";
import { AsyncQuestionPanel } from "./AsyncQuestionPanel";
import { ComposerPendingUserInputPanel } from "@/features/assistant/chat/ComposerPendingUserInputPanel";
import { ComposerPlanFollowUpBanner } from "@/features/assistant/chat/ComposerPlanFollowUpBanner";
import { ContextWindowMeter } from "@/features/assistant/chat/ContextWindowMeter";
import type {
  ExpandedImageItem,
  ExpandedImagePreview,
} from "@/features/assistant/chat/ExpandedImagePreview";
import { buildExpandedImagePreview } from "@/features/assistant/chat/ExpandedImagePreview";
import { MessagesTimeline } from "@/features/assistant/chat/MessagesTimeline";
import { ChatMediaProvider } from "./ChatMedia";
import { ChatArtifactTemplateProvider } from "./ChatArtifactTemplate";
import { appendTemplateUsePrompt, type CodexArtifactTemplate } from "./chatArtifactTemplates";
import { useCommittedChatCallback } from "./useChatRenderStability";
import {
  questionCursorKey,
  retainQuestionCursors,
  setQuestionCursor,
  type QuestionCursors,
} from "@/features/assistant/chat/questionCursorState";
import { ChatConnectionNotice } from "./ChatConnectionNotice";
import type { SubscriptionStatus } from "@/substrate/subscriptionSupervisor";
import { ProviderModelPicker } from "@/features/assistant/chat/ProviderModelPicker";
import { shouldDismissModelPickerOnPointerDown } from "@/features/assistant/chat/modelPickerDismissal";
import {
  ModelPickerContent,
  type ModelPickerPrimaryView,
} from "@/features/assistant/chat/ModelPickerContent";
import { ProviderStatusBanner } from "@/features/assistant/chat/ProviderStatusBanner";
import { ProviderRemediationAction } from "@/features/assistant/chat/ProviderRemediationAction";
import {
  hasBlockingProviderBanner,
  resolveProviderBannerKind,
} from "@/features/assistant/chat/providerStatusPresentation";
import { ProviderUpdateNotice } from "@/features/assistant/chat/ProviderUpdateNotice";
import { ThreadRuntimeBanner } from "@/features/assistant/chat/ThreadRuntimeBanner";
import type { PendingApproval, PendingUserInput } from "@/features/assistant/chat/session-logic";
import { useAssistantThreadViewModel } from "@/features/assistant/chat/useAssistantThreadViewModel";
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "@/features/assistant/chat/ComposerPromptEditor";
import { ComposerPreviewAnnotationCards } from "@/features/assistant/chat/ComposerPreviewAnnotationCards";
import {
  INITIAL_COMPOSER_EXPANSION_STATE,
  nextComposerExpansionState,
} from "@/features/assistant/chat/composerExpansion";
import {
  detectComposerTrigger,
  replaceTextRange,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
} from "@/features/assistant/composer-logic";
import { basenameOfPath, getVscodeIconUrlForEntry } from "@/features/assistant/vscode-icons";
import type { ContextWindowSnapshot } from "@/features/assistant/lib/contextWindow";
import type { AccountUsageLimitSnapshot } from "@/features/assistant/lib/usageLimits";
import {
  buildPendingUserInputAnswers,
  pendingUserInputDraftFromAnswer,
  togglePendingUserInputOptionSelection,
  resolvePendingUserInputAnswer,
  derivePendingUserInputProgress,
  findFirstUnansweredPendingUserInputQuestionIndex,
  type PendingUserInputDraftAnswer,
} from "@/features/assistant/pendingUserInput";
import { type Thread } from "@/features/assistant/model/types";
import { useElementPointerHover } from "@/hooks/useElementPointerHover";
import { COMPOSER_DOCK_EASING_CSS, COMPOSER_DOCK_TRANSITION_MS } from "./composerDockMotion";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

import { HugeiconsIcon } from "@hugeicons/react";
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
} from "@hugeicons/core-free-icons";

export type UserInputAnswerDrafts = Record<string, Record<string, string | string[]>>;

export type ComposerMode = "debug" | "plan" | "ask" | "default" | null;

function DebugBugIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-3.5 shrink-0", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m8 2 1.88 1.88" />
      <path d="M14.12 3.88 16 2" />
      <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
      <path d="M12 20v-9" />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
      <path d="M6 13H2" />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
      <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
      <path d="M22 13h-4" />
      <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
    </svg>
  );
}

export interface ProviderModelOptionsByProvider {
  antigravity: ReadonlyArray<{ slug: string; name: string }>;
  codex: ReadonlyArray<{ slug: string; name: string }>;
  claudeAgent: ReadonlyArray<{ slug: string; name: string }>;
  cursor: ReadonlyArray<{ slug: string; name: string }>;
  opencode: ReadonlyArray<{ slug: string; name: string }>;
}

export interface ComposerImageDraft {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
  file?: File;
}

type ComposerPathMenuItem = {
  id: string;
  type: "path";
  path: string;
  kind: "file" | "directory";
  description: string;
};

type ComposerSlashMenuItem =
  | {
      id: string;
      type: "slash-command";
      command: "model" | "plan" | "default" | "clear" | "help" | "debug" | "ask";
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "provider-slash-command";
      command: ServerProviderSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "model";
      provider: ProviderKind;
      model: string;
      label: string;
      description: string;
    };

type ComposerSkillMenuItem = {
  id: string;
  type: "skill";
  skill: ServerProviderSkill;
  label: string;
  description: string;
};

type ComposerMenuItem = ComposerPathMenuItem | ComposerSlashMenuItem | ComposerSkillMenuItem;

// Breathing room between the last timeline row and the composer. The composer
// card carries its own top margin, so this only guards against rounding.
const DOCKED_COMPOSER_SCROLL_CLEARANCE_PX = 4;
const DOCKED_COMPOSER_FALLBACK_SCROLL_INSET_PX = 128;
const MODEL_PICKER_PANEL_TRANSITION_MS = 150;

function includesNormalized(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase());
}

function parentPathOf(projectPath: string): string {
  const normalizedPath = projectPath.replace(/\\/g, "/");
  const index = normalizedPath.lastIndexOf("/");
  return index > 0 ? normalizedPath.slice(0, index) : "";
}

function buildComposerPathMenuItems(
  files: ReadonlyArray<{ path: string }>,
  query: string,
  limit = 80,
): ComposerPathMenuItem[] {
  const normalizedQuery = query.trim();
  const includeAll = normalizedQuery.length === 0 || normalizedQuery === ".";
  const byPath = new Map<string, ComposerPathMenuItem>();

  const addItem = (projectPath: string, kind: ComposerPathMenuItem["kind"]) => {
    const normalizedPath = projectPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!normalizedPath || byPath.has(`${kind}:${normalizedPath}`)) {
      return;
    }

    if (
      !includeAll &&
      !includesNormalized(normalizedPath, normalizedQuery) &&
      !includesNormalized(basenameOfPath(normalizedPath), normalizedQuery)
    ) {
      return;
    }

    byPath.set(`${kind}:${normalizedPath}`, {
      id: `${kind}:${normalizedPath}`,
      type: "path",
      path: normalizedPath,
      kind,
      description: parentPathOf(normalizedPath),
    });
  };

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!normalizedPath) continue;

    const parts = normalizedPath.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      addItem(parts.slice(0, index).join("/"), "directory");
    }
    addItem(normalizedPath, "file");
  }

  return Array.from(byPath.values())
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    })
    .slice(0, limit);
}

function filterSlashItems<T extends { label: string; description: string }>(
  items: ReadonlyArray<T>,
  query: string,
): T[] {
  const normalizedQuery = query.trim().replace(/^\/+/, "").toLowerCase();
  if (!normalizedQuery) return [...items];
  return items.filter(
    (item) =>
      includesNormalized(item.label, normalizedQuery) ||
      includesNormalized(item.description, normalizedQuery),
  );
}

interface CozeaChatSurfaceProps {
  isChatVisible?: boolean;
  mediaBaseUrl?: string | null;
  connectionStatus?: SubscriptionStatus | null;
  isRuntimeReady: boolean;
  /** When set, gates composer/send/model picker. Defaults to `isRuntimeReady`. */
  isChatReady?: boolean;
  runtimeErrorMessage: string | null;
  workspaceId: string | null;
  /**
   * Absolute filesystem root of the bound workspace. Used only to trim
   * absolute tool/changedFiles paths down to a `projectName/relative/path`
   * label in the timeline. This is the real path, NOT the opaque
   * `workspaceId` catalog id (which only resolves file opens in main).
   */
  workspaceRoot?: string | null;
  thread: Thread | null;
  artifactUrlsById?: Readonly<Record<string, string>>;
  onOpenArtifact?: (artifactId: string) => void;
  providerSnapshot: ServerProvider | null;
  /**
   * Ends the live provider session so the next turn starts on a freshly
   * installed provider version. Runs automatically once an in-place update
   * lands.
   */
  onRestartAgent?: () => Promise<void>;
  isRunning: boolean;
  isBinding: boolean;
  isConfigLoading: boolean;
  bindingError: string | null;
  timelineRef: RefObject<HTMLDivElement | null>;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  activeRequestKey: string | null;
  userInputDrafts: UserInputAnswerDrafts;
  activeContextWindow: ContextWindowSnapshot | null;
  activeAccountUsage: AccountUsageLimitSnapshot | null;
  composerStatus: ReactNode;
  composer: string;
  composerCursor: number;
  composerImages: ReadonlyArray<ComposerImageDraft>;
  previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  onRemoveTerminalContext: (contextId: string) => void;
  isSending: boolean;
  pendingTurnStartStartedAtIso?: string | null;
  isInterrupting: boolean;
  isForceStopAvailable?: boolean;
  isRevertingCheckpoint?: boolean;
  selectedProvider: ProviderKind;
  selectedModelSelection: ModelSelection;
  selectedRuntimeMode: RuntimeMode;
  selectedInteractionMode: ProviderInteractionMode;
  providers: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: ProviderModelOptionsByProvider;
  modelOptionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  onProviderModelChange: (
    provider: ProviderKind,
    model: string,
    instanceId?: ProviderInstanceId,
  ) => void | Promise<void>;
  onModelOptionChange: (id: string, value: string | boolean) => void | Promise<void>;
  onToggleInteractionMode: () => void | Promise<void>;
  onToggleRuntimeMode: () => void | Promise<void>;
  onComposerChange: (nextValue: string, nextCursor: number) => void;
  onComposerCommandKey: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => boolean;
  onComposerPaste: ClipboardEventHandler<HTMLElement>;
  onAttachFiles: (files: File[]) => void;
  onRemoveComposerImage: (imageId: string) => void;
  onRemovePreviewAnnotation: (annotationId: string) => void;
  compactUnavailableReason?: string | null;
  onCompact?: () => void | Promise<void>;
  onSend: (overridePrompt?: string) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  onApprovalDecision: (
    requestId: string,
    decision: ProviderApprovalDecision,
  ) => void | Promise<void>;
  onUserInputDraftChange: (
    requestId: string,
    questionId: string,
    value: string | string[],
    cursor?: number,
  ) => void;
  onSubmitUserInput: (requestId: string) => void | Promise<void>;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void | Promise<void>;
  onDismissThreadError?: () => void;
  onRevertToTurnCount?: (turnCount: number) => void | Promise<void>;
  /** Workbench tiles: bottom composer floats and expands on card hover or focus (like the browser omnibar). */
  dockComposerOnHover?: boolean;
}

function isNonEmptyReactNode(node: ReactNode): boolean {
  if (node == null || node === false) {
    return false;
  }
  return true;
}

function resolveTimelineTheme(): "light" | "dark" {
  if (typeof document !== "undefined") {
    const classes = document.documentElement.classList;
    if (
      classes.contains("dark") ||
      classes.contains("navy") ||
      classes.contains("wine") ||
      classes.contains("clay") ||
      classes.contains("forest")
    ) {
      return "dark";
    }
  }
  return "light";
}

function planTitleFromMarkdown(markdown: string): string | null {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const heading = lines.find((line) => line.startsWith("#"));
  if (!heading) {
    return null;
  }

  const normalized = heading.replace(/^#+\s*/, "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toPendingUserInputDraftAnswers(
  request: PendingUserInput | null,
  drafts: Record<string, string | string[]> | undefined,
): Record<string, PendingUserInputDraftAnswer> {
  if (!request) {
    return {};
  }

  const next: Record<string, PendingUserInputDraftAnswer> = {};
  for (const question of request.questions) {
    const value = drafts?.[question.id];
    next[question.id] = pendingUserInputDraftFromAnswer(question, value);
  }
  return next;
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
    );
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
  );
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
  );
}

const NO_REVERT_TURNS: ReadonlyMap<MessageId, number> = new Map();

export const CozeaChatSurface = memo(function CozeaChatSurface(props: CozeaChatSurfaceProps) {
  const { t } = useTranslation();
  const isChatReady = props.isChatReady ?? props.isRuntimeReady;
  const resolvedTheme = resolveTimelineTheme();
  const [expandedWorkGroups, setExpandedWorkGroups] = useState<Record<string, boolean>>({});
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode>(null);
  const activeMode: "debug" | "plan" | "ask" | null =
    composerMode === "default"
      ? null
      : (composerMode ?? (props.selectedInteractionMode === "plan" ? "plan" : null));

  const updateComposerMode = useCallback(
    (nextMode: "debug" | "plan" | "ask" | null) => {
      if (nextMode === null) {
        setComposerMode("default");
        if (props.selectedInteractionMode === "plan") {
          void props.onToggleInteractionMode();
        }
      } else if (nextMode === "plan") {
        setComposerMode("plan");
        if (props.selectedInteractionMode !== "plan") {
          void props.onToggleInteractionMode();
        }
      } else {
        setComposerMode(nextMode);
        if (props.selectedInteractionMode === "plan") {
          void props.onToggleInteractionMode();
        }
      }
    },
    [props.selectedInteractionMode, props.onToggleInteractionMode],
  );
  const [pendingQuestionIndexByRequestId, setPendingQuestionIndexByRequestId] = useState<
    Record<string, number>
  >({});
  const [composerDockFocused, setComposerDockFocused] = useState(false);
  const [isDragOverSurface, setIsDragOverSurface] = useState(false);
  const [composerPathMenuItems, setComposerPathMenuItems] = useState<ComposerPathMenuItem[]>([]);
  const [isComposerMenuLoading, setIsComposerMenuLoading] = useState(false);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [modelPickerView, setModelPickerView] = useState<ModelPickerPrimaryView>("models");
  const [shouldRenderModelPicker, setShouldRenderModelPicker] = useState(false);
  const [isModelPickerVisible, setIsModelPickerVisible] = useState(false);
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
  const dockComposerOnHover = Boolean(props.dockComposerOnHover);
  const composerDockHoverState = useElementPointerHover<HTMLDivElement>({
    enabled: dockComposerOnHover,
  });
  const composerDockHover = composerDockHoverState.isHovered;
  const previewAnnotationImageIds = useMemo(
    () => new Set(props.previewAnnotations.map((annotation) => annotation.id)),
    [props.previewAnnotations],
  );
  const regularComposerImages = useMemo(
    () => props.composerImages.filter((image) => !previewAnnotationImageIds.has(image.id)),
    [previewAnnotationImageIds, props.composerImages],
  );
  const dragDepthRef = useRef(0);
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const composerEditorRef = useRef<ComposerPromptEditorHandle | null>(null);
  const templateFocusFrameRef = useRef<number | null>(null);
  const composerQueryCacheRef = useRef<Map<string, ComposerPathMenuItem[]>>(new Map());
  const dockedComposerFrameRef = useRef<HTMLDivElement | null>(null);
  const modelPickerPanelRef = useRef<HTMLDivElement | null>(null);
  const modelPickerTriggerRef = useRef<HTMLDivElement | null>(null);
  const modelPickerAnimationFrameRef = useRef<number | null>(null);
  const modelPickerCloseTimerRef = useRef<number | null>(null);
  const [dockedComposerMeasuredInsetPx, setDockedComposerMeasuredInsetPx] = useState(0);

  const handleModelPickerOpenChange = useCallback((open: boolean, view: ModelPickerPrimaryView) => {
    if (open) {
      setModelPickerView(view);
    }
    setIsModelPickerOpen(open);
  }, []);

  const {
    activeTurn,
    latestTurnSettled,
    phase,
    isWorking,
    activeWorkStartedAt,
    isWorkActive,
    generationStatusPhase,
    timelineEntries,
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
  });
  const activePendingApproval = props.pendingApprovals[0] ?? null;
  const blockingUserInputs = useMemo(
    () => props.pendingUserInputs.filter((request) => request.responseMode !== "message"),
    [props.pendingUserInputs],
  );
  const asyncUserInputs = useMemo(
    () => props.pendingUserInputs.filter((request) => request.responseMode === "message"),
    [props.pendingUserInputs],
  );
  const activePendingUserInput = blockingUserInputs[0] ?? null;
  const activePendingDraftAnswers = useMemo(
    () =>
      toPendingUserInputDraftAnswers(
        activePendingUserInput,
        activePendingUserInput
          ? props.userInputDrafts[String(activePendingUserInput.requestId)]
          : undefined,
      ),
    [activePendingUserInput, props.userInputDrafts],
  );
  const defaultPendingQuestionIndex = activePendingUserInput
    ? findFirstUnansweredPendingUserInputQuestionIndex(
        activePendingUserInput.questions,
        activePendingDraftAnswers,
      )
    : 0;
  const activePendingQuestionIndex = activePendingUserInput
    ? Math.max(
        0,
        Math.min(
          pendingQuestionIndexByRequestId[String(activePendingUserInput.requestId)] ??
            defaultPendingQuestionIndex,
          Math.max(activePendingUserInput.questions.length - 1, 0),
        ),
      )
    : 0;
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
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const activePendingIsResponding = activePendingUserInput
    ? props.activeRequestKey === String(activePendingUserInput.requestId)
    : false;
  const isComposerApprovalState = activePendingApproval !== null;
  const hasComposerHeader =
    isComposerApprovalState || activePendingUserInput !== null || showPlanFollowUpPrompt;
  const composerValue = activePendingProgress?.customAnswer ?? props.composer;
  const [questionCursors, setQuestionCursors] = useState<QuestionCursors>({});
  const activeQuestionCursorKey =
    activePendingUserInput && activePendingProgress?.activeQuestion
      ? questionCursorKey(
          props.thread?.id,
          String(activePendingUserInput.requestId),
          activePendingProgress.activeQuestion.id,
        )
      : null;
  const composerCursor = activeQuestionCursorKey
    ? (questionCursors[activeQuestionCursorKey] ??
      collapseExpandedComposerCursor(composerValue, composerValue.length))
    : props.composerCursor;
  const [composerExpansionState, setComposerExpansionState] = useState(
    INITIAL_COMPOSER_EXPANSION_STATE,
  );

  const composerExpandedCursor = useMemo(
    () => expandCollapsedComposerCursor(composerValue, composerCursor),
    [composerValue, composerCursor],
  );
  const composerTrigger = useMemo(
    () => detectComposerTrigger(composerValue, composerExpandedCursor),
    [composerValue, composerExpandedCursor],
  );
  const composerPathTrigger = composerTrigger?.kind === "path" ? composerTrigger : null;
  const composerSlashTrigger = composerTrigger?.kind === "slash-command" ? composerTrigger : null;
  const composerModelTrigger = composerTrigger?.kind === "slash-model" ? composerTrigger : null;
  const composerSkillTrigger = composerTrigger?.kind === "skill" ? composerTrigger : null;
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
        id: "slash:debug",
        type: "slash-command",
        command: "debug",
        label: "/debug",
        description: "Debug and troubleshoot issues",
      },
      {
        id: "slash:plan",
        type: "slash-command",
        command: "plan",
        label: "/plan",
        description: "Switch this thread into plan mode",
      },
      {
        id: "slash:ask",
        type: "slash-command",
        command: "ask",
        label: "/ask",
        description: "Ask questions without modifying files",
      },
      {
        id: "slash:default",
        type: "slash-command",
        command: "default",
        label: "/default",
        description: "Switch this thread back to normal mode",
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
    ];
    const providerItems: ComposerSlashMenuItem[] = (
      props.providerSnapshot?.slashCommands ?? []
    ).map((command) => ({
      id: `provider-slash-command:${props.selectedProvider}:${command.name}`,
      type: "provider-slash-command",
      command,
      label: `/${command.name}`,
      description: command.description ?? command.input?.hint ?? "Run provider command",
    }));
    return filterSlashItems(
      [
        ...builtInItems.filter(
          (item) =>
            item.type !== "slash-command" ||
            item.command !== "plan" ||
            (props.selectedProvider !== "antigravity" &&
              props.providerSnapshot?.showInteractionModeToggle !== false),
        ),
        ...providerItems,
      ],
      composerSlashTrigger?.query ?? "",
    );
  }, [composerSlashTrigger?.query, props.providerSnapshot?.slashCommands, props.selectedProvider]);
  const modelMenuItems = useMemo<ComposerSlashMenuItem[]>(() => {
    const allItems = (
      Object.entries(props.modelOptionsByProvider) as Array<
        [ProviderKind, ReadonlyArray<{ slug: string; name: string }>]
      >
    ).flatMap(([provider, models]) =>
      models.map((model) => ({
        id: `model:${provider}:${model.slug}`,
        type: "model" as const,
        provider,
        model: model.slug,
        label: model.name,
        description: `${provider} · ${model.slug}`,
      })),
    );
    return filterSlashItems(allItems, composerModelTrigger?.query ?? "");
  }, [composerModelTrigger?.query, props.modelOptionsByProvider]);
  const skillMenuItems = useMemo<ComposerSkillMenuItem[]>(() => {
    const allItems = (props.providerSnapshot?.skills ?? [])
      .filter((skill) => skill.enabled)
      .map((skill) => ({
        id: `skill:${props.selectedProvider}:${skill.name}`,
        type: "skill" as const,
        skill,
        label: skill.displayName ?? skill.name,
        description: skill.shortDescription ?? skill.description ?? skill.scope ?? "Provider skill",
      }));
    return filterSlashItems(allItems, composerSkillTrigger?.query ?? "");
  }, [composerSkillTrigger?.query, props.providerSnapshot?.skills, props.selectedProvider]);
  const composerMenuItems = composerPathTrigger
    ? composerPathMenuItems
    : composerSlashTrigger
      ? slashMenuItems
      : composerModelTrigger
        ? modelMenuItems
        : composerSkillTrigger
          ? skillMenuItems
          : [];
  const composerMenuOpen = Boolean(
    composerPathTrigger || composerSlashTrigger || composerModelTrigger || composerSkillTrigger,
  );
  const visibleComposerMenuItems = composerMenuItems.slice(0, composerPathTrigger ? 3 : 6);
  const hiddenComposerMenuItemCount = Math.max(
    0,
    composerMenuItems.length - visibleComposerMenuItems.length,
  );
  const composerDisabled =
    !isChatReady ||
    props.isBinding ||
    isComposerApprovalState ||
    activePendingIsResponding ||
    activePendingProgress?.activeQuestion?.allowCustomAnswer === false ||
    (!activePendingProgress && props.isSending);
  const canUseArtifactTemplate = !composerDisabled && activePendingUserInput === null;
  const handleUseArtifactTemplate = useCommittedChatCallback((template: CodexArtifactTemplate) => {
    if (!canUseArtifactTemplate) return;
    // Ordinary drafts and request answers are deliberately separate state.
    const draft = appendTemplateUsePrompt(props.composer, template);
    props.onComposerChange(draft, collapseExpandedComposerCursor(draft, draft.length));
    if (templateFocusFrameRef.current !== null) cancelAnimationFrame(templateFocusFrameRef.current);
    templateFocusFrameRef.current = requestAnimationFrame(() => {
      templateFocusFrameRef.current = null;
      composerEditorRef.current?.focusAtEnd();
    });
  });
  useLayoutEffect(
    () => () => {
      if (templateFocusFrameRef.current !== null) {
        cancelAnimationFrame(templateFocusFrameRef.current);
        templateFocusFrameRef.current = null;
      }
    },
    [props.thread?.id, canUseArtifactTemplate, props.isChatVisible],
  );
  const stopButtonLabel = props.isForceStopAvailable ? "Force stop agent" : "Stop generation";
  const attachDisabled =
    !isChatReady || props.isRunning || isComposerApprovalState || activePendingUserInput !== null;
  const imageSizeLimitLabel = `${Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB`;
  const markdownCwd = props.workspaceId ?? undefined;
  const workspaceIdForFileActions = props.workspaceId ?? undefined;
  const threadRuntimeBannerState = props.isInterrupting
    ? "interrupting"
    : phase === "error" || phase === "interrupted" || phase === "connecting"
      ? phase
      : null;
  const threadRuntimeDetail =
    props.thread?.session?.lastError ?? props.thread?.error ?? props.runtimeErrorMessage ?? null;

  const handleComposerDockBlurCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) {
      return;
    }
    setComposerDockFocused(false);
  }, []);
  const dockComposerChromeReasons =
    composerDockHover ||
    composerDockFocused ||
    activePendingApproval !== null ||
    activePendingUserInput !== null ||
    showPlanFollowUpPrompt ||
    threadRuntimeBannerState !== null ||
    isNonEmptyReactNode(props.composerStatus) ||
    props.composer.trim().length > 0 ||
    props.composerImages.length > 0 ||
    props.previewAnnotations.length > 0 ||
    props.isRunning ||
    props.isSending ||
    props.isInterrupting;

  const providerBannerKind = resolveProviderBannerKind(props.providerSnapshot);
  const hasProviderBanner = hasBlockingProviderBanner(props.providerSnapshot);

  // The provider banner replaces the timeline and sending is impossible, so
  // the composer must follow the same derived condition (hover included).
  const composerSuppressed = !props.workspaceId || hasProviderBanner;

  // Empty thread: keep the composer visible so new sessions have an obvious input.
  const showComposerDockChrome =
    !composerSuppressed &&
    (!dockComposerOnHover || dockComposerChromeReasons || timelineEntries.length === 0);

  const reserveScrollSpaceForDockedComposer =
    dockComposerOnHover && dockComposerChromeReasons && !composerSuppressed;

  useLayoutEffect(() => {
    if (!dockComposerOnHover) {
      setDockedComposerMeasuredInsetPx(0);
      return;
    }

    const frame = dockedComposerFrameRef.current;
    if (!frame) return;

    const findDockContent = () =>
      frame.querySelector<HTMLElement>("[data-chat-composer-dock-content]");

    const updateInset = () => {
      const dockContent = findDockContent();
      if (!dockContent) return;
      // Nothing constrains the dock's height any more, so this reads the real
      // laid-out composer. Never derive a height cap from this value and apply it
      // back to `dockContent`: that closes a loop through a `min-h-0` flex column
      // and ratchets the composer's interior shut.
      const contentElement = dockContent.firstElementChild;
      const contentElementHeight =
        contentElement instanceof HTMLElement
          ? Math.max(contentElement.scrollHeight, contentElement.getBoundingClientRect().height)
          : 0;
      const intrinsicContentHeight = Math.max(dockContent.scrollHeight, contentElementHeight);
      const frameBottomPadding =
        Number.parseFloat(window.getComputedStyle(frame).paddingBottom) || 0;
      const nextInset = Math.ceil(
        intrinsicContentHeight + frameBottomPadding + DOCKED_COMPOSER_SCROLL_CLEARANCE_PX,
      );
      setDockedComposerMeasuredInsetPx((currentInset) =>
        Math.abs(currentInset - nextInset) < 1 ? currentInset : nextInset,
      );
    };

    updateInset();
    if (typeof ResizeObserver === "undefined") return;

    // Safe to observe the dock itself now that the reveal animates transform and
    // opacity rather than height: it no longer resizes during the transition.
    const resizeObserver = new ResizeObserver(updateInset);
    resizeObserver.observe(frame);
    const dockContent = findDockContent();
    if (dockContent) {
      resizeObserver.observe(dockContent);
      if (dockContent.firstElementChild instanceof HTMLElement) {
        resizeObserver.observe(dockContent.firstElementChild);
      }
    }

    return () => resizeObserver.disconnect();
  }, [dockComposerOnHover, reserveScrollSpaceForDockedComposer]);

  const dockedComposerScrollInsetPx = reserveScrollSpaceForDockedComposer
    ? dockedComposerMeasuredInsetPx || DOCKED_COMPOSER_FALLBACK_SCROLL_INSET_PX
    : 0;
  useEffect(() => {
    if (modelPickerAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(modelPickerAnimationFrameRef.current);
      modelPickerAnimationFrameRef.current = null;
    }
    if (modelPickerCloseTimerRef.current !== null) {
      window.clearTimeout(modelPickerCloseTimerRef.current);
      modelPickerCloseTimerRef.current = null;
    }

    if (isModelPickerOpen) {
      setShouldRenderModelPicker(true);
      modelPickerAnimationFrameRef.current = window.requestAnimationFrame(() => {
        modelPickerAnimationFrameRef.current = null;
        setIsModelPickerVisible(true);
      });
      return;
    }

    setIsModelPickerVisible(false);
    modelPickerCloseTimerRef.current = window.setTimeout(() => {
      modelPickerCloseTimerRef.current = null;
      setShouldRenderModelPicker(false);
    }, MODEL_PICKER_PANEL_TRANSITION_MS);
  }, [isModelPickerOpen]);

  useEffect(() => {
    if (!isModelPickerOpen) return;

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (
        shouldDismissModelPickerOnPointerDown({
          eventPath: event.composedPath(),
          panel: modelPickerPanelRef.current,
          trigger: modelPickerTriggerRef.current,
        })
      ) {
        setIsModelPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [isModelPickerOpen]);

  useEffect(() => {
    return () => {
      if (modelPickerAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(modelPickerAnimationFrameRef.current);
      }
      if (modelPickerCloseTimerRef.current !== null) {
        window.clearTimeout(modelPickerCloseTimerRef.current);
      }
    };
  }, []);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [surfaceHeightPx, setSurfaceHeightPx] = useState(0);

  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const updateHeight = () => {
      setSurfaceHeightPx(el.getBoundingClientRect().height);
    };
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxModelPickerHeightPx = useMemo(() => {
    if (surfaceHeightPx <= 0) return 360;
    const available = surfaceHeightPx - 80;
    return Math.max(240, Math.min(420, Math.floor(available)));
  }, [surfaceHeightPx]);

  useEffect(() => {
    if (!activePendingUserInput) {
      return;
    }

    const requestId = String(activePendingUserInput.requestId);
    setPendingQuestionIndexByRequestId((current) => {
      if (requestId in current) {
        return current;
      }
      return {
        ...current,
        [requestId]: defaultPendingQuestionIndex,
      };
    });
  }, [activePendingUserInput, defaultPendingQuestionIndex]);

  useEffect(() => {
    const activeRequestIds = new Set(
      props.pendingUserInputs.map((request) => String(request.requestId)),
    );
    setPendingQuestionIndexByRequestId((current) => {
      const nextEntries = Object.entries(current).filter(([requestId]) =>
        activeRequestIds.has(requestId),
      );
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [props.pendingUserInputs]);

  useEffect(() => {
    const activeKeys = new Set(
      props.pendingUserInputs.flatMap((request) =>
        request.questions.map((question) =>
          questionCursorKey(props.thread?.id, String(request.requestId), question.id),
        ),
      ),
    );
    setQuestionCursors((current) => retainQuestionCursors(current, activeKeys));
  }, [props.pendingUserInputs, props.thread?.id]);

  useEffect(() => {
    if (!composerPathTrigger || !props.workspaceId) {
      setComposerPathMenuItems([]);
      setIsComposerMenuLoading(false);
      return;
    }
    const workspaceId = props.workspaceId;

    const normalizedQuery = composerPathTrigger.query.trim();
    const effectiveQuery = normalizedQuery.length > 0 ? normalizedQuery : ".";
    const cacheKey = `${workspaceId}::${effectiveQuery.toLowerCase()}`;
    const cached = composerQueryCacheRef.current.get(cacheKey);
    if (cached) {
      setComposerPathMenuItems(cached);
      setIsComposerMenuLoading(false);
    } else {
      setIsComposerMenuLoading(true);
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await window.electronAPI.project.listFiles({ workspaceId });
          if (cancelled) return;
          const nextItems =
            result.success && result.files
              ? buildComposerPathMenuItems(result.files, effectiveQuery, 80)
              : [];
          composerQueryCacheRef.current.set(cacheKey, nextItems);
          setComposerPathMenuItems(nextItems);
          setIsComposerMenuLoading(false);
        } catch {
          if (cancelled) return;
          setComposerPathMenuItems([]);
          setIsComposerMenuLoading(false);
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [composerPathTrigger, props.workspaceId]);

  useEffect(() => {
    if (!composerMenuOpen) {
      setComposerHighlightedItemId(null);
      return;
    }
    if (composerMenuItems.length === 0) {
      setComposerHighlightedItemId(null);
      return;
    }
    setComposerHighlightedItemId((current) =>
      current && composerMenuItems.some((item) => item.id === current)
        ? current
        : composerMenuItems[0]!.id,
    );
  }, [composerMenuItems, composerMenuOpen]);

  const toggleWorkGroup = useCallback((groupId: string) => {
    setExpandedWorkGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  }, []);

  const handleExpandImage = useCallback((preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  }, []);

  const closeExpandedImage = () => {
    setExpandedImage(null);
  };

  const navigateExpandedImage = (offset: number) => {
    setExpandedImage((current) => {
      if (!current || current.images.length <= 1) {
        return current;
      }
      const nextIndex = (current.index + offset + current.images.length) % current.images.length;
      return {
        ...current,
        index: nextIndex,
      };
    });
  };

  const handleComposerChange = (nextValue: string, nextCursor: number) => {
    if (activePendingProgress?.activeQuestion && activePendingUserInput) {
      if (activeQuestionCursorKey) {
        setQuestionCursors((current) =>
          setQuestionCursor(current, activeQuestionCursorKey, nextCursor),
        );
      }
      props.onUserInputDraftChange(
        String(activePendingUserInput.requestId),
        activePendingProgress.activeQuestion.id,
        nextValue,
      );
      return;
    }

    props.onComposerChange(nextValue, nextCursor);
  };

  const setActivePendingQuestionIndex = (requestId: string, nextIndex: number) => {
    setPendingQuestionIndexByRequestId((current) => ({
      ...current,
      [requestId]: nextIndex,
    }));
  };

  const handleAdvancePendingQuestion = () => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    setActivePendingQuestionIndex(
      String(activePendingUserInput.requestId),
      Math.min(
        activePendingProgress.questionIndex + 1,
        activePendingUserInput.questions.length - 1,
      ),
    );
  };

  const handlePreviousPendingQuestion = () => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    setActivePendingQuestionIndex(
      String(activePendingUserInput.requestId),
      Math.max(activePendingProgress.questionIndex - 1, 0),
    );
  };

  const handleSelectPendingUserInputOption = (questionId: string, optionLabel: string) => {
    if (!activePendingUserInput) {
      return;
    }
    const question = activePendingUserInput.questions.find((entry) => entry.id === questionId);
    if (!question) return;
    const next = togglePendingUserInputOptionSelection(
      question,
      activePendingDraftAnswers[questionId],
      optionLabel,
    );
    const value = resolvePendingUserInputAnswer(question, next) ?? (question.multiSelect ? [] : "");
    props.onUserInputDraftChange(String(activePendingUserInput.requestId), questionId, value);
  };

  const handleSubmitPendingUserInput = () => {
    if (!activePendingUserInput) {
      return;
    }
    void props.onSubmitUserInput(String(activePendingUserInput.requestId));
  };

  const handleRevertUserMessage = useCommittedChatCallback((messageId: MessageId) => {
    const turnCount = revertTurnCountByUserMessageId.get(messageId);
    if (typeof turnCount !== "number") {
      return;
    }
    void props.onRevertToTurnCount?.(turnCount);
  });
  const handleOpenTurnDiff = useCommittedChatCallback(props.onOpenTurnDiff);
  const handleOpenArtifact = useCommittedChatCallback((artifactId: string) =>
    props.onOpenArtifact?.(artifactId),
  );

  const expandedImageItem: ExpandedImageItem | null = expandedImage
    ? (expandedImage.images[expandedImage.index] ?? null)
    : null;

  const handleSurfaceDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOverSurface(true);
  };

  const handleSurfaceDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragOverSurface(true);
  };

  const handleSurfaceDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    // Leaving the container should fully clear drag state.
    dragDepthRef.current = 0;
    setIsDragOverSurface(false);
  };

  const handleSurfaceDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOverSurface(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    props.onAttachFiles(files);
  };

  const applyComposerMentionItem = (item: { path: string }) => {
    if (!composerPathTrigger) return;
    const replacement = `@${item.path} `;
    const replacementRangeEnd =
      composerValue[composerPathTrigger.rangeEnd] === " "
        ? composerPathTrigger.rangeEnd + 1
        : composerPathTrigger.rangeEnd;
    const next = replaceTextRange(
      composerValue,
      composerPathTrigger.rangeStart,
      replacementRangeEnd,
      replacement,
    );
    const collapsedCursor = collapseExpandedComposerCursor(next.text, next.cursor);
    props.onComposerChange(next.text, collapsedCursor);
    setComposerHighlightedItemId(null);
  };

  const clearComposerTriggerRange = (rangeStart: number, rangeEnd: number) => {
    const next = replaceTextRange(composerValue, rangeStart, rangeEnd, "");
    const collapsedCursor = collapseExpandedComposerCursor(next.text, next.cursor);
    props.onComposerChange(next.text, collapsedCursor);
    setComposerHighlightedItemId(null);
  };

  const applyComposerSlashItem = (item: ComposerSlashMenuItem) => {
    if (item.type === "model") {
      if (!composerModelTrigger) return;
      void props.onProviderModelChange(item.provider, item.model);
      clearComposerTriggerRange(composerModelTrigger.rangeStart, composerModelTrigger.rangeEnd);
      return;
    }

    if (!composerSlashTrigger) return;

    if (item.type === "slash-command") {
      if (item.command === "model") {
        const next = replaceTextRange(
          composerValue,
          composerSlashTrigger.rangeStart,
          composerSlashTrigger.rangeEnd,
          "/model ",
        );
        const collapsedCursor = collapseExpandedComposerCursor(next.text, next.cursor);
        props.onComposerChange(next.text, collapsedCursor);
        setComposerHighlightedItemId(null);
        return;
      }

      if (item.command === "clear") {
        props.onComposerChange("", 0);
        setComposerHighlightedItemId(null);
        return;
      }

      if (item.command === "help") {
        const next = replaceTextRange(
          composerValue,
          composerSlashTrigger.rangeStart,
          composerSlashTrigger.rangeEnd,
          "What commands and skills are available?",
        );
        const collapsedCursor = collapseExpandedComposerCursor(next.text, next.cursor);
        props.onComposerChange(next.text, collapsedCursor);
        setComposerHighlightedItemId(null);
        return;
      }

      if (item.command === "debug") {
        updateComposerMode("debug");
        clearComposerTriggerRange(composerSlashTrigger.rangeStart, composerSlashTrigger.rangeEnd);
        return;
      }
      if (item.command === "ask") {
        updateComposerMode("ask");
        clearComposerTriggerRange(composerSlashTrigger.rangeStart, composerSlashTrigger.rangeEnd);
        return;
      }
      if (item.command === "plan") {
        updateComposerMode("plan");
        clearComposerTriggerRange(composerSlashTrigger.rangeStart, composerSlashTrigger.rangeEnd);
        return;
      }
      if (item.command === "default") {
        updateComposerMode(null);
        clearComposerTriggerRange(composerSlashTrigger.rangeStart, composerSlashTrigger.rangeEnd);
        return;
      }
      clearComposerTriggerRange(composerSlashTrigger.rangeStart, composerSlashTrigger.rangeEnd);
      return;
    }

    if (item.command.name === "compact" && props.onCompact) {
      void props.onCompact();
      setComposerHighlightedItemId(null);
      return;
    }

    const replacement = `/${item.command.name} `;
    const replacementRangeEnd =
      composerValue[composerSlashTrigger.rangeEnd] === " "
        ? composerSlashTrigger.rangeEnd + 1
        : composerSlashTrigger.rangeEnd;
    const next = replaceTextRange(
      composerValue,
      composerSlashTrigger.rangeStart,
      replacementRangeEnd,
      replacement,
    );
    const collapsedCursor = collapseExpandedComposerCursor(next.text, next.cursor);
    props.onComposerChange(next.text, collapsedCursor);
    setComposerHighlightedItemId(null);
  };

  const applyComposerMenuItem = (item: ComposerMenuItem) => {
    if (item.type === "path") {
      applyComposerMentionItem(item);
      return;
    }
    if (item.type === "skill") {
      if (!composerSkillTrigger) return;
      const replacement = `$${item.skill.name} `;
      const replacementRangeEnd =
        composerValue[composerSkillTrigger.rangeEnd] === " "
          ? composerSkillTrigger.rangeEnd + 1
          : composerSkillTrigger.rangeEnd;
      const next = replaceTextRange(
        composerValue,
        composerSkillTrigger.rangeStart,
        replacementRangeEnd,
        replacement,
      );
      props.onComposerChange(next.text, next.cursor);
      setComposerHighlightedItemId(null);
      return;
    }
    applyComposerSlashItem(item);
  };

  const handleSendWithMode = useCallback(async () => {
    const trimmed = composerValue.trim();
    if (activeMode === "debug") {
      const promptToSend =
        trimmed &&
        !trimmed.toLowerCase().startsWith("[debug") &&
        !trimmed.toLowerCase().startsWith("/debug")
          ? `[Debug Mode: Troubleshoot and diagnose this issue]\n${trimmed}`
          : trimmed;
      await props.onSend(promptToSend);
      return;
    }
    if (activeMode === "ask") {
      const promptToSend =
        trimmed &&
        !trimmed.toLowerCase().startsWith("[ask") &&
        !trimmed.toLowerCase().startsWith("/ask")
          ? `[Ask Mode: Answer questions and explain without making file changes]\n${trimmed}`
          : trimmed;
      await props.onSend(promptToSend);
      return;
    }
    await props.onSend();
  }, [activeMode, composerValue, props]);

  const handleComposerCommandKey = (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => {
    if (composerMenuOpen && composerMenuItems.length > 0) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        const currentIndex = composerMenuItems.findIndex(
          (item) => item.id === composerHighlightedItemId,
        );
        const fallbackIndex = key === "ArrowDown" ? -1 : 0;
        const normalizedIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
        const offset = key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
        setComposerHighlightedItemId(composerMenuItems[nextIndex]?.id ?? null);
        return true;
      }
      if (key === "Enter" || key === "Tab") {
        const selected =
          composerMenuItems.find((item) => item.id === composerHighlightedItemId) ??
          composerMenuItems[0];
        if (selected) {
          applyComposerMenuItem(selected);
          return true;
        }
      }
    }
    if (key === "Enter" && !event.shiftKey) {
      if (activePendingProgress) {
        // Match the visible Next/Submit controls; Enter must not skip an
        // unanswered question or resubmit a request awaiting acknowledgement.
        event.preventDefault();
        event.stopPropagation();
        if (activePendingIsResponding) return true;
        if (activePendingProgress.isLastQuestion) {
          if (activePendingResolvedAnswers) handleSubmitPendingUserInput();
        } else if (activePendingProgress.canAdvance) {
          handleAdvancePendingQuestion();
        }
        return true;
      }
      event.preventDefault();
      event.stopPropagation();
      void handleSendWithMode();
      return true;
    }
    return props.onComposerCommandKey(key, event);
  };

  useEffect(() => {
    const clearDragState = () => {
      dragDepthRef.current = 0;
      setIsDragOverSurface(false);
    };
    window.addEventListener("drop", clearDragState);
    window.addEventListener("dragend", clearDragState);
    return () => {
      window.removeEventListener("drop", clearDragState);
      window.removeEventListener("dragend", clearDragState);
    };
  }, []);

  const handleComposerFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    if (files.length > 0) {
      props.onAttachFiles(files);
    }
    // Allow selecting the same file repeatedly.
    event.currentTarget.value = "";
  };

  const hasActiveComposerHeader = Boolean(
    hasComposerHeader || (showPlanFollowUpPrompt && activeProposedPlan),
  );

  const hasAttachments = Boolean(
    props.previewAnnotations.length > 0 || regularComposerImages.length > 0,
  );

  const hasStructuralComposerContent = Boolean(
    hasAttachments || hasActiveComposerHeader || props.composerStatus,
  );
  const hasExplicitLineBreak = composerValue.includes("\n");
  const isStackedComposer = Boolean(
    hasStructuralComposerContent || hasExplicitLineBreak || composerExpansionState.isMultiLine,
  );
  const handleMeasuredComposerLinesChange = useCallback(
    (measuredLines: number, promptLength: number) => {
      setComposerExpansionState((current) =>
        nextComposerExpansionState(current, measuredLines, promptLength),
      );
    },
    [],
  );

  const resolvedPlaceholder = useMemo(() => {
    if (isComposerApprovalState) {
      return (
        activePendingApproval?.detail ?? (t as any)("assistant.chat.placeholder.resolveApproval")
      );
    }
    if (activePendingProgress) {
      return (t as any)("assistant.chat.placeholder.customAnswer");
    }
    if (showPlanFollowUpPrompt) {
      return (t as any)("assistant.chat.placeholder.planFeedback");
    }
    if (props.isInterrupting) {
      return props.isForceStopAvailable
        ? (t as any)("assistant.chat.placeholder.forceStop")
        : (t as any)("assistant.chat.placeholder.stopping");
    }
    if (props.runtimeErrorMessage) {
      return (t as any)("assistant.chat.placeholder.runtimeUnavailable");
    }
    if (phase === "error") return (t as any)("assistant.chat.placeholder.error");
    if (phase === "interrupted") return (t as any)("assistant.chat.placeholder.interrupted");
    if (phase === "stopped") return (t as any)("assistant.chat.placeholder.stopped");
    if (phase === "disconnected") return (t as any)("assistant.chat.placeholder.disconnected");
    if (activeMode === "debug") {
      return "Debug and troubleshoot issues...";
    }
    if (activeMode === "plan") {
      return "Create an implementation plan...";
    }
    if (activeMode === "ask") {
      return "Ask anything about this project...";
    }
    return (t as any)("assistant.chat.placeholder.default");
  }, [
    isComposerApprovalState,
    activePendingApproval?.detail,
    activePendingProgress,
    showPlanFollowUpPrompt,
    props.isInterrupting,
    props.isForceStopAvailable,
    props.runtimeErrorMessage,
    phase,
    activeMode,
    t,
  ]);

  const renderModeChip = () => {
    if (activeMode === "debug") {
      return (
        <div className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-rose-500/12 text-rose-600 dark:bg-[#3a1820]/90 dark:text-rose-400 px-2.5 py-0.5 text-xs font-medium select-none transition-all">
          <DebugBugIcon className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
          <span>Debug</span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              updateComposerMode(null);
            }}
            className="ml-1 -mr-0.5 inline-flex size-4 items-center justify-center rounded-full text-rose-600/70 hover:bg-rose-500/20 hover:text-rose-700 dark:text-rose-400/80 dark:hover:bg-rose-500/25 dark:hover:text-rose-200 transition-colors cursor-pointer"
            aria-label="Remove debug mode"
            title="Remove debug mode"
          >
            <HugeiconsIcon icon={__XIconHugeIcon} className="size-2.5" />
          </button>
        </div>
      );
    }
    if (activeMode === "plan") {
      return (
        <div className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 px-2.5 py-0.5 text-xs font-medium select-none transition-all">
          <HugeiconsIcon
            icon={__ListTodoIconHugeIcon}
            className="size-3.5 shrink-0 text-amber-700 dark:text-amber-400"
          />
          <span>Plan</span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              updateComposerMode(null);
            }}
            className="ml-1 -mr-0.5 inline-flex size-4 items-center justify-center rounded-full text-amber-700/70 hover:bg-amber-500/25 hover:text-amber-800 dark:text-amber-400/80 dark:hover:bg-amber-500/25 dark:hover:text-amber-200 transition-colors cursor-pointer"
            aria-label="Remove plan mode"
            title="Remove plan mode"
          >
            <HugeiconsIcon icon={__XIconHugeIcon} className="size-2.5" />
          </button>
        </div>
      );
    }
    if (activeMode === "ask") {
      return (
        <div className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400 px-2.5 py-0.5 text-xs font-medium select-none transition-all">
          <HugeiconsIcon
            icon={__ChatIconHugeIcon}
            className="size-3.5 shrink-0 text-sky-700 dark:text-sky-400"
          />
          <span>Ask</span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              updateComposerMode(null);
            }}
            className="ml-1 -mr-0.5 inline-flex size-4 items-center justify-center rounded-full text-sky-700/70 hover:bg-sky-500/25 hover:text-sky-800 dark:text-sky-400/80 dark:hover:bg-sky-500/25 dark:hover:text-sky-200 transition-colors cursor-pointer"
            aria-label="Remove ask mode"
            title="Remove ask mode"
          >
            <HugeiconsIcon icon={__XIconHugeIcon} className="size-2.5" />
          </button>
        </div>
      );
    }
    return null;
  };

  const renderPlusDropdown = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="size-8 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/80 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-white/10 transition-colors cursor-pointer outline-none"
          title="Add context or change mode"
          aria-label="Add context or change mode"
        >
          <HugeiconsIcon icon={__PlusIconHugeIcon} className="size-4 stroke-[2]" />
          {props.composerImages.length > 0 ? (
            <span className="ml-0.5 text-[10px] font-bold text-primary">
              {props.composerImages.length}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56 p-1">
        <DropdownMenuItem
          disabled={attachDisabled}
          onClick={() => composerFileInputRef.current?.click()}
          title={`Attach images (max ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}, ${imageSizeLimitLabel} each)`}
        >
          <HugeiconsIcon
            icon={__ImageAdd01IconHugeIcon}
            className="size-4 mr-2 text-muted-foreground"
          />
          Attach Images
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => updateComposerMode(activeMode === "debug" ? null : "debug")}
          className={cn(activeMode === "debug" && "bg-rose-500/10 text-rose-400")}
        >
          <DebugBugIcon className="size-4 mr-2 text-rose-400" />
          <span className="flex-1">Debug Mode</span>
          {activeMode === "debug" && <span className="text-xs text-rose-400">✓</span>}
        </DropdownMenuItem>
        {props.selectedProvider !== "antigravity" &&
        props.providerSnapshot?.showInteractionModeToggle !== false ? (
          <DropdownMenuItem
            onClick={() => updateComposerMode(activeMode === "plan" ? null : "plan")}
            className={cn(activeMode === "plan" && "bg-amber-500/10 text-amber-400")}
          >
            <HugeiconsIcon icon={__ListTodoIconHugeIcon} className="size-4 mr-2 text-amber-400" />
            <span className="flex-1">Plan Mode</span>
            {activeMode === "plan" && <span className="text-xs text-amber-400">✓</span>}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={() => updateComposerMode(activeMode === "ask" ? null : "ask")}
          className={cn(activeMode === "ask" && "bg-sky-500/10 text-sky-400")}
        >
          <HugeiconsIcon icon={__ChatIconHugeIcon} className="size-4 mr-2 text-sky-400" />
          <span className="flex-1">Ask Mode</span>
          {activeMode === "ask" && <span className="text-xs text-sky-400">✓</span>}
        </DropdownMenuItem>
        {activeMode !== null && (
          <DropdownMenuItem onClick={() => updateComposerMode(null)}>
            <HugeiconsIcon icon={__XIconHugeIcon} className="size-4 mr-2 text-muted-foreground" />
            Clear Mode
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {props.onCompact &&
        props.providerSnapshot?.slashCommands?.some((command) => command.name === "compact") ? (
          <DropdownMenuItem
            disabled={Boolean(props.compactUnavailableReason)}
            title={
              props.compactUnavailableReason ??
              "Summarize provider context; keep chat history and your draft"
            }
            onClick={() => void props.onCompact?.()}
          >
            Compact context
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => void props.onToggleRuntimeMode()}>
          <HugeiconsIcon
            icon={
              props.selectedRuntimeMode === "full-access"
                ? __CircleAlertIconHugeIcon
                : __LockIconHugeIcon
            }
            className="size-4 mr-2"
          />
          <span>
            Runtime:{" "}
            {props.selectedRuntimeMode === "full-access" ? "Full access" : "Approval required"}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const latestUserMessage = props.thread?.messages.findLast((message) => message.role === "user");
  const latestCompaction = props.thread?.activities.findLast(
    (activity) => activity.kind === "context-compaction",
  );
  const compactionStatus =
    latestUserMessage?.text.trim().toLowerCase() === "/compact"
      ? props.isRunning
        ? "Compacting context…"
        : latestCompaction && latestCompaction.createdAt >= latestUserMessage.createdAt
          ? latestCompaction.summary
          : null
      : null;

  const renderSendOrStopButton = () => {
    if (activePendingProgress) {
      return (
        <div className="flex items-center gap-1.5">
          {activePendingProgress.questionIndex > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-full text-xs px-2.5"
              type="button"
              onClick={handlePreviousPendingQuestion}
              disabled={activePendingIsResponding}
            >
              Prev
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => {
              if (activePendingProgress.isLastQuestion) {
                handleSubmitPendingUserInput();
                return;
              }
              handleAdvancePendingQuestion();
            }}
            disabled={
              activePendingIsResponding ||
              (activePendingProgress.isLastQuestion
                ? !activePendingResolvedAnswers
                : !activePendingProgress.canAdvance)
            }
          >
            {activePendingIsResponding
              ? "..."
              : activePendingProgress.isLastQuestion
                ? "Submit"
                : "Next"}
          </Button>
        </div>
      );
    }

    const hasContextRing = Boolean(props.activeContextWindow);
    const buttonSizeClass = hasContextRing ? "size-6.5" : "size-8";

    const isSendDisabled =
      !isChatReady ||
      (props.composer.trim().length === 0 &&
        props.composerImages.length === 0 &&
        props.previewAnnotations.length === 0) ||
      props.isSending ||
      props.isBinding;

    const buttonElement = props.isRunning ? (
      <button
        type="button"
        className={cn(
          "flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 shadow-xs transition-all duration-150 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50",
          buttonSizeClass,
        )}
        onClick={() => {
          void props.onInterrupt();
        }}
        aria-label={stopButtonLabel}
        title={stopButtonLabel}
        disabled={!isChatReady || (props.isInterrupting && !props.isForceStopAvailable)}
      >
        {props.isInterrupting && !props.isForceStopAvailable ? (
          <div className="loader" />
        ) : (
          <span className="size-2 rounded-[1px] bg-primary-foreground" />
        )}
      </button>
    ) : (
      <button
        type="submit"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full transition-all duration-150",
          buttonSizeClass,
          isSendDisabled
            ? "bg-foreground/[0.08] text-foreground/30 dark:bg-white/10 dark:text-zinc-500/50 cursor-not-allowed"
            : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs hover:scale-105 active:scale-95 cursor-pointer",
        )}
        disabled={isSendDisabled}
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
    );

    if (hasContextRing && props.activeContextWindow) {
      // Always on hover, including while the agent is running: the ring is
      // where usage is shown, so hiding the numbers behind "nothing to send"
      // made them unreachable exactly when they are asked for.
      return (
        <ContextWindowMeter
          usage={props.activeContextWindow}
          accountUsage={props.activeAccountUsage}
        >
          {buttonElement}
        </ContextWindowMeter>
      );
    }

    return buttonElement;
  };

  const composerModeChip = renderModeChip();

  const composerForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSendWithMode();
      }}
      className="relative z-30 mx-auto flex w-full min-w-0 max-w-3xl min-h-0 flex-col"
    >
      {/* Autocomplete Menu (floating above) */}
      {composerMenuOpen ? (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[min(34rem,100%)] max-h-72 overflow-y-auto rounded-xl border border-border/60 bg-[var(--assistant-composer-surface)] shadow-2xl p-1.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 dark:border-white/[0.08] motion-reduce:animate-none">
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
                    setComposerHighlightedItemId(item.id);
                  }}
                  onClick={() => {
                    applyComposerMenuItem(item);
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
                      {item.type === "path" ? item.description || item.path : item.description}
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
      ) : null}

      {/* Floating Model Picker */}
      {shouldRenderModelPicker ? (
        <div
          ref={modelPickerPanelRef}
          className={cn(
            "absolute bottom-[calc(100%+8px)] right-0 z-50 w-64 max-w-[95vw] overflow-hidden rounded-[18px] border border-border/60 bg-[var(--assistant-composer-surface)] shadow-2xl transition-[opacity,transform] duration-150 ease-out dark:border-white/[0.08] motion-reduce:transition-none",
            isModelPickerVisible
              ? "translate-y-0 scale-100 opacity-100"
              : "pointer-events-none translate-y-1 scale-[0.985] opacity-0",
          )}
          style={{ maxHeight: `${maxModelPickerHeightPx}px` }}
        >
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
              initialView={modelPickerView}
              onRequestClose={() => setIsModelPickerOpen(false)}
              onProviderModelChange={(provider, model, instanceId) => {
                void props.onProviderModelChange(provider, model, instanceId);
                setIsModelPickerOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}

      <input
        ref={composerFileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleComposerFileInputChange}
        tabIndex={-1}
      />

      {threadRuntimeBannerState ? (
        <div className="mb-2 w-full animate-in fade-in-50 slide-in-from-bottom-2 duration-150">
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
        </div>
      ) : null}

      {/* One surface and one editor subtree at every size. CSS order and
       * flex-basis move the same controls beneath the prompt once it wraps;
       * the Lexical editor never remounts, so focus and selection survive
       * both expansion and collapse. */}
      <div
        data-chat-composer-layout={isStackedComposer ? "stacked" : "inline"}
        className={cn(
          "relative flex min-h-0 flex-wrap border border-black/[0.11] bg-[var(--assistant-composer-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-radius,padding,background-color,border-color,box-shadow] duration-150 dark:border-white/[0.08] dark:shadow-[0_2px_12px_rgba(0,0,0,0.35),0_1px_2px_rgba(0,0,0,0.2)]",
          isStackedComposer
            ? "items-end gap-x-2 gap-y-1.5 rounded-3xl p-2.5"
            : "items-center gap-1.5 rounded-full p-1.5",
        )}
      >
        {props.composerStatus ? (
          <div className="basis-full mb-2">{props.composerStatus}</div>
        ) : null}
        {props.thread
          ? asyncUserInputs.map((request) => (
              <AsyncQuestionPanel
                key={String(request.requestId)}
                threadId={props.thread!.id}
                request={request}
                responding={props.activeRequestKey === String(request.requestId)}
                onSubmit={props.onSubmitUserInput}
              />
            ))
          : null}
        {activePendingApproval ? (
          <div className="basis-full border-b border-white/[0.08] bg-background/20 rounded-xl mb-2 overflow-hidden">
            <ComposerPendingApprovalPanel
              approval={activePendingApproval}
              pendingCount={props.pendingApprovals.length}
            />
            <div className="p-2 flex items-center justify-end gap-2">
              <ComposerPendingApprovalActions
                options={
                  activePendingApproval.options?.length
                    ? activePendingApproval.options
                    : activePendingApproval.options !== undefined ||
                        activePendingApproval.requestKind === "other"
                      ? [
                          { decision: "decline", label: "Decline" },
                          { decision: "cancel", label: "Cancel turn" },
                        ]
                      : undefined
                }
                requestId={ApprovalRequestId.makeUnsafe(String(activePendingApproval.requestId))}
                isResponding={props.activeRequestKey === String(activePendingApproval.requestId)}
                onRespondToApproval={async (requestId, decision) => {
                  await props.onApprovalDecision(String(requestId), decision);
                }}
              />
            </div>
          </div>
        ) : activePendingUserInput ? (
          <div className="flex min-h-0 max-h-[40vh] basis-full flex-col border-b border-white/[0.08] bg-background/20 rounded-xl mb-2 overflow-hidden">
            <ComposerPendingUserInputPanel
              isVisible={props.isChatVisible}
              pendingUserInputs={blockingUserInputs}
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
          <div className="basis-full border-b border-white/[0.08] bg-background/20 rounded-xl mb-2 overflow-hidden">
            <ComposerPlanFollowUpBanner
              key={activeProposedPlan.id}
              planTitle={planTitleFromMarkdown(activeProposedPlan.planMarkdown)}
            />
          </div>
        ) : null}

        {!isComposerApprovalState &&
        !activePendingUserInput &&
        props.previewAnnotations.length > 0 ? (
          <div className="basis-full mb-2">
            <ComposerPreviewAnnotationCards
              annotations={props.previewAnnotations}
              images={props.composerImages}
              onRemove={props.onRemovePreviewAnnotation}
              onExpandImage={(imageId) => {
                const preview = buildExpandedImagePreview(props.composerImages, imageId);
                if (preview) handleExpandImage(preview);
              }}
            />
          </div>
        ) : null}

        {!isComposerApprovalState && !activePendingUserInput && regularComposerImages.length > 0 ? (
          <div className="basis-full mb-2">
            <div className="flex flex-wrap gap-2">
              {regularComposerImages.map((image) => (
                <div
                  key={image.id}
                  className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/10 bg-background"
                >
                  <button
                    type="button"
                    className="h-full w-full cursor-zoom-in"
                    aria-label={`Preview ${image.name}`}
                    onClick={() => {
                      const preview = buildExpandedImagePreview(regularComposerImages, image.id);
                      if (!preview) return;
                      handleExpandImage(preview);
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
                      props.onRemoveComposerImage(image.id);
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

        {!activePendingApproval ? (
          <div
            data-chat-composer-actions="left"
            className={cn(
              "flex min-w-0 shrink-0 items-center",
              isStackedComposer ? "order-3" : "order-1",
            )}
          >
            {renderPlusDropdown()}
          </div>
        ) : null}

        {composerModeChip ? (
          <div
            className={cn(
              "flex min-w-0 items-center gap-1.5",
              isStackedComposer ? "order-1 basis-full px-1" : "order-2 shrink-0",
            )}
          >
            {composerModeChip}
          </div>
        ) : null}

        <div
          data-chat-composer-prompt="true"
          className={cn(
            "min-w-0",
            isStackedComposer ? "order-2 basis-full px-1 py-0.5" : "order-3 flex-1 px-1",
            composerDisabled && "opacity-70",
          )}
        >
          <ComposerPromptEditor
            ref={composerEditorRef}
            value={composerValue}
            cursor={composerCursor}
            skills={props.providerSnapshot?.skills ?? []}
            terminalContexts={props.terminalContexts}
            onRemoveTerminalContext={props.onRemoveTerminalContext}
            onMeasuredLinesChange={handleMeasuredComposerLinesChange}
            onChange={handleComposerChange}
            onCommandKeyDown={handleComposerCommandKey}
            onPaste={props.onComposerPaste}
            placeholder={resolvedPlaceholder}
            className="min-h-[var(--composer-line-height)] max-h-[calc(var(--composer-line-height)*10)] py-0 overflow-y-auto"
            disabled={composerDisabled}
          />
        </div>

        {!activePendingApproval ? (
          <div
            data-chat-composer-actions="right"
            className={cn(
              "order-4 ml-auto flex min-w-0 shrink items-center gap-1.5",
              isStackedComposer ? "max-w-[calc(100%-40px)]" : "max-w-[55%]",
            )}
          >
            <ProviderModelPicker
              triggerRef={modelPickerTriggerRef}
              provider={props.selectedProvider}
              activeInstanceId={props.selectedModelSelection.instanceId}
              model={props.selectedModelSelection.model}
              lockedProvider={props.selectedProvider}
              providers={props.providers}
              modelOptionsByProvider={props.modelOptionsByProvider}
              optionDescriptors={props.modelOptionDescriptors}
              showProviderIcon={false}
              disabled={!isChatReady || props.isRunning}
              triggerClassName="h-7 rounded-full border-0 px-2 text-xs font-normal leading-none text-foreground/80 hover:text-foreground hover:bg-accent/80 dark:text-zinc-300 dark:hover:text-white dark:hover:bg-white/10 transition-colors cursor-pointer sm:text-xs"
              onProviderModelChange={props.onProviderModelChange}
              open={isModelPickerOpen}
              activeView={modelPickerView}
              onOpenChange={handleModelPickerOpenChange}
            />
            {renderSendOrStopButton()}
          </div>
        ) : null}
      </div>
    </form>
  );

  return (
    <div
      ref={surfaceRef}
      className="flex h-full min-h-0 flex-col overflow-x-hidden bg-content-surface relative"
      onDragEnter={handleSurfaceDragEnter}
      onDragOver={handleSurfaceDragOver}
      onDragLeave={handleSurfaceDragLeave}
      onDrop={handleSurfaceDrop}
    >
      {compactionStatus ? (
        <div role="status" className="shrink-0 px-4 py-2 text-xs text-muted-foreground">
          {compactionStatus}
        </div>
      ) : null}
      {isDragOverSurface && (
        <div className="absolute top-[1px] bottom-[1px] left-[1px] right-[1px] z-50 flex flex-col items-center justify-center bg-background/40 backdrop-blur-sm text-center rounded-[inherit]">
          <HugeiconsIcon
            icon={__ImageAdd01IconHugeIcon}
            className="size-7 text-muted-foreground mb-4"
          />
          <h3 className="text-base font-medium text-foreground">Drop files to add them</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Images attach to your draft, other files are added as paths
          </p>
        </div>
      )}
      <div
        ref={dockComposerOnHover ? composerDockHoverState.ref : undefined}
        className={cn(
          "relative flex min-h-0 flex-1 flex-col",
          dockComposerOnHover && "overflow-hidden",
        )}
        onPointerEnter={dockComposerOnHover ? composerDockHoverState.onPointerEnter : undefined}
        onPointerLeave={dockComposerOnHover ? composerDockHoverState.onPointerLeave : undefined}
        onPointerMove={dockComposerOnHover ? composerDockHoverState.onPointerMove : undefined}
      >
        {providerBannerKind === "update-available" && timelineEntries.length > 0 ? (
          <ProviderUpdateNotice
            status={props.providerSnapshot}
            isTurnRunning={props.isRunning || props.isSending}
            onRestartAgent={props.onRestartAgent}
          />
        ) : hasProviderBanner && timelineEntries.length > 0 ? (
          <div
            role="status"
            className="shrink-0 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground"
          >
            This provider is unavailable. Saved history is still readable; reconnect or update the
            provider to continue.
          </div>
        ) : null}
        <ChatConnectionNotice status={props.connectionStatus} />
        {!props.workspaceId && timelineEntries.length === 0 ? (
          <div className="px-3 py-3 sm:px-5 sm:py-4">
            <div className="rounded-3xl border border-dashed border-border/80 bg-secondary/20 p-6 text-sm text-muted-foreground">
              This agent tile needs a local project path before it can start a thread.
            </div>
          </div>
        ) : hasProviderBanner && timelineEntries.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-12 overflow-y-auto px-6 py-8 pb-24">
            <ProviderStatusBanner status={props.providerSnapshot} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChatArtifactTemplateProvider
              onUse={canUseArtifactTemplate ? handleUseArtifactTemplate : undefined}
            >
              <ChatMediaProvider
                threadId={props.thread?.id ?? ""}
                baseUrl={props.mediaBaseUrl ?? null}
              >
                <MessagesTimeline
                  waitingFor={
                    props.pendingApprovals.length > 0
                      ? "approval"
                      : blockingUserInputs.length > 0
                        ? "question"
                        : null
                  }
                  activities={props.thread?.activities}
                  isChatVisible={props.isChatVisible}
                  revealImmediately={
                    props.isInterrupting ||
                    phase === "error" ||
                    phase === "interrupted" ||
                    phase === "stopped" ||
                    phase === "disconnected"
                  }
                  key={props.thread?.id ?? "cozea-chat-surface-empty"}
                  hasMessages={timelineEntries.length > 0}
                  isWorking={isWorking}
                  selectedProvider={props.selectedProvider}
                  activeTurnInProgress={isWorking || !latestTurnSettled}
                  activeTurnId={activeTurn?.turnId ?? null}
                  latestTurn={activeTurn}
                  runningTurnId={
                    props.thread?.session?.status === "running"
                      ? props.thread.session.activeTurnId
                      : null
                  }
                  activeWorkStartedAt={activeWorkStartedAt}
                  isWorkActive={isWorkActive}
                  generationStatusPhase={generationStatusPhase}
                  scrollContainerRef={props.timelineRef}
                  timelineEntries={timelineEntries}
                  turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
                  expandedWorkGroups={expandedWorkGroups}
                  onToggleWorkGroup={toggleWorkGroup}
                  onOpenTurnDiff={handleOpenTurnDiff}
                  revertTurnCountByUserMessageId={
                    props.onRevertToTurnCount ? revertTurnCountByUserMessageId : NO_REVERT_TURNS
                  }
                  onRevertUserMessage={handleRevertUserMessage}
                  isRevertingCheckpoint={Boolean(props.isRevertingCheckpoint)}
                  onImageExpand={handleExpandImage}
                  markdownCwd={markdownCwd}
                  dockedComposerScrollInsetPx={dockedComposerScrollInsetPx}
                  resolvedTheme={resolvedTheme}
                  workspaceId={workspaceIdForFileActions}
                  workspaceRoot={props.workspaceRoot ?? undefined}
                  artifactUrlsById={props.artifactUrlsById}
                  onOpenArtifact={props.onOpenArtifact ? handleOpenArtifact : undefined}
                />
              </ChatMediaProvider>
            </ChatArtifactTemplateProvider>
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
              {/*
                The reveal is transform + opacity only, never height.

                This dock is an absolutely positioned overlay inside a
                `justify-end` frame, so its height never pushes the timeline —
                the timeline's own bottom padding is what opens the gap. That
                makes an animated height pure cost: it runs on the layout path
                instead of the compositor, and any height driven by measuring
                this element feeds back into the thing being measured. The form
                below is `flex flex-col min-h-0`, so a measurement that comes in
                even slightly low squeezes its interior, the next observer pass
                measures the squeezed layout, and it ratchets down until the
                controls are clipped out of the tile.

                `max-h-full` stays as a *static* cap for a tall pending-approval
                or question panel. It is not part of the transition, so it
                cannot reintroduce either problem.
              */}
              <div
                data-chat-composer-dock-content="true"
                className={cn(
                  "relative z-[1] flex w-full min-h-0 max-h-full flex-col transition-[transform,opacity] motion-reduce:transition-none",
                  showComposerDockChrome
                    ? "translate-y-0 opacity-100 pointer-events-auto"
                    : "translate-y-2 opacity-0 pointer-events-none",
                )}
                style={{
                  transitionDuration: `${COMPOSER_DOCK_TRANSITION_MS}ms`,
                  transitionTimingFunction: COMPOSER_DOCK_EASING_CSS,
                }}
                onFocusCapture={() => {
                  setComposerDockFocused(true);
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
        // Capped so a tall pending-question card scrolls inside the composer
        // instead of collapsing the conversation above it to nothing.
        <div className="flex max-h-[70%] min-h-0 flex-col px-3 pt-1.5 pb-4 sm:px-5 sm:pt-2 sm:pb-5">
          {composerForm}
        </div>
      ) : null}

      {expandedImage && expandedImageItem ? (
        <AppOverlayPortal>
          <div
            className="fixed inset-0 z-[var(--cozea-layer-dialog)] flex items-center justify-center bg-black/75 px-4 py-6"
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
                  navigateExpandedImage(-1);
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
                  navigateExpandedImage(1);
                }}
              >
                <HugeiconsIcon icon={__ChevronRightIconHugeIcon} className="size-5" />
              </Button>
            ) : null}
          </div>
        </AppOverlayPortal>
      ) : null}
    </div>
  );
});

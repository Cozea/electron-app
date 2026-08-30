import { type MessageId, type ProviderKind, type TurnId } from "@cozea/assistant-contracts";
import { useTranslation } from "@/lib/i18n";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
  type ReactNode,
  type SVGProps,
  type SyntheticEvent,
} from "react";
import {
  LegendList,
  type LegendListMetrics,
  type LegendListRef,
  type LegendListRenderItemProps,
  type OnViewableItemsChangedInfo,
} from "@legendapp/list/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon as __CircleAlertIconHugeIcon,
  ArrowDown01Icon as __WorkLogExpandHugeIcon,
  ArrowDownLeft01Icon as __Undo2IconHugeIcon,
  ArrowLeftRightIcon as __MessageSquareIconHugeIcon,
  ArrowUp01Icon as __WorkLogCollapseHugeIcon,
  ArrowUpDownIcon as __ChevronsUpDownHugeIcon,
  CheckmarkCircle02Icon as __CheckIconHugeIcon,
  CommandLineIcon as __TerminalIconHugeIcon,
  CpuChargeIcon as __BotIconHugeIcon,
  Edit01Icon as __SquarePenIconHugeIcon,
  EyeIcon as __EyeIconHugeIcon,
  FirstBracketCircleIcon as __ZapIconHugeIcon,
  GitForkIcon as __GitForkIconHugeIcon,
  Globe02Icon as __GlobeIconHugeIcon,
  HammerIcon as __HammerIconHugeIcon,
  Image01Icon as __ImageIconHugeIcon,
  PinIcon as __PinIconHugeIcon,
  Undo02Icon as __UndoIconHugeIcon,
  Volume02Icon as __VolumeIconHugeIcon,
  Wrench01Icon as __WrenchIconHugeIcon,
} from "@hugeicons/core-free-icons";
import { deriveTimelineEntries, formatDuration } from "./session-logic";
import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX } from "./chat-scroll";
import { type TurnDiffSummary } from "@/stores/types";
import ChatMarkdown from "./ChatMarkdown";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { asHugeIcon } from "@/lib/icons/asHugeIcon";
type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>;
import { formatWorkspaceRelativePath } from "@/lib/filePathDisplay";
import { estimateTimelineMessageHeight } from "./timelineHeight";
import { buildExpandedImagePreview } from "./ExpandedImagePreview";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { ChangedFilesCard } from "./ChangedFilesTree";
import {
  CHANGED_FILES_PREVIEW_FILE_LIMIT,
  changedFileName,
  shouldAutoExpandChangedFiles,
} from "./changedFilesPresentation";
import { VscodeEntryIcon } from "./VscodeEntryIcon";
import { commandProgramName } from "./shellCommandProgram";
import { normalizeToolRowPresentation } from "./toolDetailPresentation";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  computeMessageDurationStart,
  deriveTurnHeaderIndex,
  normalizeCompactToolLabel,
  omitSupersededLifecycleMarkers,
  summarizeToolGroup,
  toolGroupSummaryKind,
  workEntryIndicatesFailure,
  workGroupId,
  workLogEntryIsToolLike,
  type GenerationStatusPhase,
  type ToolGroupSummaryKind,
} from "./MessagesTimeline.logic";
import { PersistedFilesList } from "./PersistedFilesList";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "@/stores/terminalContext";
import { cn } from "@/lib/utils";
import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import { ClaudeAI, CursorIcon, OpenAI, OpenCodeIcon } from "../Icons";

const ZapIcon = asHugeIcon(__ZapIconHugeIcon);
const MessageSquareIcon = asHugeIcon(__MessageSquareIconHugeIcon);
const CheckIcon = asHugeIcon(__CheckIconHugeIcon);
const TerminalIcon = asHugeIcon(__TerminalIconHugeIcon);
const BotIcon = asHugeIcon(__BotIconHugeIcon);
const CircleAlertIcon = asHugeIcon(__CircleAlertIconHugeIcon);
const EyeIcon = asHugeIcon(__EyeIconHugeIcon);
const GlobeIcon = asHugeIcon(__GlobeIconHugeIcon);
const SquarePenIcon = asHugeIcon(__SquarePenIconHugeIcon);
const HammerIcon = asHugeIcon(__HammerIconHugeIcon);
const WrenchIcon = asHugeIcon(__WrenchIconHugeIcon);
const ImageIcon = asHugeIcon(__ImageIconHugeIcon);

const MAX_VISIBLE_WORK_LOG_ENTRIES = 1;
const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 8;
/** Long user bubbles: collapse with expand control (same pattern as work log overflow). */
const USER_MESSAGE_TRUNCATE_CHAR_THRESHOLD = 420;
const USER_MESSAGE_TRUNCATE_NEWLINE_THRESHOLD = 10;

function formatMessageRelativeTime(timestamp: string | number | undefined): string {
  if (!timestamp) return "";
  const parsed = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp;
  if (!parsed || Number.isNaN(parsed) || parsed <= 0) return "";
  const diffMs = Date.now() - parsed;
  const seconds = Math.max(0, Math.floor(diffMs / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(parsed).toLocaleDateString();
}

interface MessagesTimelineProps {
  hasMessages: boolean;
  isWorking: boolean;
  selectedProvider: ProviderKind | null;
  activeTurnInProgress: boolean;
  activeTurnId?: TurnId | null;
  activeWorkStartedAt: string | null;
  isWorkActive: boolean;
  generationStatusPhase: GenerationStatusPhase;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionSummary: string | null;
  completionSummariesByMessageId: ReadonlyMap<MessageId, string>;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  expandedWorkGroups: Record<string, boolean>;
  onToggleWorkGroup: (groupId: string) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  markdownCwd: string | undefined;
  dockedComposerScrollInsetPx?: number;
  resolvedTheme: "light" | "dark";
  workspaceId: string | undefined;
  workspaceRoot: string | undefined;
  artifactUrlsById?: Readonly<Record<string, string>>;
  onOpenArtifact?: (artifactId: string) => void;
}

const LEGEND_LIST_AGENT_TIMELINE_DIAGNOSTICS_KEY = "cozea:legend-list-agent-timeline:debug";
const LEGEND_LIST_AGENT_TIMELINE_RECYCLE_KEY = "cozea:legend-list-agent-timeline:recycle";
const LEGEND_LIST_DRAW_DISTANCE_PX = 1_200;
const LEGEND_LIST_DEFAULT_HEIGHT_PX = 640;
const LEGEND_LIST_DEFAULT_WIDTH_PX = 720;
const LEGEND_LIST_ITEM_SIZE_CHANGE_LOG_THRESHOLD_PX = 48;
const LEGEND_LIST_TAIL_PADDING_PX = 16;

function readLegendListBooleanPreference(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function shouldLogLegendListDiagnostics(): boolean {
  return readLegendListBooleanPreference(LEGEND_LIST_AGENT_TIMELINE_DIAGNOSTICS_KEY, false);
}

function shouldRecycleLegendListItems(): boolean {
  return readLegendListBooleanPreference(LEGEND_LIST_AGENT_TIMELINE_RECYCLE_KEY, true);
}

function resolveAssistantIdentityIcon(provider: ProviderKind | null | undefined): LucideIcon {
  switch (provider) {
    case "claudeAgent":
      return ClaudeAI;
    case "cursor":
      return CursorIcon;
    case "opencode":
      return OpenCodeIcon;
    case "codex":
      return OpenAI;
    default:
      return MessageSquareIcon;
  }
}

export const MessagesTimeline = memo(function MessagesTimeline({
  hasMessages,
  isWorking,
  selectedProvider,
  activeTurnInProgress,
  activeTurnId,
  activeWorkStartedAt,
  isWorkActive,
  generationStatusPhase,
  scrollContainerRef,
  timelineEntries,
  completionSummary,
  completionSummariesByMessageId,
  turnDiffSummaryByAssistantMessageId,
  expandedWorkGroups,
  onToggleWorkGroup,
  onOpenTurnDiff,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
  isRevertingCheckpoint,
  onImageExpand,
  markdownCwd,
  dockedComposerScrollInsetPx = 0,
  resolvedTheme,
  workspaceRoot,
  artifactUrlsById,
  onOpenArtifact,
}: MessagesTimelineProps) {
  const { t } = useTranslation();
  const timelineRootRef = useRef<HTMLDivElement | null>(null);
  const legendListRef = useRef<LegendListRef | null>(null);
  const [timelineWidthPx, setTimelineWidthPx] = useState<number | null>(null);
  const [timelineHeightPx, setTimelineHeightPx] = useState<number | null>(null);
  const [changedFilesExpandedByTurnId, setChangedFilesExpandedByTurnId] = useState<
    Record<string, boolean>
  >({});
  const onToggleChangedFilesExpanded = useCallback((turnId: TurnId, expanded: boolean) => {
    setChangedFilesExpandedByTurnId((previous) => ({ ...previous, [turnId]: expanded }));
  }, []);
  /** Only the newest turn's changed files may auto-expand. */
  const latestTurnDiffTurnId = useMemo(() => {
    let latestTurnId: TurnId | null = null;
    let latestCompletedAt = "";
    for (const summary of turnDiffSummaryByAssistantMessageId.values()) {
      if (summary.completedAt >= latestCompletedAt) {
        latestCompletedAt = summary.completedAt;
        latestTurnId = summary.turnId;
      }
    }
    return latestTurnId;
  }, [turnDiffSummaryByAssistantMessageId]);
  const [allDirectoriesExpandedByTurnId, setAllDirectoriesExpandedByTurnId] = useState<
    Record<string, boolean>
  >({});
  const [expandedUserMessageIds, setExpandedUserMessageIds] = useState<Record<string, boolean>>({});
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(new Set());
  const EmptyAssistantIcon = resolveAssistantIdentityIcon(selectedProvider);

  useLayoutEffect(() => {
    const timelineRoot = timelineRootRef.current;
    if (!timelineRoot) return;

    const updateSize = (nextWidth: number, nextHeight: number) => {
      setTimelineWidthPx((previousValue) => {
        if (previousValue !== null && Math.abs(previousValue - nextWidth) < 0.5) {
          return previousValue;
        }
        return nextWidth;
      });
      setTimelineHeightPx((previousValue) => {
        if (previousValue !== null && Math.abs(previousValue - nextHeight) < 0.5) {
          return previousValue;
        }
        return nextHeight;
      });
    };

    const initialRect = timelineRoot.getBoundingClientRect();
    updateSize(initialRect.width, initialRect.height);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const rect = timelineRoot.getBoundingClientRect();
      updateSize(rect.width, rect.height);
    });
    observer.observe(timelineRoot);
    return () => {
      observer.disconnect();
    };
  }, [hasMessages, isWorking]);

  const rows = useMemo<TimelineRow[]>(() => {
    const nextRows: TimelineRow[] = [];
    const completedStatuses = new Map<
      string,
      { turnId: TurnId; summary: string; createdAt: string }
    >();
    for (const [messageId, summary] of completionSummariesByMessageId) {
      const terminalEntry = timelineEntries.find(
        (entry) => entry.kind === "message" && entry.message.id === messageId,
      );
      if (
        terminalEntry?.kind !== "message" ||
        terminalEntry.message.role !== "assistant" ||
        !terminalEntry.message.turnId
      ) {
        continue;
      }
      completedStatuses.set(String(terminalEntry.message.turnId), {
        turnId: terminalEntry.message.turnId,
        summary,
        createdAt: terminalEntry.message.completedAt ?? terminalEntry.message.createdAt,
      });
    }
    if (completionSummary && activeTurnId && !completedStatuses.has(String(activeTurnId))) {
      completedStatuses.set(String(activeTurnId), {
        turnId: activeTurnId,
        summary: completionSummary,
        createdAt: activeWorkStartedAt ?? "",
      });
    }

    const turnStatusRowsByIndex = new Map<number, TimelineRow[]>();
    const addTurnStatusRow = (index: number, row: TimelineRow) => {
      const existing = turnStatusRowsByIndex.get(index);
      if (existing) {
        existing.push(row);
      } else {
        turnStatusRowsByIndex.set(index, [row]);
      }
    };
    for (const status of completedStatuses.values()) {
      addTurnStatusRow(deriveTurnHeaderIndex(timelineEntries, status.turnId), {
        kind: "turn-status",
        id: `turn-status:${status.turnId}`,
        createdAt: status.createdAt,
        startedAt: null,
        summary: status.summary,
      });
    }
    if (isWorkActive) {
      const statusId = activeTurnId ? `turn-status:${activeTurnId}` : "turn-status:pending";
      for (const rowsAtIndex of turnStatusRowsByIndex.values()) {
        const completedIndex = rowsAtIndex.findIndex((row) => row.id === statusId);
        if (completedIndex >= 0) rowsAtIndex.splice(completedIndex, 1);
      }
      addTurnStatusRow(deriveTurnHeaderIndex(timelineEntries, activeTurnId), {
        kind: "turn-status",
        id: statusId,
        createdAt: activeWorkStartedAt ?? "",
        startedAt: activeWorkStartedAt,
        summary: null,
      });
    }

    const durationStartByMessageId = computeMessageDurationStart(
      timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
    );
    const appendTurnStatusRows = (index: number) => {
      nextRows.push(...(turnStatusRowsByIndex.get(index) ?? []));
    };

    for (let index = 0; index < timelineEntries.length; index += 1) {
      const timelineEntry = timelineEntries[index];
      if (!timelineEntry) {
        continue;
      }

      appendTurnStatusRows(index);

      if (timelineEntry.kind === "work") {
        const groupedEntries = [timelineEntry.entry];
        let cursor = index + 1;
        while (cursor < timelineEntries.length) {
          const nextEntry = timelineEntries[cursor];
          if (!nextEntry || nextEntry.kind !== "work") break;
          groupedEntries.push(nextEntry.entry);
          cursor += 1;
        }
        // Providers without stable tool-call ids emit a start marker and a
        // terminal marker for the same call. Collapse them before segmenting so
        // one tool call renders as one row.
        const dedupedEntries = omitSupersededLifecycleMarkers(
          groupedEntries,
          (workEntry) => workEntry,
        );
        // Session diagnostics (runtime/config warnings, non-fatal provider
        // errors) fold into quiet collapsed "notices" rows instead of red
        // entries inline with the turn's work; turn failures surface through
        // the thread error state, not these activities. Order is preserved by
        // splitting the run into consecutive same-kind segments.
        let segmentStart = 0;
        for (let cut = 1; cut <= dedupedEntries.length; cut += 1) {
          const boundary =
            cut === dedupedEntries.length ||
            isDiagnosticWorkEntry(dedupedEntries[cut]!) !==
              isDiagnosticWorkEntry(dedupedEntries[segmentStart]!);
          if (!boundary) continue;
          const segment = dedupedEntries.slice(segmentStart, cut);
          const first = segment[0]!;
          const segmentId =
            segmentStart === 0 ? timelineEntry.id : `${timelineEntry.id}:${segmentStart}`;
          const segmentCreatedAt = first.createdAt ?? timelineEntry.createdAt;

          if (isDiagnosticWorkEntry(first)) {
            nextRows.push({
              kind: "notices",
              id: segmentId,
              createdAt: segmentCreatedAt,
              groupedEntries: segment,
            });
            segmentStart = cut;
            continue;
          }

          // A run of pure tool calls collapses to one row: the tool still
          // running, or a summary of the finished run. Mixed runs (narration,
          // info) keep the original single-card treatment, since a summary
          // would mislabel them.
          const onlyToolEntries = segment.every(workLogEntryIsToolLike);
          if (!onlyToolEntries) {
            nextRows.push({
              kind: "work",
              id: segmentId,
              createdAt: segmentCreatedAt,
              groupedEntries: segment,
            });
            segmentStart = cut;
            continue;
          }

          const groupId = workGroupId(segmentId, first);
          const expanded = expandedWorkGroups[groupId] ?? false;
          const liveEntries = segment.filter(
            (workEntry) =>
              isWorkActive &&
              workEntry.toolLifecycleStatus === "inProgress" &&
              (activeTurnId === null ||
                activeTurnId === undefined ||
                workEntry.turnId === activeTurnId),
          );

          // Only settled calls collapse. A tool that is still running stays on
          // screen as its own row — hiding live work behind a summary is the
          // one moment the reader most needs to see it.
          const liveIds = new Set(liveEntries.map((workEntry) => workEntry.id));
          const settledEntries = segment.filter((workEntry) => !liveIds.has(workEntry.id));

          if (settledEntries.length > 0) {
            nextRows.push({
              kind: "work-toggle",
              id: `work-toggle:${segmentId}`,
              createdAt: segmentCreatedAt,
              groupId,
              hiddenCount: settledEntries.length,
              expanded,
              summary: summarizeToolGroup(settledEntries),
              summaryKind: toolGroupSummaryKind(settledEntries),
              hasFailure: settledEntries.some(workEntryIndicatesFailure),
            });

            if (expanded) {
              for (const [entryIndex, workEntry] of settledEntries.entries()) {
                nextRows.push({
                  kind: "work",
                  id: `${segmentId}:entry:${workEntry.id}`,
                  createdAt: workEntry.createdAt ?? segmentCreatedAt,
                  groupedEntries: [workEntry],
                  isExpandedToolGroupEntry: true,
                  isLastExpandedToolGroupEntry: entryIndex === settledEntries.length - 1,
                });
              }
            }
          }

          for (const workEntry of liveEntries) {
            nextRows.push({
              kind: "work-live",
              id: `work-live:${segmentId}:${workEntry.id}`,
              createdAt: workEntry.createdAt ?? segmentCreatedAt,
              entry: workEntry,
              // One card per running call, so it carries no group toggle of
              // its own — the settled pill above owns expansion.
              groupedEntries: [workEntry],
              groupId,
              expanded,
            });
          }
          segmentStart = cut;
        }
        index = cursor - 1;
        continue;
      }

      if (timelineEntry.kind === "proposed-plan") {
        nextRows.push({
          kind: "proposed-plan",
          id: timelineEntry.id,
          createdAt: timelineEntry.createdAt,
          proposedPlan: timelineEntry.proposedPlan,
        });
        continue;
      }

      nextRows.push({
        kind: "message",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        message: timelineEntry.message,
        durationStart:
          durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      });
    }
    appendTurnStatusRows(timelineEntries.length);

    if (isWorkActive && generationStatusPhase === "thinking") {
      nextRows.push({
        kind: "thinking",
        id: "thinking-indicator-row",
        createdAt: activeWorkStartedAt ?? "",
      });
    }

    return nextRows;
  }, [
    activeWorkStartedAt,
    activeTurnId,
    completionSummariesByMessageId,
    completionSummary,
    // Row derivation now depends on expansion: an expanded group emits an extra
    // row per entry, so toggling has to rebuild the rows.
    expandedWorkGroups,
    isWorkActive,
    generationStatusPhase,
    timelineEntries,
  ]);

  const firstAlwaysRenderedRowIndex = useMemo(() => {
    const firstTailRowIndex = Math.max(rows.length - ALWAYS_UNVIRTUALIZED_TAIL_ROWS, 0);
    if (!activeTurnInProgress) return firstTailRowIndex;

    const turnStartedAtMs =
      typeof activeWorkStartedAt === "string" ? Date.parse(activeWorkStartedAt) : Number.NaN;
    let firstCurrentTurnRowIndex = -1;
    if (!Number.isNaN(turnStartedAtMs)) {
      firstCurrentTurnRowIndex = rows.findIndex((row) => {
        if (row.kind === "turn-status" && row.startedAt) return true;
        if (!row.createdAt) return false;
        const rowCreatedAtMs = Date.parse(row.createdAt);
        return !Number.isNaN(rowCreatedAtMs) && rowCreatedAtMs >= turnStartedAtMs;
      });
    }

    if (firstCurrentTurnRowIndex < 0) {
      firstCurrentTurnRowIndex = rows.findIndex(
        (row) => row.kind === "message" && row.message.streaming,
      );
    }

    if (firstCurrentTurnRowIndex < 0) return firstTailRowIndex;

    for (let index = firstCurrentTurnRowIndex - 1; index >= 0; index -= 1) {
      const previousRow = rows[index];
      if (!previousRow || previousRow.kind !== "message") continue;
      if (previousRow.message.role === "user") {
        return Math.min(index, firstTailRowIndex);
      }
      if (previousRow.message.role === "assistant" && !previousRow.message.streaming) {
        break;
      }
    }

    return Math.min(firstCurrentTurnRowIndex, firstTailRowIndex);
  }, [activeTurnInProgress, activeWorkStartedAt, rows]);

  const alwaysRenderKeys = useMemo(() => {
    const keys = new Set<string>();
    for (let index = firstAlwaysRenderedRowIndex; index < rows.length; index += 1) {
      const row = rows[index];
      if (row) keys.add(row.id);
    }
    for (const row of rows) {
      if (row.kind === "turn-status" || row.kind === "thinking") {
        keys.add(row.id);
      }
      if (row.kind === "message" && row.message.streaming) {
        keys.add(row.id);
      }
    }
    return Array.from(keys);
  }, [firstAlwaysRenderedRowIndex, rows]);

  const recycleItems = useMemo(() => shouldRecycleLegendListItems(), []);
  const estimatedListSize = useMemo(
    () => ({
      height: timelineHeightPx ?? LEGEND_LIST_DEFAULT_HEIGHT_PX,
      width: timelineWidthPx ?? LEGEND_LIST_DEFAULT_WIDTH_PX,
    }),
    [timelineHeightPx, timelineWidthPx],
  );
  const maintainScrollAtEndThreshold = useMemo(() => {
    const height = Math.max(timelineHeightPx ?? LEGEND_LIST_DEFAULT_HEIGHT_PX, 1);
    return Math.max(0.04, AUTO_SCROLL_BOTTOM_THRESHOLD_PX / height);
  }, [timelineHeightPx]);
  const bottomPaddingPx = useMemo(() => {
    if (!Number.isFinite(dockedComposerScrollInsetPx) || dockedComposerScrollInsetPx <= 0) {
      return LEGEND_LIST_TAIL_PADDING_PX;
    }
    return Math.max(LEGEND_LIST_TAIL_PADDING_PX, Math.ceil(dockedComposerScrollInsetPx));
  }, [dockedComposerScrollInsetPx]);
  const dataVersion = useMemo(() => {
    const lastRow = rows.at(-1);
    return [
      rows.length,
      lastRow?.id ?? "none",
      lastRow?.kind ?? "none",
      activeTurnInProgress ? "active" : "idle",
      isWorking ? "working" : "settled",
      completionSummariesByMessageId.size,
    ].join(":");
  }, [
    activeTurnInProgress,
    completionSummariesByMessageId.size,
    isWorking,
    rows,
  ]);
  const legendListExtraData = useMemo(
    () => ({
      allDirectoriesExpandedByTurnId,
      completionSummary,
      // Size only. This memo recomputes every streaming frame (activeTurn and
      // thread.messages both change per token upstream), so materializing every
      // summary's full text here rebuilt the whole string at frame rate.
      completionSummaryVersion: completionSummariesByMessageId.size,
      expandedUserMessageIds,
      expandedWorkGroups,
      isRevertingCheckpoint,
      isWorking,
      resolvedTheme,
      turnDiffSummaryVersion: turnDiffSummaryByAssistantMessageId.size,
      artifactMediaVersion: Object.keys(artifactUrlsById ?? {}).join("|"),
    }),
    [
      allDirectoriesExpandedByTurnId,
      completionSummary,
      completionSummariesByMessageId,
      expandedUserMessageIds,
      expandedWorkGroups,
      isRevertingCheckpoint,
      isWorking,
      resolvedTheme,
      turnDiffSummaryByAssistantMessageId.size,
      artifactUrlsById,
    ],
  );
  const getEstimatedItemSize = useCallback(
    (row: TimelineRow) => estimateTimelineRowHeight(row, timelineWidthPx),
    [timelineWidthPx],
  );
  const getItemType = useCallback((row: TimelineRow): TimelineRow["kind"] => row.kind, []);
  const keyExtractor = useCallback((row: TimelineRow) => row.id, []);
  const shouldRestoreVisiblePosition = useCallback(
    (row: TimelineRow) => row.kind !== "turn-status" && row.kind !== "thinking",
    [],
  );
  const itemsAreEqual = useCallback(
    (previousRow: TimelineRow, nextRow: TimelineRow) =>
      areTimelineRowsEquivalent(previousRow, nextRow),
    [],
  );
  const onTimelineImageLoad = useCallback(() => {
    // Legend List measures row size with ResizeObserver; this hook preserves the old image load contract.
  }, []);
  const onTimelineImageError = useCallback((imageId: string) => {
    setFailedImageIds((prev) => {
      const next = new Set(prev);
      next.add(imageId);
      return next;
    });
  }, []);

  // LegendList types `onLoad` as an intersection with the DOM handler, so accept both shapes.
  const onLegendListLoad = useCallback(
    (info: { elapsedTimeInMs: number } | SyntheticEvent<HTMLDivElement>) => {
      if (!shouldLogLegendListDiagnostics()) return;
      if (!("elapsedTimeInMs" in info)) return;
      console.info("[LegendList][AgentTimeline] load", {
        elapsedTimeInMs: info.elapsedTimeInMs,
      });
    },
    [],
  );
  const onLegendListMetricsChange = useCallback((metrics: LegendListMetrics) => {
    if (!shouldLogLegendListDiagnostics()) return;
    console.info("[LegendList][AgentTimeline] metrics", {
      ...metrics,
    });
  }, []);
  const onLegendListItemSizeChanged = useCallback(
    (info: {
      size: number;
      previous: number;
      index: number;
      itemKey: string;
      itemData: TimelineRow;
    }) => {
      if (!shouldLogLegendListDiagnostics()) return;
      const delta = Math.abs(info.size - info.previous);
      if (delta < LEGEND_LIST_ITEM_SIZE_CHANGE_LOG_THRESHOLD_PX) return;
      console.info("[LegendList][AgentTimeline] item-size", {
        delta,
        index: info.index,
        itemKey: info.itemKey,
        kind: info.itemData.kind,
        previous: info.previous,
        size: info.size,
      });
    },
    [],
  );
  const onLegendListViewableItemsChanged = useCallback(
    (info: OnViewableItemsChangedInfo<TimelineRow>) => {
      if (!shouldLogLegendListDiagnostics()) return;
      console.info("[LegendList][AgentTimeline] viewable", {
        changed: info.changed.length,
        viewable: info.viewableItems.length,
      });
    },
    [],
  );
  const onToggleAllDirectories = useCallback((turnId: TurnId) => {
    setAllDirectoriesExpandedByTurnId((current) => ({
      ...current,
      [turnId]: !(current[turnId] ?? true),
    }));
  }, []);

  const toggleUserMessageExpanded = useCallback((messageId: MessageId) => {
    setExpandedUserMessageIds((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  }, []);

  const renderRowContent = (row: TimelineRow) => (
    <div
      className="pb-4"
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" &&
        (() => {
          const groupId = row.id;
          const groupedEntries = row.groupedEntries;

          // Entries revealed by expanding a group render bare: the group's own
          // live/toggle row already supplies the surrounding card.
          if (row.isExpandedToolGroupEntry) {
            return (
              <div className={cn("px-2", row.isLastExpandedToolGroupEntry && "pb-1")}>
                {groupedEntries.map((workEntry) => (
                  <SimpleWorkEntryRow
                    key={`work-row:${workEntry.id}`}
                    workEntry={workEntry}
                    workspaceRoot={workspaceRoot}
                    resolvedTheme={resolvedTheme}
                    artifactUrl={
                      workEntry.toolCallId ? artifactUrlsById?.[workEntry.toolCallId] : undefined
                    }
                    onOpenArtifact={onOpenArtifact}
                    onOpenTurnDiff={onOpenTurnDiff}
                  />
                ))}
              </div>
            );
          }

          const isExpanded = expandedWorkGroups[groupId] ?? false;
          const hasOverflow = groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
          const onlyToolEntries = groupedEntries.every((entry) => entry.tone === "tool");
          // A `work` row is a mixed run by construction: all-tool runs are
          // routed to work-live / work-toggle, which own summarization.
          const showHeader = hasOverflow || !onlyToolEntries;

          return (
            <div className="rounded-xl border border-border/45 bg-card/25 px-2 py-1.5">
              {showHeader && (
                <div className="mb-1.5 flex items-center justify-between gap-2 -mx-1 -mt-0.5">
                  <p
                    className="inline-flex min-h-5 shrink-0 items-center justify-center rounded-full bg-muted/90 px-2.5 py-1 text-sm font-medium tabular-nums leading-none text-muted-foreground"
                    aria-label={`${groupedEntries.length} work log entries`}
                  >
                    {groupedEntries.length}
                  </p>
                  {hasOverflow && (
                    <button
                      type="button"
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/90 text-muted-foreground/65 transition-colors duration-150 hover:bg-muted hover:text-foreground/80"
                      aria-expanded={isExpanded}
                      aria-label={
                        isExpanded
                          ? "Collapse work log"
                          : `Expand to show all ${onlyToolEntries ? "tool calls" : "entries"}`
                      }
                      title={isExpanded ? "Show less" : `Show all`}
                      onClick={() => onToggleWorkGroup(groupId)}
                    >
                      <HugeiconsIcon
                        icon={isExpanded ? __WorkLogCollapseHugeIcon : __WorkLogExpandHugeIcon}
                        className="size-4 stroke-[2.2]"
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>
              )}
              <div
                className={cn(
                  "space-y-0.5 overflow-y-auto flex flex-col [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
                  !isExpanded && hasOverflow
                    ? "max-h-[160px] [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)]"
                    : "max-h-none",
                )}
                ref={(node) => {
                  if (node && !isExpanded) {
                    node.scrollTop = node.scrollHeight;
                  }
                }}
              >
                {groupedEntries.map((workEntry) => (
                  <SimpleWorkEntryRow
                    key={`work-row:${workEntry.id}`}
                    workEntry={workEntry}
                    workspaceRoot={workspaceRoot}
                    resolvedTheme={resolvedTheme}
                    artifactUrl={workEntry.toolCallId ? artifactUrlsById?.[workEntry.toolCallId] : undefined}
                    onOpenArtifact={onOpenArtifact}
                    onOpenTurnDiff={onOpenTurnDiff}
                  />
                ))}
              </div>
            </div>
          );
        })()}

      {row.kind === "work-live" && (
        <div className="rounded-xl border border-border/45 bg-card/25 px-2 py-1.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <SimpleWorkEntryRow
                workEntry={row.entry}
                workspaceRoot={workspaceRoot}
                resolvedTheme={resolvedTheme}
                artifactUrl={
                  row.entry.toolCallId ? artifactUrlsById?.[row.entry.toolCallId] : undefined
                }
                onOpenArtifact={onOpenArtifact}
                onOpenTurnDiff={onOpenTurnDiff}
              />
            </div>
            {row.groupedEntries.length > 1 && (
              <button
                type="button"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/90 text-muted-foreground/65 transition-colors duration-150 hover:bg-muted hover:text-foreground/80"
                aria-expanded={row.expanded}
                aria-label={
                  row.expanded
                    ? "Collapse tool calls"
                    : `Expand to show all ${row.groupedEntries.length} tool calls`
                }
                title={row.expanded ? "Show less" : "Show all"}
                onClick={() => onToggleWorkGroup(row.groupId)}
              >
                <HugeiconsIcon
                  icon={row.expanded ? __WorkLogCollapseHugeIcon : __WorkLogExpandHugeIcon}
                  className="size-4 stroke-[2.2]"
                  aria-hidden="true"
                />
              </button>
            )}
          </div>
        </div>
      )}

      {row.kind === "work-toggle" && (
        <button
          type="button"
          className="group/work-toggle flex w-full items-center gap-2 rounded-xl border border-border/45 bg-card/25 px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-card/40"
          aria-expanded={row.expanded}
          aria-label={`${row.summary} (${row.hiddenCount} tool ${
            row.hiddenCount === 1 ? "call" : "calls"
          })`}
          onClick={() => onToggleWorkGroup(row.groupId)}
        >
          <HugeiconsIcon
            icon={row.hasFailure ? __CircleAlertIconHugeIcon : __CheckIconHugeIcon}
            className={cn(
              "size-4 shrink-0 stroke-[2.2]",
              row.hasFailure ? "text-destructive" : "text-foreground/60",
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate text-sm font-medium leading-none text-muted-foreground">
            {row.summary}
          </span>
          <HugeiconsIcon
            icon={row.expanded ? __WorkLogCollapseHugeIcon : __WorkLogExpandHugeIcon}
            className={cn(
              "size-4 shrink-0 stroke-[2.2] text-muted-foreground/65 transition-[color,opacity] duration-150",
              // Quiet until hovered; an open group keeps its control visible.
              row.expanded
                ? "opacity-100"
                : "opacity-0 group-hover/work-toggle:opacity-100 group-focus-visible/work-toggle:opacity-100",
            )}
            aria-hidden="true"
          />
          {/* Absorbs the remaining width so the summary and chevron stay together. */}
          <span className="min-w-0 flex-1" aria-hidden="true" />
        </button>
      )}

      {row.kind === "notices" &&
        (() => {
          const isExpanded = expandedWorkGroups[row.id] ?? false;
          const count = row.groupedEntries.length;
          return (
            <div className="px-1 py-0.5">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground/65 transition-colors duration-150 hover:bg-muted/40 hover:text-muted-foreground"
                aria-expanded={isExpanded}
                onClick={() => onToggleWorkGroup(row.id)}
              >
                <CircleAlertIcon className="size-3" aria-hidden="true" />
                <span>{count === 1 ? "1 agent notice" : `${count} agent notices`}</span>
                <HugeiconsIcon
                  icon={isExpanded ? __WorkLogCollapseHugeIcon : __WorkLogExpandHugeIcon}
                  className="size-3 stroke-[2.2]"
                  aria-hidden="true"
                />
              </button>
              {isExpanded && (
                <div className="mt-0.5 space-y-0.5 rounded-lg border border-border/35 bg-card/15 px-2 py-1.5">
                  {row.groupedEntries.map((workEntry) => (
                    <SimpleWorkEntryRow
                      key={`notice-row:${workEntry.id}`}
                      workEntry={workEntry}
                      workspaceRoot={workspaceRoot}
                      resolvedTheme={resolvedTheme}
                      artifactUrl={workEntry.toolCallId ? artifactUrlsById?.[workEntry.toolCallId] : undefined}
                      onOpenArtifact={onOpenArtifact}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })()}

      {row.kind === "message" &&
        row.message.role === "user" &&
        (() => {
          const userImages = row.message.attachments ?? [];
          const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text);
          const terminalContexts = displayedUserMessage.contexts;
          const canRevertAgentWork = revertTurnCountByUserMessageId.has(row.message.id);
          const messageId = row.message.id;
          const terminalCtxPrefix =
            terminalContexts.length > 0 ? buildInlineTerminalContextText(terminalContexts) : "";
          const measurePayload = [terminalCtxPrefix, displayedUserMessage.visibleText]
            .filter((part) => part.length > 0)
            .join("\n");
          const newlineCount = (measurePayload.match(/\n/g) ?? []).length;
          const needsUserBodyTruncate =
            measurePayload.length > USER_MESSAGE_TRUNCATE_CHAR_THRESHOLD ||
            newlineCount >= USER_MESSAGE_TRUNCATE_NEWLINE_THRESHOLD;
          const userMessageExpanded = expandedUserMessageIds[messageId] ?? false;
          return (
            <div className="flex w-full min-w-0 justify-end">
              <div className="group relative flex max-w-[85%] sm:max-w-[75%] min-w-0 flex-col items-end gap-1">
                {userImages.length > 0 && (
                  <div className="mb-1 flex w-full flex-wrap justify-end gap-2">
                    {userImages.map(
                      (image: NonNullable<TimelineMessage["attachments"]>[number]) => {
                        const isFailed = failedImageIds.has(image.id);
                        return (
                          <div
                            key={image.id}
                            className="relative overflow-hidden rounded-xl border border-border/40 bg-transparent h-24 w-32 shrink-0"
                          >
                            {image.previewUrl && !isFailed ? (
                              <button
                                type="button"
                                className="h-full w-full cursor-zoom-in"
                                aria-label={`Preview ${image.name}`}
                                onClick={() => {
                                  const preview = buildExpandedImagePreview(userImages, image.id);
                                  if (!preview) return;
                                  onImageExpand(preview);
                                }}
                              >
                                <img
                                  src={image.previewUrl}
                                  alt={image.name}
                                  className="h-full w-full object-cover"
                                  onLoad={onTimelineImageLoad}
                                  onError={() => onTimelineImageError(image.id)}
                                />
                              </button>
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center border border-dashed border-border/70 bg-secondary/30 px-2 py-2 text-center text-muted-foreground">
                                <ImageIcon className="mb-1.5 size-5 opacity-50" />
                                <span className="truncate w-full text-[9px] font-medium leading-tight">
                                  {image.name}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      },
                    )}
                  </div>
                )}
                {(displayedUserMessage.visibleText.trim().length > 0 ||
                  terminalContexts.length > 0) && (
                  <div className="relative w-fit max-w-full rounded-2xl bg-zinc-900 text-white shadow-xs transition-colors dark:bg-surface-raised dark:text-foreground px-4 py-2.5">
                    <div className="flex w-full min-w-0 items-start gap-1.5">
                      <div
                        className={cn(
                          "min-w-0 flex-1 text-left",
                          needsUserBodyTruncate &&
                            !userMessageExpanded &&
                            "line-clamp-6 overflow-hidden",
                        )}
                      >
                        <UserMessageBody
                          text={displayedUserMessage.visibleText}
                          terminalContexts={terminalContexts}
                        />
                      </div>
                      {needsUserBodyTruncate ? (
                        <button
                          type="button"
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white dark:text-muted-foreground/60 dark:hover:bg-muted/80 dark:hover:text-foreground/80"
                          aria-expanded={userMessageExpanded}
                          aria-label={
                            userMessageExpanded ? "Collapse user message" : "Expand user message"
                          }
                          title={userMessageExpanded ? "Show less" : "Show full message"}
                          onClick={() => toggleUserMessageExpanded(messageId)}
                        >
                          <HugeiconsIcon
                            icon={
                              userMessageExpanded
                                ? __WorkLogCollapseHugeIcon
                                : __WorkLogExpandHugeIcon
                            }
                            className="size-3.5 stroke-[2.1]"
                          />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 px-1 pt-0.5 text-xs text-muted-foreground/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                  {row.message.createdAt ? (
                    <span className="select-none text-[11px] tabular-nums">
                      {formatMessageRelativeTime(row.message.createdAt)}
                    </span>
                  ) : null}
                  <div className="flex items-center gap-1">
                    {displayedUserMessage.copyText ? (
                      <MessageCopyButton text={displayedUserMessage.copyText} />
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="cursor-not-allowed p-0.5 text-muted-foreground/25"
                        aria-label="Copy not available"
                      >
                        <HugeiconsIcon icon={__CheckIconHugeIcon} className="size-3.5" />
                      </button>
                    )}
                    {canRevertAgentWork ? (
                      <button
                        type="button"
                        className="cursor-pointer p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/30"
                        disabled={isRevertingCheckpoint || isWorking}
                        onClick={() => onRevertUserMessage(row.message.id)}
                        title="Revert to this message"
                        aria-label="Revert to this message"
                      >
                        <HugeiconsIcon icon={__UndoIconHugeIcon} className="size-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="cursor-not-allowed p-0.5 text-muted-foreground/25"
                        aria-label="Revert not available"
                        title="No earlier checkpoint to revert to"
                      >
                        <HugeiconsIcon icon={__UndoIconHugeIcon} className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled
                      className="cursor-not-allowed p-0.5 text-muted-foreground/25"
                      title="Branch (coming soon)"
                      aria-label="Branch thread"
                    >
                      <HugeiconsIcon icon={__GitForkIconHugeIcon} className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {row.kind === "message" &&
        row.message.role === "assistant" &&
        (() => {
          const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)");
          return (
            <>
              <div className="group min-w-0 px-1 py-0.5">
                <ChatMarkdown
                  text={messageText}
                  cwd={markdownCwd}
                  isStreaming={Boolean(row.message.streaming)}
                  variant="timeline"
                />
                {(() => {
                  const turnSummary = turnDiffSummaryByAssistantMessageId.get(row.message.id);
                  if (!turnSummary) return null;
                  const checkpointFiles = turnSummary.files;
                  if (checkpointFiles.length === 0) return null;
                  const allDirectoriesExpanded =
                    allDirectoriesExpandedByTurnId[turnSummary.turnId] ?? true;
                  // Small, recent turns open themselves; anything larger stays
                  // collapsed behind the scope summary until asked for.
                  const expanded =
                    changedFilesExpandedByTurnId[turnSummary.turnId] ??
                    shouldAutoExpandChangedFiles(
                      checkpointFiles,
                      turnSummary.turnId === latestTurnDiffTurnId,
                    );
                  return (
                    <ChangedFilesCard
                      turnId={turnSummary.turnId}
                      files={checkpointFiles}
                      expanded={expanded}
                      allDirectoriesExpanded={allDirectoriesExpanded}
                      resolvedTheme={resolvedTheme}
                      onExpandedChange={(next) =>
                        onToggleChangedFilesExpanded(turnSummary.turnId, next)
                      }
                      onToggleAllDirectories={() => onToggleAllDirectories(turnSummary.turnId)}
                      onOpenTurnDiff={onOpenTurnDiff}
                    />
                  );
                })()}

                {!row.message.streaming && messageText && messageText !== "(empty response)" ? (
                  <div className="mt-1 flex items-center gap-3 px-1 py-1 text-[11px] text-muted-foreground/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                    <div className="flex items-center gap-1.5">
                      <MessageCopyButton text={row.message.text} />
                      <button
                        type="button"
                        disabled
                        className="cursor-not-allowed p-0.5 text-muted-foreground/25"
                        title="Branch (coming soon)"
                        aria-label="Branch thread"
                      >
                        <HugeiconsIcon icon={__GitForkIconHugeIcon} className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled
                        className="cursor-not-allowed p-0.5 text-muted-foreground/25"
                        title="Pin (coming soon)"
                        aria-label="Pin message"
                      >
                        <HugeiconsIcon icon={__PinIconHugeIcon} className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled
                        className="cursor-not-allowed p-0.5 text-muted-foreground/25"
                        title="Read aloud (coming soon)"
                        aria-label="Read aloud"
                      >
                        <HugeiconsIcon icon={__VolumeIconHugeIcon} className="size-3.5" />
                      </button>
                    </div>
                    {row.message.completedAt || row.message.createdAt ? (
                      <span className="select-none tabular-nums">
                        {formatMessageRelativeTime(row.message.completedAt ?? row.message.createdAt)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          );
        })()}

      {row.kind === "proposed-plan" && (
        <div className="min-w-0 px-1 py-0.5">
          <ProposedPlanCard
            planMarkdown={row.proposedPlan.planMarkdown}
            cwd={markdownCwd}
            workspaceRoot={workspaceRoot}
          />
        </div>
      )}

      {row.kind === "turn-status" && (
        <TurnStatusRow startedAtIso={row.startedAt} summary={row.summary} />
      )}
      {row.kind === "thinking" && <ThinkingIndicatorRow />}
    </div>
  );

  if (!hasMessages && !isWorking) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <Empty className="w-full max-w-md py-8">
          <EmptyHeader>
            <EmptyMedia className="h-auto w-auto rounded-none bg-transparent [&>svg]:h-7 [&>svg]:w-7 [&>svg]:text-muted-foreground">
              <EmptyAssistantIcon className="h-7 w-7" />
            </EmptyMedia>
            <EmptyTitle className="text-base font-medium">
              {t("assistant.chat.readyToAssist")}
            </EmptyTitle>
            <EmptyDescription>{t("assistant.chat.readyToAssistDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div
      ref={timelineRootRef}
      data-timeline-root="true"
      data-timeline-engine="legend-list"
      data-legend-list-recycle-items={recycleItems ? "true" : "false"}
      className="h-full min-h-0 w-full min-w-0 overflow-hidden"
    >
      <LegendList<TimelineRow>
        ref={legendListRef}
        refScrollView={scrollContainerRef}
        data={rows}
        dataVersion={dataVersion}
        extraData={legendListExtraData}
        renderItem={({ item: row }: LegendListRenderItemProps<TimelineRow>) => (
          <div key={`legend-row:${row.id}`}>{renderRowContent(row)}</div>
        )}
        keyExtractor={keyExtractor}
        itemsAreEqual={itemsAreEqual}
        getItemType={getItemType}
        estimatedItemSize={112}
        estimatedListSize={estimatedListSize}
        getEstimatedItemSize={getEstimatedItemSize}
        alwaysRender={{
          bottom: ALWAYS_UNVIRTUALIZED_TAIL_ROWS,
          keys: alwaysRenderKeys,
        }}
        drawDistance={LEGEND_LIST_DRAW_DISTANCE_PX}
        initialContainerPoolRatio={1}
        initialScrollAtEnd
        maintainScrollAtEnd={{
          animated: false,
          on: {
            dataChange: true,
            itemLayout: true,
            layout: true,
          },
        }}
        maintainScrollAtEndThreshold={maintainScrollAtEndThreshold}
        maintainVisibleContentPosition={{
          data: true,
          size: true,
          shouldRestorePosition: shouldRestoreVisiblePosition,
        }}
        recycleItems={recycleItems}
        onEndReached={() => {
          if (shouldLogLegendListDiagnostics()) {
            console.info("[LegendList][AgentTimeline] end-reached");
          }
        }}
        onEndReachedThreshold={0.2}
        onItemSizeChanged={onLegendListItemSizeChanged}
        onLoad={onLegendListLoad}
        onMetricsChange={onLegendListMetricsChange}
        onStartReached={() => {
          if (shouldLogLegendListDiagnostics()) {
            console.info("[LegendList][AgentTimeline] start-reached");
          }
        }}
        onStartReachedThreshold={0.2}
        onViewableItemsChanged={onLegendListViewableItemsChanged}
        className="app-scrollbar scroll-fade-y h-full min-h-0 w-full overflow-x-hidden overscroll-y-contain px-3 sm:px-5"
        contentContainerClassName="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden"
        contentContainerStyle={{
          paddingBottom: bottomPaddingPx,
          paddingTop: 16,
          transition: "padding-bottom 200ms ease-out",
        }}
        showsVerticalScrollIndicator={false}
      />
    </div>
  );
});

type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
type TimelineProposedPlan = Extract<TimelineEntry, { kind: "proposed-plan" }>["proposedPlan"];
type TimelineWorkEntry = Extract<TimelineEntry, { kind: "work" }>["entry"];
type TimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: TimelineWorkEntry[];
      /** Rendered bare inside an expanded group rather than as its own card. */
      isExpandedToolGroupEntry?: boolean;
      isLastExpandedToolGroupEntry?: boolean;
    }
  | {
      /** The tool currently running, kept visible while the rest collapse. */
      kind: "work-live";
      id: string;
      createdAt: string;
      entry: TimelineWorkEntry;
      groupedEntries: TimelineWorkEntry[];
      groupId: string;
      expanded: boolean;
    }
  | {
      /** Collapsed summary standing in for a finished run of tool calls. */
      kind: "work-toggle";
      id: string;
      createdAt: string;
      groupId: string;
      hiddenCount: number;
      expanded: boolean;
      summary: string;
      summaryKind: ToolGroupSummaryKind;
      hasFailure: boolean;
    }
  | {
      kind: "notices";
      id: string;
      createdAt: string;
      groupedEntries: TimelineWorkEntry[];
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: TimelineMessage;
      durationStart: string;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: TimelineProposedPlan;
    }
  | {
      kind: "turn-status";
      id: string;
      createdAt: string;
      startedAt: string | null;
      summary: string | null;
    }
  | {
      kind: "thinking";
      id: string;
      createdAt: string;
    };

function estimateTimelineProposedPlanHeight(proposedPlan: TimelineProposedPlan): number {
  const estimatedLines = Math.max(1, Math.ceil(proposedPlan.planMarkdown.length / 72));
  return 120 + Math.min(estimatedLines * 22, 880);
}

function estimateTimelineRowHeight(row: TimelineRow, timelineWidthPx: number | null): number {
  switch (row.kind) {
    case "work": {
      const entriesHeight = row.groupedEntries.reduce(
        (total, entry) => total + estimateWorkEntryHeight(entry),
        0,
      );
      // Entries inside an expanded group render bare, without the card chrome.
      if (row.isExpandedToolGroupEntry) return entriesHeight;
      const hasOverflow = row.groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
      const overflowHeaderHeight = hasOverflow ? 24 : 0;
      const variableHeight = hasOverflow ? 160 : entriesHeight;
      return 24 + overflowHeaderHeight + variableHeight;
    }
    case "work-live":
      return 24 + estimateWorkEntryHeight(row.entry);
    case "work-toggle":
      // Single collapsed line; measurement corrects it once mounted.
      return 32;
    case "notices":
      // Collapsed single line; expanded height is corrected by measurement.
      return 28;
    case "message":
      return estimateTimelineMessageHeight(row.message, { timelineWidthPx });
    case "proposed-plan":
      return estimateTimelineProposedPlanHeight(row.proposedPlan);
    case "turn-status":
      return 40;
    case "thinking":
      return 32;
  }
}

function areTimelineRowsEquivalent(previousRow: TimelineRow, nextRow: TimelineRow): boolean {
  if (previousRow.kind !== nextRow.kind || previousRow.id !== nextRow.id) {
    return false;
  }

  if (previousRow.kind === "work" && nextRow.kind === "work") {
    if (previousRow.groupedEntries.length !== nextRow.groupedEntries.length) {
      return false;
    }
    const previousLastEntry = previousRow.groupedEntries.at(-1);
    const nextLastEntry = nextRow.groupedEntries.at(-1);
    return (
      previousRow.createdAt === nextRow.createdAt &&
      previousLastEntry?.id === nextLastEntry?.id &&
      previousLastEntry?.label === nextLastEntry?.label &&
      previousLastEntry?.detail === nextLastEntry?.detail &&
      previousLastEntry?.command === nextLastEntry?.command &&
      previousLastEntry?.tone === nextLastEntry?.tone
    );
  }

  if (previousRow.kind === "work-live" && nextRow.kind === "work-live") {
    return (
      previousRow.createdAt === nextRow.createdAt &&
      previousRow.expanded === nextRow.expanded &&
      previousRow.groupedEntries.length === nextRow.groupedEntries.length &&
      previousRow.entry.id === nextRow.entry.id &&
      previousRow.entry.label === nextRow.entry.label &&
      previousRow.entry.detail === nextRow.entry.detail &&
      previousRow.entry.command === nextRow.entry.command &&
      previousRow.entry.tone === nextRow.entry.tone &&
      previousRow.entry.status === nextRow.entry.status
    );
  }

  if (previousRow.kind === "work-toggle" && nextRow.kind === "work-toggle") {
    return (
      previousRow.createdAt === nextRow.createdAt &&
      previousRow.expanded === nextRow.expanded &&
      previousRow.hiddenCount === nextRow.hiddenCount &&
      previousRow.summary === nextRow.summary &&
      previousRow.summaryKind === nextRow.summaryKind &&
      previousRow.hasFailure === nextRow.hasFailure
    );
  }

  if (previousRow.kind === "notices" && nextRow.kind === "notices") {
    return (
      previousRow.createdAt === nextRow.createdAt &&
      previousRow.groupedEntries.length === nextRow.groupedEntries.length &&
      previousRow.groupedEntries.at(-1)?.id === nextRow.groupedEntries.at(-1)?.id
    );
  }

  if (previousRow.kind === "message" && nextRow.kind === "message") {
    return (
      previousRow.createdAt === nextRow.createdAt &&
      previousRow.durationStart === nextRow.durationStart &&
      previousRow.message.id === nextRow.message.id &&
      previousRow.message.role === nextRow.message.role &&
      previousRow.message.text === nextRow.message.text &&
      previousRow.message.streaming === nextRow.message.streaming &&
      (previousRow.message.attachments?.length ?? 0) === (nextRow.message.attachments?.length ?? 0)
    );
  }

  if (previousRow.kind === "proposed-plan" && nextRow.kind === "proposed-plan") {
    return (
      previousRow.createdAt === nextRow.createdAt &&
      previousRow.proposedPlan.planMarkdown === nextRow.proposedPlan.planMarkdown
    );
  }

  if (previousRow.kind === "turn-status" && nextRow.kind === "turn-status") {
    return (
      previousRow.createdAt === nextRow.createdAt &&
      previousRow.startedAt === nextRow.startedAt &&
      previousRow.summary === nextRow.summary
    );
  }

  if (previousRow.kind === "thinking" && nextRow.kind === "thinking") {
    return true;
  }

  return false;
}

function formatLiveElapsed(startIso: string, nowMs: number): string | null {
  const startedAtMs = Date.parse(startIso);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }
  return formatDuration(Math.max(0, nowMs - startedAtMs));
}

const WorkingTimer = memo(function WorkingTimer(props: { startedAtIso: string }) {
  const textRef = useRef<HTMLSpanElement | null>(null);
  const initialText = formatLiveElapsed(props.startedAtIso, Date.now());

  useEffect(() => {
    const updateText = () => {
      if (textRef.current) {
        textRef.current.textContent = formatLiveElapsed(props.startedAtIso, Date.now()) ?? "";
      }
    };
    updateText();
    const intervalId = window.setInterval(updateText, 1_000);
    return () => window.clearInterval(intervalId);
  }, [props.startedAtIso]);

  return <span ref={textRef}>{initialText}</span>;
});

const LiveShimmerText = memo(function LiveShimmerText(props: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("cozea-live-shimmer relative inline-block max-w-full overflow-hidden", props.className)}>
      <span className="text-muted-foreground/75">{props.children}</span>
      <span aria-hidden className="cozea-live-shimmer-focus pointer-events-none absolute inset-y-0 select-none">
        <span className="cozea-live-shimmer-counter block">
          <span className="cozea-live-shimmer-aligned block text-foreground">{props.children}</span>
        </span>
      </span>
    </span>
  );
});

const TurnStatusRow = memo(function TurnStatusRow(props: {
  startedAtIso: string | null;
  summary: string | null;
}) {
  const { startedAtIso, summary } = props;
  const isActive = summary === null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-assistant-turn-status={isActive ? "working" : "worked"}
    >
      <div className="flex min-h-8 items-baseline gap-1 border-b border-border/60 px-1 pb-2 pt-1 text-sm leading-relaxed tabular-nums">
        {isActive ? <LiveShimmerText>Working</LiveShimmerText> : null}
        {isActive && startedAtIso ? (
          <>
            <span className="text-muted-foreground/75">for</span>
            <span className="text-muted-foreground/75">
              <WorkingTimer startedAtIso={startedAtIso} />
            </span>
          </>
        ) : null}
        {summary ? <span className="font-medium text-muted-foreground/88">{summary}</span> : null}
      </div>
    </div>
  );
});

const ThinkingIndicatorRow = memo(function ThinkingIndicatorRow() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-7 px-1 py-0.5 text-sm leading-relaxed"
      data-assistant-generation-phase="thinking"
    >
      <LiveShimmerText>Thinking</LiveShimmerText>
    </div>
  );
});

function estimateWorkEntryHeight(workEntry: TimelineWorkEntry): number {
  let height = 28;
  const changedFileCount = workEntry.changedFiles?.length ?? 0;
  const persistedFileCount =
    (workEntry.savedFiles?.length ?? 0) + (workEntry.failedFiles?.length ?? 0);
  if (changedFileCount > 0) {
    height += workEntry.activityKind === "files.persisted" ? 28 : 20;
  }
  if (persistedFileCount > 3) {
    height += 18;
  }
  if (workEntry.status === "cancelled" || workEntry.status === "failed") {
    height += 4;
  }
  return height;
}

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
  },
);

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
}) {
  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context.header);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            <span key={`user-terminal-context-inline-before:${context.header}:${cursor}`}>
              {props.text.slice(cursor, matchIndex)}
            </span>,
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            <span key={`user-message-terminal-context-inline-rest:${cursor}`}>
              {props.text.slice(cursor)}
            </span>,
          );
        }

        return (
          <div className="wrap-break-word whitespace-pre-wrap text-xs leading-normal text-inherit">
            {inlineNodes}
          </div>
        );
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(<span key="user-message-terminal-context-inline-text">{props.text}</span>);
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return (
      <div className="wrap-break-word whitespace-pre-wrap text-xs leading-normal text-inherit">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <div className="wrap-break-word whitespace-pre-wrap text-xs leading-normal text-inherit">
      {props.text}
    </div>
  );
});

function workToneIcon(
  tone: TimelineWorkEntry["tone"],
  status?: TimelineWorkEntry["status"],
): {
  icon: LucideIcon;
  className: string;
} {
  if (status === "failed") {
    return {
      icon: CircleAlertIcon,
      className: "text-destructive",
    };
  }
  if (tone === "error") {
    return {
      icon: CircleAlertIcon,
      className: "text-destructive",
    };
  }
  if (tone === "thinking") {
    return {
      icon: BotIcon,
      className: "text-foreground/92",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "text-foreground/92",
    };
  }
  return {
    icon: ZapIcon,
    className: "text-foreground/92",
  };
}

function workEntryPreview(
  workEntry: Pick<TimelineWorkEntry, "detail" | "command" | "changedFiles">,
  workspaceRoot: string | undefined,
) {
  if (workEntry.command) return workEntry.command;
  if (workEntry.detail) return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  const displayPath = formatWorkspaceRelativePath(firstPath, workspaceRoot);
  return workEntry.changedFiles!.length === 1
    ? displayPath
    : `${displayPath} +${workEntry.changedFiles!.length - 1} more`;
}

function normalizePathLikeValue(value: string): string {
  return value.trim().replace(/\\/g, "/");
}

function workEntryPreviewDuplicatesSingleChangedFile(
  workEntry: Pick<TimelineWorkEntry, "changedFiles">,
  preview: string | null,
  workspaceRoot: string | undefined,
): boolean {
  if (!preview) return false;
  if ((workEntry.changedFiles?.length ?? 0) !== 1) return false;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return false;
  const displayPath = formatWorkspaceRelativePath(firstPath, workspaceRoot);
  const normalizedPreview = normalizePathLikeValue(preview);
  return (
    normalizedPreview === normalizePathLikeValue(firstPath) ||
    normalizedPreview === normalizePathLikeValue(displayPath)
  );
}

function workEntryRawCommand(
  workEntry: Pick<TimelineWorkEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

/**
 * A running command is described by the program it invokes ("Running bun"),
 * which stays readable where the full command line does not. Falls back to the
 * normal preview when the command cannot be parsed confidently.
 */
function liveWorkEntryLabel(
  workEntry: TimelineWorkEntry,
  workspaceRoot: string | undefined,
): string {
  const command = workEntry.command?.trim();
  if (command) {
    const program = commandProgramName(command);
    return program ? `Running ${program}` : "Running command";
  }
  return workEntryPreview(workEntry, workspaceRoot) ?? toolWorkEntryHeading(workEntry);
}

function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (workEntry.status === "failed") return CircleAlertIcon;
  if (workEntry.requestKind === "command") return TerminalIcon;
  if (workEntry.requestKind === "file-read") return EyeIcon;
  if (workEntry.requestKind === "file-change") return SquarePenIcon;

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return TerminalIcon;
  }
  if (workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return SquarePenIcon;
  }
  if (workEntry.itemType === "web_search") return GlobeIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;
  if (workEntry.itemType === "image_generation") return ImageIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return WrenchIcon;
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return HammerIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

function isRunningWorkEntry(
  workEntry: Pick<TimelineWorkEntry, "activityKind" | "status">,
): boolean {
  return workEntry.activityKind === "tool.progress" || workEntry.status === "inProgress";
}

function isCommandLikeWorkEntry(
  workEntry: Pick<TimelineWorkEntry, "requestKind" | "itemType" | "command">,
): boolean {
  return (
    workEntry.requestKind === "command" ||
    workEntry.itemType === "command_execution" ||
    Boolean(workEntry.command)
  );
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  if (isCommandLikeWorkEntry(workEntry)) {
    if (isRunningWorkEntry(workEntry)) return "Running command";
    if (workEntry.status === "failed") return "Command failed";
    return "Ran command";
  }
  if (workEntry.status === "failed") {
    if (!workEntry.toolTitle) {
      return `Failed to ${normalizeCompactToolLabel(workEntry.label).toLowerCase()}`;
    }
    return `Failed to ${normalizeCompactToolLabel(workEntry.toolTitle).toLowerCase()}`;
  }
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

/**
 * Session diagnostics that should not interrupt the conversation flow: they
 * fold into a quiet collapsed "agent notices" row instead of inline error
 * entries. Turn failures surface through the thread error state, not these.
 */
function isDiagnosticWorkEntry(workEntry: TimelineWorkEntry): boolean {
  return (
    workEntry.activityKind === "runtime.error" ||
    workEntry.activityKind === "runtime.warning" ||
    workEntry.activityKind === "config.warning" ||
    workEntry.activityKind === "deprecation.notice"
  );
}

function workEntryStatusBadge(workEntry: TimelineWorkEntry): {
  label: string;
  className: string;
} | null {
  if (workEntry.status === "cancelled") {
    return {
      label: "Cancelled",
      className: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (
    workEntry.activityKind === "runtime.warning" ||
    workEntry.activityKind === "config.warning" ||
    workEntry.activityKind === "deprecation.notice"
  ) {
    return {
      label: "Warning",
      className: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (workEntry.activityKind === "runtime.error") {
    return {
      label: "Error",
      className: "border-destructive/35 bg-destructive/10 text-destructive",
    };
  }
  if (workEntry.activityKind === "model.rerouted") {
    return {
      label: "Rerouted",
      className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    };
  }
  if (isRunningWorkEntry(workEntry) && !isCommandLikeWorkEntry(workEntry)) {
    return null;
  }
  return null;
}

function sameDisplayedText(left: string, right: string): boolean {
  return left.replace(/\s+/gu, " ").trim() === right.replace(/\s+/gu, " ").trim();
}

/**
 * Content for the expanded row, or null when there is nothing to add.
 *
 * A row only earns an expand control when it can show something the collapsed
 * row does not already say. Echoing the command or path back at the reader is
 * not worth a chevron.
 */
function buildWorkEntryExpandedBody(
  workEntry: TimelineWorkEntry,
  workspaceRoot: string | undefined,
  options: {
    /** Text already visible on the collapsed row. */
    readonly displayedText: string;
    /** Changed files already listed as chips beneath the row. */
    readonly changedFilesVisible: boolean;
    /** Detail was a raw `Tool: {json}` payload that the row replaced. */
    readonly detailIsRawPayload: boolean;
  },
): string | null {
  const blocks: string[] = [];
  const alreadyShown = (value: string) => sameDisplayedText(value, options.displayedText);

  // An MCP call is otherwise opaque: the row shows only the tool name, so the
  // structured payload is genuinely additional.
  if (workEntry.itemType === "mcp_tool_call" && workEntry.toolData !== undefined) {
    try {
      blocks.push(`MCP call\n${JSON.stringify(workEntry.toolData, null, 2)}`);
    } catch {
      // Cyclic or non-serializable payloads simply do not get a block.
    }
  }

  // Worth showing only when it differs from the command on the row — a wrapper
  // like `env -C /repo bun test` displayed as `bun test`.
  const rawCommand = workEntryRawCommand(workEntry);
  if (rawCommand && !alreadyShown(rawCommand)) {
    blocks.push(rawCommand);
  }

  // Raw tool payloads are never re-shown: the row already renders what they mean.
  if (!options.detailIsRawPayload) {
    const detail = workEntry.detail?.trim();
    if (detail && !alreadyShown(detail) && detail !== rawCommand) {
      blocks.push(detail);
    }
  }

  if (!options.changedFilesVisible && (workEntry.changedFiles?.length ?? 0) > 0) {
    const paths = workEntry
      .changedFiles!.map((filePath) => formatWorkspaceRelativePath(filePath, workspaceRoot))
      .join("\n");
    if (!alreadyShown(paths)) blocks.push(paths);
  }

  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
  artifactUrl?: string;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenTurnDiff?: (turnId: TurnId, filePath?: string) => void;
}) {
  const { workEntry, workspaceRoot, resolvedTheme, artifactUrl, onOpenArtifact, onOpenTurnDiff } =
    props;
  const [expanded, setExpanded] = useState(false);
  const iconConfig = workToneIcon(workEntry.tone, workEntry.status);
  const EntryIcon = workEntryIcon(workEntry);
  const isLive = isRunningWorkEntry(workEntry);
  const isCommand = isCommandLikeWorkEntry(workEntry);
  // Adapters that only label rows by category ("Tool call") hide the real tool
  // name and its arguments inside the detail string. Recover them so the row
  // reads "Read file · Component.tsx" instead of a line of JSON.
  const normalizedPresentation = normalizeToolRowPresentation({
    title: workEntry.toolTitle,
    detail: workEntry.detail,
    changedFiles: workEntry.changedFiles,
  });
  const heading = normalizedPresentation?.heading ?? toolWorkEntryHeading(workEntry);
  // Already a basename for file work; the full path rides along for the tooltip.
  const rawPreview = normalizedPresentation
    ? (normalizedPresentation.detail ?? null)
    : workEntryPreview(workEntry, workspaceRoot);
  const preview =
    rawPreview &&
    normalizeCompactToolLabel(rawPreview).toLowerCase() ===
      normalizeCompactToolLabel(heading).toLowerCase()
      ? null
      : rawPreview;
  const rawCommand = workEntryRawCommand(workEntry);
  const statusBadge = workEntryStatusBadge(workEntry);
  const displayText = isLive
    ? // A running row names the program rather than echoing the command line.
      liveWorkEntryLabel(workEntry, workspaceRoot)
    : isCommand && workEntry.status !== "failed" && preview
      ? preview
      : preview
        ? `${heading} — ${preview}`
        : heading;
  const hasChangedFiles = (workEntry.changedFiles?.length ?? 0) > 0;
  const hasPersistedFileGroups =
    (workEntry.savedFiles?.length ?? 0) > 0 || (workEntry.failedFiles?.length ?? 0) > 0;
  const previewIsChangedFiles = hasChangedFiles && !workEntry.command && !workEntry.detail;
  const duplicateChangedFileDisplay = workEntryPreviewDuplicatesSingleChangedFile(
    workEntry,
    preview,
    workspaceRoot,
  );
  // Mirrors the chip-rendering condition below, so the body does not repeat
  // files the row already lists.
  const changedFilesVisible =
    hasChangedFiles && !previewIsChangedFiles && !duplicateChangedFileDisplay;
  const expandedBody = buildWorkEntryExpandedBody(workEntry, workspaceRoot, {
    displayedText: [heading, rawPreview].filter(Boolean).join(" "),
    changedFilesVisible,
    detailIsRawPayload: normalizedPresentation !== null,
  });
  const canExpand = expandedBody !== null;

  return (
    <div className="rounded-lg px-1 py-1">
      <div
        className={cn(
          "group/work-row flex items-center gap-2 rounded-md transition-[background-color,opacity,translate] duration-200",
          canExpand &&
            "cursor-pointer hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        )}
        role={canExpand ? "button" : undefined}
        tabIndex={canExpand ? 0 : undefined}
        aria-expanded={canExpand ? expanded : undefined}
        aria-label={displayText}
        onClick={canExpand ? () => setExpanded((current) => !current) : undefined}
        onKeyDown={
          canExpand
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setExpanded((current) => !current);
                }
              }
            : undefined
        }
      >
        <span
          className={cn("flex size-5 shrink-0 items-center justify-center", iconConfig.className)}
          data-tool-icon={isCommand ? "terminal" : (workEntry.itemType ?? workEntry.requestKind)}
        >
          <EntryIcon className="size-3.5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <p
            className={cn(
              "truncate text-[11px] leading-5",
              workEntry.status === "failed"
                ? "text-destructive"
                : "text-muted-foreground/75",
              isCommand && "font-mono",
            )}
            title={normalizedPresentation?.path ?? rawCommand ?? displayText}
          >
            {isLive ? (
              <LiveShimmerText className="w-full truncate">{displayText}</LiveShimmerText>
            ) : normalizedPresentation ? (
              // Verb stays muted; the file or command it acted on is what the
              // eye should land on.
              <>
                <span>{normalizedPresentation.heading}</span>
                {rawPreview ? (
                  <span className="ml-1.5 text-foreground/85">{rawPreview}</span>
                ) : null}
              </>
            ) : (
              displayText
            )}
          </p>
          {normalizedPresentation?.stat &&
          hasNonZeroStat(normalizedPresentation.stat) &&
          !isLive ? (
            <span className="shrink-0 font-mono text-[10px] tabular-nums">
              <DiffStatLabel
                additions={normalizedPresentation.stat.additions}
                deletions={normalizedPresentation.stat.deletions}
              />
            </span>
          ) : null}
          {canExpand ? (
            <HugeiconsIcon
              icon={__WorkLogExpandHugeIcon}
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/55 transition-[transform,opacity] duration-200",
                // Quiet until the row is hovered or focused; an expanded row
                // keeps it visible so the control that opened it stays put.
                expanded
                  ? "rotate-180 opacity-100"
                  : "opacity-0 group-hover/work-row:opacity-100 group-focus-visible/work-row:opacity-100",
              )}
              aria-hidden="true"
            />
          ) : null}
          <span className="min-w-0 flex-1" aria-hidden="true" />
        </div>
        {statusBadge ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[9px] font-medium leading-4",
              statusBadge.className,
            )}
          >
            {statusBadge.label}
          </span>
        ) : null}
      </div>
      {workEntry.itemType === "image_generation" && artifactUrl && workEntry.toolCallId ? (
        <button
          type="button"
          className="ml-7 mt-1.5 block h-20 w-28 overflow-hidden rounded-md border border-border/60 bg-secondary/30 transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpenArtifact?.(workEntry.toolCallId!)}
          aria-label={`Open ${heading} in artifacts`}
        >
          <img src={artifactUrl} alt={heading} className="h-full w-full object-cover" />
        </button>
      ) : null}
      {expanded && expandedBody ? (
        <div className="mt-1 ml-7 border-l border-border/45 pl-3 pt-0.5">
          <pre className="max-h-64 cursor-text overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground/75 select-text">
            {expandedBody}
          </pre>
        </div>
      ) : null}
      {hasPersistedFileGroups ? (
        <PersistedFilesList
          savedFiles={workEntry.savedFiles}
          failedFiles={workEntry.failedFiles}
          workspaceRoot={workspaceRoot}
          resolvedTheme={resolvedTheme}
        />
      ) : hasChangedFiles && !previewIsChangedFiles && !duplicateChangedFileDisplay ? (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-6">
          {workEntry.changedFiles?.slice(0, CHANGED_FILES_PREVIEW_FILE_LIMIT).map((filePath) => {
            const displayPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
            // The chip shows the basename; the full path lives in the tooltip so
            // a row of chips stays scannable instead of a wall of directories.
            const fileName = changedFileName(displayPath);
            const turnId = workEntry.turnId;
            const canOpenDiff = Boolean(onOpenTurnDiff && turnId);
            const chipClassName = cn(
              "inline-flex max-w-48 items-center gap-1 rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/75",
              canOpenDiff &&
                "cursor-pointer transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            );
            const chipContent = (
              <>
                <VscodeEntryIcon
                  pathValue={displayPath}
                  kind="file"
                  theme={resolvedTheme}
                  className="size-3 shrink-0"
                />
                <span className="truncate">{fileName}</span>
              </>
            );
            return canOpenDiff ? (
              <button
                key={`${workEntry.id}:${filePath}`}
                type="button"
                className={chipClassName}
                title={displayPath}
                aria-label={`Open diff for ${displayPath}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenTurnDiff?.(turnId!, filePath);
                }}
              >
                {chipContent}
              </button>
            ) : (
              <span
                key={`${workEntry.id}:${filePath}`}
                className={chipClassName}
                title={displayPath}
              >
                {chipContent}
              </span>
            );
          })}
          {(workEntry.changedFiles?.length ?? 0) > CHANGED_FILES_PREVIEW_FILE_LIMIT && (
            <span className="px-1 text-[10px] text-muted-foreground/55">
              +{(workEntry.changedFiles?.length ?? 0) - CHANGED_FILES_PREVIEW_FILE_LIMIT}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
});

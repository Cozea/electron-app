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
  Globe02Icon as __GlobeIconHugeIcon,
  HammerIcon as __HammerIconHugeIcon,
  Wrench01Icon as __WrenchIconHugeIcon,
  Image01Icon as __ImageIconHugeIcon,
} from "@hugeicons/core-free-icons";
import { deriveTimelineEntries, formatDuration } from "./session-logic";
import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX } from "./chat-scroll";
import { type TurnDiffSummary } from "@/stores/types";
import { summarizeTurnDiffStats } from "./turnDiffTree";
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
import { Button } from "@/components/ui/button";
import { formatWorkspaceRelativePath } from "@/lib/filePathDisplay";
import { estimateTimelineMessageHeight } from "./timelineHeight";
import { buildExpandedImagePreview } from "./ExpandedImagePreview";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { ChangedFilesTree } from "./ChangedFilesTree";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  computeMessageDurationStart,
  deriveTurnHeaderIndex,
  normalizeCompactToolLabel,
  type GenerationStatusPhase,
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

const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;
const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 8;
/** Long user bubbles: collapse with expand control (same pattern as work log overflow). */
const USER_MESSAGE_TRUNCATE_CHAR_THRESHOLD = 420;
const USER_MESSAGE_TRUNCATE_NEWLINE_THRESHOLD = 10;

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
        // Session diagnostics (runtime/config warnings, non-fatal provider
        // errors) fold into quiet collapsed "notices" rows instead of red
        // entries inline with the turn's work; turn failures surface through
        // the thread error state, not these activities. Order is preserved by
        // splitting the run into consecutive same-kind segments.
        let segmentStart = 0;
        for (let cut = 1; cut <= groupedEntries.length; cut += 1) {
          const boundary =
            cut === groupedEntries.length ||
            isDiagnosticWorkEntry(groupedEntries[cut]!) !==
              isDiagnosticWorkEntry(groupedEntries[segmentStart]!);
          if (!boundary) continue;
          const segment = groupedEntries.slice(segmentStart, cut);
          const first = segment[0]!;
          nextRows.push({
            kind: isDiagnosticWorkEntry(first) ? "notices" : "work",
            id: segmentStart === 0 ? timelineEntry.id : `${timelineEntry.id}:${segmentStart}`,
            createdAt: first.createdAt ?? timelineEntry.createdAt,
            groupedEntries: segment,
          });
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
      completionSummaryVersion: [...completionSummariesByMessageId.entries()]
        .map(([messageId, summary]) => `${messageId}:${summary}`)
        .join("|"),
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
          const isExpanded = expandedWorkGroups[groupId] ?? false;
          const hasOverflow = groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
          const onlyToolEntries = groupedEntries.every((entry) => entry.tone === "tool");
          const showHeader = hasOverflow || !onlyToolEntries;

          return (
            <div className="rounded-xl border border-border/45 bg-card/25 px-2 py-1.5">
              {showHeader && (
                <div className="mb-1.5 flex items-center justify-between gap-2 -mx-1 -mt-0.5">
                  <p
                    className="inline-flex min-h-5 shrink-0 items-center justify-center rounded-full bg-muted/90 px-2.5 py-1 text-sm font-medium tabular-nums leading-none text-muted-foreground"
                    aria-label={
                      onlyToolEntries
                        ? `${groupedEntries.length} tool calls`
                        : `${groupedEntries.length} work log entries`
                    }
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
                  />
                ))}
              </div>
            </div>
          );
        })()}

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
            <div className="w-full min-w-0">
              <div className="group flex w-full min-w-0 flex-col gap-1">
                {userImages.length > 0 && (
                  <div className="mb-1 flex w-full flex-wrap justify-end gap-2 pl-12">
                    {userImages.map(
                      (image: NonNullable<TimelineMessage["attachments"]>[number]) => {
                        const isFailed = failedImageIds.has(image.id);
                        return (
                          <div
                            key={image.id}
                            className="relative overflow-hidden rounded-md border border-border/40 bg-transparent h-24 w-32 shrink-0"
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
                  <div className="relative w-full min-w-0 rounded-md bg-surface-raised px-3.5 py-2.5">
                    <div className="flex w-full min-w-0 items-start gap-1">
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
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted/80 hover:text-foreground/80"
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
                    <div className="absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
                      {displayedUserMessage.copyText && (
                        <MessageCopyButton text={displayedUserMessage.copyText} />
                      )}
                      {canRevertAgentWork && (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="rounded-md border border-transparent bg-secondary/80 text-muted-foreground hover:bg-accent hover:text-foreground"
                          disabled={isRevertingCheckpoint || isWorking}
                          onClick={() => onRevertUserMessage(row.message.id)}
                          title="Revert to this message"
                          aria-label="Revert to this message"
                        >
                          <HugeiconsIcon icon={__Undo2IconHugeIcon} className="size-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {!(
                  displayedUserMessage.visibleText.trim().length > 0 || terminalContexts.length > 0
                ) &&
                  canRevertAgentWork && (
                    <div className="mt-0.5 flex w-full min-w-0 items-center justify-end gap-2 px-1">
                      <div className="flex items-center gap-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="rounded-md border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                          disabled={isRevertingCheckpoint || isWorking}
                          onClick={() => onRevertUserMessage(row.message.id)}
                          title="Revert to this message"
                          aria-label="Revert to this message"
                        >
                          <HugeiconsIcon icon={__Undo2IconHugeIcon} className="size-3" />
                        </Button>
                      </div>
                    </div>
                  )}
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
              <div className="min-w-0 px-1 py-0.5">
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
                  const summaryStat = summarizeTurnDiffStats(checkpointFiles);
                  const changedFileCountLabel = String(checkpointFiles.length);
                  const allDirectoriesExpanded =
                    allDirectoriesExpandedByTurnId[turnSummary.turnId] ?? true;
                  return (
                    <div className="mt-2 rounded-lg bg-secondary p-2.5">
                      <div className="group mb-2 flex items-center justify-between gap-2 pr-2 pl-1.5 pt-1">
                        <div className="flex items-center gap-2 text-[11px] font-normal text-muted-foreground/60">
                          <span>Changed files</span>
                          <span className="inline-flex size-[18px] items-center justify-center rounded-full bg-border/40 text-[10px] font-medium normal-case tracking-normal tabular-nums text-foreground/70">
                            {changedFileCountLabel}
                          </span>
                          <button
                            type="button"
                            className="flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                            onClick={() => onToggleAllDirectories(turnSummary.turnId)}
                            title={allDirectoriesExpanded ? "Collapse all" : "Expand all"}
                            aria-label={allDirectoriesExpanded ? "Collapse all" : "Expand all"}
                          >
                            <HugeiconsIcon icon={__ChevronsUpDownHugeIcon} className="size-3.5" />
                          </button>
                        </div>
                        {hasNonZeroStat(summaryStat) && (
                          <div className="font-mono text-[10px] tabular-nums">
                            <DiffStatLabel
                              additions={summaryStat.additions}
                              deletions={summaryStat.deletions}
                            />
                          </div>
                        )}
                      </div>
                      <ChangedFilesTree
                        key={`changed-files-tree:${turnSummary.turnId}`}
                        turnId={turnSummary.turnId}
                        files={checkpointFiles}
                        allDirectoriesExpanded={allDirectoriesExpanded}
                        resolvedTheme={resolvedTheme}
                        onOpenTurnDiff={onOpenTurnDiff}
                      />
                    </div>
                  );
                })()}
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
        className="app-scrollbar h-full min-h-0 w-full overflow-x-hidden overscroll-y-contain px-3 sm:px-5"
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
      const hasOverflow = row.groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
      const overflowHeaderHeight = hasOverflow ? 24 : 0;
      const variableHeight = hasOverflow
        ? 160
        : row.groupedEntries.reduce((total, entry) => total + estimateWorkEntryHeight(entry), 0);
      return 24 + overflowHeaderHeight + variableHeight;
    }
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
          <div className="wrap-break-word whitespace-pre-wrap text-xs leading-normal text-foreground">
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
      <div className="wrap-break-word whitespace-pre-wrap text-xs leading-normal text-foreground">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <div className="wrap-break-word whitespace-pre-wrap text-xs leading-normal text-foreground">
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

function buildWorkEntryExpandedBody(
  workEntry: TimelineWorkEntry,
  workspaceRoot: string | undefined,
): string | null {
  const blocks: string[] = [];
  const command = workEntryRawCommand(workEntry) ?? workEntry.command?.trim() ?? null;
  if (command) blocks.push(command);
  const detail = workEntry.detail?.trim();
  if (detail && detail !== command) blocks.push(detail);
  if ((workEntry.changedFiles?.length ?? 0) > 0) {
    blocks.push(
      workEntry
        .changedFiles!.map((filePath) => formatWorkspaceRelativePath(filePath, workspaceRoot))
        .join("\n"),
    );
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
  artifactUrl?: string;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const { workEntry, workspaceRoot, resolvedTheme, artifactUrl, onOpenArtifact } = props;
  const [expanded, setExpanded] = useState(false);
  const iconConfig = workToneIcon(workEntry.tone, workEntry.status);
  const EntryIcon = workEntryIcon(workEntry);
  const isLive = isRunningWorkEntry(workEntry);
  const isCommand = isCommandLikeWorkEntry(workEntry);
  const heading = toolWorkEntryHeading(workEntry);
  const rawPreview = workEntryPreview(workEntry, workspaceRoot);
  const preview =
    rawPreview &&
    normalizeCompactToolLabel(rawPreview).toLowerCase() ===
      normalizeCompactToolLabel(heading).toLowerCase()
      ? null
      : rawPreview;
  const rawCommand = workEntryRawCommand(workEntry);
  const statusBadge = workEntryStatusBadge(workEntry);
  const displayText =
    isCommand && !isLive && workEntry.status !== "failed" && preview
      ? preview
      : preview
        ? `${heading} — ${preview}`
        : heading;
  const expandedBody = buildWorkEntryExpandedBody(workEntry, workspaceRoot);
  const canExpand = expandedBody !== null;
  const hasChangedFiles = (workEntry.changedFiles?.length ?? 0) > 0;
  const hasPersistedFileGroups =
    (workEntry.savedFiles?.length ?? 0) > 0 || (workEntry.failedFiles?.length ?? 0) > 0;
  const previewIsChangedFiles = hasChangedFiles && !workEntry.command && !workEntry.detail;
  const duplicateChangedFileDisplay = workEntryPreviewDuplicatesSingleChangedFile(
    workEntry,
    preview,
    workspaceRoot,
  );

  return (
    <div className="rounded-lg px-1 py-1">
      <div
        className={cn(
          "flex items-center gap-2 rounded-md transition-[background-color,opacity,translate] duration-200",
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
        <div className="min-w-0 flex-1 overflow-hidden">
          <p
            className={cn(
              "truncate text-[11px] leading-5",
              workEntry.status === "failed"
                ? "text-destructive"
                : "text-muted-foreground/75",
              isCommand && "font-mono",
            )}
            title={rawCommand ?? displayText}
          >
            {isLive ? <LiveShimmerText className="w-full truncate">{displayText}</LiveShimmerText> : displayText}
          </p>
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
        {canExpand ? (
          <HugeiconsIcon
            icon={__WorkLogExpandHugeIcon}
            className={cn(
              "mr-1 size-3.5 shrink-0 text-muted-foreground/55 transition-transform duration-200",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
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
        <div className="mt-1 flex flex-wrap gap-1 pl-6">
          {workEntry.changedFiles?.slice(0, 4).map((filePath) => {
            const displayPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
            return (
              <span
                key={`${workEntry.id}:${filePath}`}
                className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/75"
                title={displayPath}
              >
                {displayPath}
              </span>
            );
          })}
          {(workEntry.changedFiles?.length ?? 0) > 4 && (
            <span className="px-1 text-[10px] text-muted-foreground/55">
              +{(workEntry.changedFiles?.length ?? 0) - 4}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
});

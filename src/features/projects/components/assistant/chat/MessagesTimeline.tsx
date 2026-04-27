// @ts-nocheck
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
} from "react";
import {
  LegendList,
  type LegendListMetrics,
  type LegendListRef,
  type LegendListRenderItemProps,
  type OnViewableItemsChangedInfo,
} from "@legendapp/list/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon as __CircleAlertIconHugeIcon, ArrowDown01Icon as __WorkLogExpandHugeIcon, ArrowDownLeft01Icon as __Undo2IconHugeIcon, ArrowLeftRightIcon as __MessageSquareIconHugeIcon, ArrowUp01Icon as __WorkLogCollapseHugeIcon, ArrowUpDownIcon as __ChevronsUpDownHugeIcon, CheckmarkCircle02Icon as __CheckIconHugeIcon, CommandLineIcon as __TerminalIconHugeIcon, CpuChargeIcon as __BotIconHugeIcon, Edit01Icon as __SquarePenIconHugeIcon, EyeIcon as __EyeIconHugeIcon, FirstBracketCircleIcon as __ZapIconHugeIcon, Globe02Icon as __GlobeIconHugeIcon, Wrench01Icon as __HammerIconHugeIcon, Wrench01Icon as __WrenchIconHugeIcon, Image01Icon as __ImageIconHugeIcon } from '@hugeicons/core-free-icons'
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
import { asHugeIcon } from '@/lib/icons/asHugeIcon'
type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatWorkspaceRelativePath } from "@/lib/filePathDisplay";
import { estimateTimelineMessageHeight } from "./timelineHeight";
import { buildExpandedImagePreview } from "./ExpandedImagePreview";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { ChangedFilesTree } from "./ChangedFilesTree";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { MessageCopyButton } from "./MessageCopyButton";
import { computeMessageDurationStart, normalizeCompactToolLabel } from "./MessagesTimeline.logic";
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
import { ClaudeAI, CursorIcon, Gemini, OpenAI, OpenCodeIcon } from "../Icons";

const ZapIcon = asHugeIcon(__ZapIconHugeIcon)
const MessageSquareIcon = asHugeIcon(__MessageSquareIconHugeIcon)
const CheckIcon = asHugeIcon(__CheckIconHugeIcon)
const TerminalIcon = asHugeIcon(__TerminalIconHugeIcon)
const BotIcon = asHugeIcon(__BotIconHugeIcon)
const CircleAlertIcon = asHugeIcon(__CircleAlertIconHugeIcon)
const EyeIcon = asHugeIcon(__EyeIconHugeIcon)
const GlobeIcon = asHugeIcon(__GlobeIconHugeIcon)
const SquarePenIcon = asHugeIcon(__SquarePenIconHugeIcon)
const HammerIcon = asHugeIcon(__HammerIconHugeIcon)
const WrenchIcon = asHugeIcon(__WrenchIconHugeIcon)
const ImageIcon = asHugeIcon(__ImageIconHugeIcon)

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
  activeWorkCompletedAt: string | null;
  isWorkActive: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionDividerBeforeEntryId: string | null;
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
  workspaceRoot: string | undefined;
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
  return readLegendListBooleanPreference(
    LEGEND_LIST_AGENT_TIMELINE_DIAGNOSTICS_KEY,
    false,
  );
}

function shouldRecycleLegendListItems(): boolean {
  return readLegendListBooleanPreference(LEGEND_LIST_AGENT_TIMELINE_RECYCLE_KEY, true);
}

function resolveAssistantIdentityIcon(provider: ProviderKind | null | undefined): LucideIcon {
  switch (provider) {
    case "claudeAgent":
      return ClaudeAI
    case "cursor":
      return CursorIcon
    case "gemini":
      return Gemini
    case "opencode":
      return OpenCodeIcon
    case "codex":
      return OpenAI
    default:
      return MessageSquareIcon
  }
}

export const MessagesTimeline = memo(function MessagesTimeline({
  hasMessages,
  isWorking,
  selectedProvider,
  activeTurnInProgress,
  activeTurnId,
  activeWorkStartedAt,
  activeWorkCompletedAt,
  isWorkActive,
  scrollContainerRef,
  timelineEntries,
  completionDividerBeforeEntryId,
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
    let activeCompletionSummaryAttached = false;
    const durationStartByMessageId = computeMessageDurationStart(
      timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
    );

    for (let index = 0; index < timelineEntries.length; index += 1) {
      const timelineEntry = timelineEntries[index];
      if (!timelineEntry) {
        continue;
      }

      if (timelineEntry.kind === "work") {
        const groupedEntries = [timelineEntry.entry];
        let cursor = index + 1;
        while (cursor < timelineEntries.length) {
          const nextEntry = timelineEntries[cursor];
          if (!nextEntry || nextEntry.kind !== "work") break;
          groupedEntries.push(nextEntry.entry);
          cursor += 1;
        }
        nextRows.push({
          kind: "work",
          id: timelineEntry.id,
          createdAt: timelineEntry.createdAt,
          groupedEntries,
        });
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

      const inlineCompletionSummary =
        timelineEntry.message.role === "assistant"
          ? completionSummariesByMessageId.get(timelineEntry.message.id) ??
            (completionDividerBeforeEntryId === timelineEntry.id ? completionSummary : null)
          : null;
      if (
        inlineCompletionSummary &&
        activeTurnId &&
        timelineEntry.message.turnId === activeTurnId
      ) {
        activeCompletionSummaryAttached = true;
      }

      nextRows.push({
        kind: "message",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        message: timelineEntry.message,
        durationStart:
          durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
        completionSummary: inlineCompletionSummary,
      });
    }

    if (
      completionSummary &&
      activeWorkCompletedAt &&
      !activeCompletionSummaryAttached &&
      !completionDividerBeforeEntryId
    ) {
      nextRows.push({
        kind: "completion",
        id: `completion-summary-row:${activeWorkCompletedAt}`,
        createdAt: activeWorkCompletedAt,
        summary: completionSummary,
      });
    }

    if (isWorkActive) {
      nextRows.push({
        kind: "working",
        id: "working-indicator-row",
        createdAt: activeWorkStartedAt,
      });
    }

    return nextRows;
  }, [
    activeWorkCompletedAt,
    activeWorkStartedAt,
    activeTurnId,
    completionDividerBeforeEntryId,
    completionSummariesByMessageId,
    completionSummary,
    isWorkActive,
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
        if (row.kind === "working") return true;
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
      if (row.kind === "working") {
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
      completionDividerBeforeEntryId ?? "no-divider",
      completionSummariesByMessageId.size,
    ].join(":");
  }, [
    activeTurnInProgress,
    completionDividerBeforeEntryId,
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
    ],
  );
  const getEstimatedItemSize = useCallback(
    (row: TimelineRow) => estimateTimelineRowHeight(row, timelineWidthPx),
    [timelineWidthPx],
  );
  const getItemType = useCallback((row: TimelineRow): TimelineRow["kind"] => row.kind, []);
  const keyExtractor = useCallback((row: TimelineRow) => row.id, []);
  const shouldRestoreVisiblePosition = useCallback((row: TimelineRow) => row.kind !== "working", []);
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

  const onLegendListLoad = useCallback((info: { elapsedTimeInMs: number }) => {
    if (!shouldLogLegendListDiagnostics()) return;
    console.info("[LegendList][AgentTimeline] load", {
      elapsedTimeInMs: info.elapsedTimeInMs,
    });
  }, []);
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
                    : "max-h-none"
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
                  />
                ))}
              </div>
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
                    <div className="relative w-full min-w-0 rounded-md bg-secondary px-3.5 py-2.5">
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
                                userMessageExpanded ? __WorkLogCollapseHugeIcon : __WorkLogExpandHugeIcon
                              }
                              className="size-3.5 stroke-[2.1]"
                            />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}

                <div className="mt-0.5 flex w-full min-w-0 items-center justify-end gap-2 px-1">
                  <div className="flex items-center gap-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
                    {displayedUserMessage.copyText && (
                      <MessageCopyButton text={displayedUserMessage.copyText} />
                    )}
                    {canRevertAgentWork && (
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
                    )}
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
              {row.completionSummary && (
                <CompletionSummaryRow summary={row.completionSummary} />
              )}
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
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
                          <span>Changed files ({changedFileCountLabel})</span>
                          {hasNonZeroStat(summaryStat) && (
                            <>
                              <span className="mx-1">•</span>
                              <DiffStatLabel
                                additions={summaryStat.additions}
                                deletions={summaryStat.deletions}
                              />
                            </>
                          )}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="group rounded-full border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={() => onToggleAllDirectories(turnSummary.turnId)}
                            title={allDirectoriesExpanded ? "Collapse all" : "Expand all"}
                            aria-label={allDirectoriesExpanded ? "Collapse all" : "Expand all"}
                          >
                            <HugeiconsIcon icon={__ChevronsUpDownHugeIcon} className="size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="rounded-full border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={() =>
                              onOpenTurnDiff(turnSummary.turnId, checkpointFiles[0]?.path)
                            }
                            title="View diff"
                            aria-label="View diff"
                          >
                            <EyeIcon className="size-3.5" />
                          </Button>
                        </div>
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

      {row.kind === "completion" && <CompletionSummaryRow summary={row.summary} />}

      {row.kind === "working" && (
        <WorkingIndicatorRow startedAtIso={row.createdAt} />
      )}
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
            <EmptyTitle className="text-base font-medium">{t("assistant.chat.readyToAssist")}</EmptyTitle>
            <EmptyDescription>
              {t("assistant.chat.readyToAssistDesc")}
            </EmptyDescription>
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
      kind: "message";
      id: string;
      createdAt: string;
      message: TimelineMessage;
      durationStart: string;
      completionSummary: string | null;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: TimelineProposedPlan;
    }
  | {
      kind: "completion";
      id: string;
      createdAt: string;
      summary: string;
    }
  | { kind: "working"; id: string; createdAt: string | null };

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
    case "message":
      return (
        estimateTimelineMessageHeight(row.message, { timelineWidthPx }) +
        (row.completionSummary ? 40 : 0)
      );
    case "proposed-plan":
      return estimateTimelineProposedPlanHeight(row.proposedPlan);
    case "completion":
      return 40;
    case "working":
      return 40;
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

  if (previousRow.kind === "message" && nextRow.kind === "message") {
    return (
      previousRow.createdAt === nextRow.createdAt &&
      previousRow.durationStart === nextRow.durationStart &&
      previousRow.completionSummary === nextRow.completionSummary &&
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

  if (previousRow.kind === "completion" && nextRow.kind === "completion") {
    return previousRow.createdAt === nextRow.createdAt && previousRow.summary === nextRow.summary;
  }

  if (previousRow.kind === "working" && nextRow.kind === "working") {
    return previousRow.createdAt === nextRow.createdAt;
  }

  return false;
}

function formatLiveElapsed(startIso: string, nowMs: number): string | null {
  const startedAtMs = Date.parse(startIso);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  if (elapsedMs < 10_000) {
    return `${(elapsedMs / 1_000).toFixed(1)}s`;
  }
  return formatDuration(elapsedMs);
}

const WorkingIndicatorRow = memo(function WorkingIndicatorRow(props: {
  startedAtIso: string | null;
}) {
  const { startedAtIso } = props;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAtIso) {
      return;
    }
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [startedAtIso]);

  const elapsedLabel = startedAtIso ? formatLiveElapsed(startedAtIso, nowMs) : null;

  return (
    <div className="py-0.5 pl-1.5">
      <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground/70">
        <div
          className="preview-loading-spinner"
          style={
            {
              "--square": "3.5px",
              "--offset": "4.5px",
              margin: "0",
              width: "calc(3 * var(--offset) + var(--square))",
              height: "calc(2 * var(--offset) + var(--square))",
              opacity: 0.7,
            } as React.CSSProperties
          }
        >
          <div className="preview-loading-spinner-square bg-muted-foreground" />
          <div className="preview-loading-spinner-square bg-muted-foreground" />
          <div className="preview-loading-spinner-square bg-muted-foreground" />
          <div className="preview-loading-spinner-square bg-muted-foreground" />
          <div className="preview-loading-spinner-square bg-muted-foreground" />
        </div>
        <span>{elapsedLabel ? `Working for ${elapsedLabel}` : "Working..."}</span>
      </div>
    </div>
  );
});

const CompletionSummaryRow = memo(function CompletionSummaryRow(props: {
  summary: string;
}) {
  return (
    <div className="my-4 px-1">
      <div className="text-[13px] text-muted-foreground/88">
        <span className="font-medium">{props.summary}</span>
      </div>
      <div className="mt-2 h-px bg-border/70" />
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

function workToneIcon(tone: TimelineWorkEntry["tone"], status?: TimelineWorkEntry["status"]): {
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
      className: "text-rose-300/50 dark:text-rose-300/50",
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

function workToneClass(tone: "thinking" | "tool" | "info" | "error", status?: TimelineWorkEntry["status"]): string {
  if (status === "failed") return "text-destructive";
  if (tone === "error") return "text-rose-300/50 dark:text-rose-300/50";
  if (tone === "tool") return "text-muted-foreground/70";
  if (tone === "thinking") return "text-muted-foreground/50";
  return "text-muted-foreground/40";
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

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return WrenchIcon;
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return HammerIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

function isRunningWorkEntry(workEntry: Pick<TimelineWorkEntry, "activityKind" | "status">): boolean {
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
  if (isRunningWorkEntry(workEntry) && isCommandLikeWorkEntry(workEntry)) {
    return "Running command";
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

function workEntryStatusBadge(workEntry: TimelineWorkEntry): {
  label: string;
  className: string;
} | null {
  if (workEntry.status === "cancelled") {
    return {
      label: "Cancelled",
      className:
        "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (
    workEntry.activityKind === "runtime.warning" ||
    workEntry.activityKind === "config.warning" ||
    workEntry.activityKind === "deprecation.notice"
  ) {
    return {
      label: "Warning",
      className:
        "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (workEntry.activityKind === "model.rerouted") {
    return {
      label: "Rerouted",
      className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    };
  }
  if (isRunningWorkEntry(workEntry) && !isCommandLikeWorkEntry(workEntry)) {
    return {
      label: "Running",
      className: "border-border/60 bg-background/80 text-muted-foreground",
    };
  }
  return null;
}

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
}) {
  const { workEntry, workspaceRoot, resolvedTheme } = props;
  const iconConfig = workToneIcon(workEntry.tone, workEntry.status);
  const EntryIcon = workEntryIcon(workEntry);
  const showRunningCommandSpinner =
    isRunningWorkEntry(workEntry) && isCommandLikeWorkEntry(workEntry);
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
  const displayText = preview ? `${heading} - ${preview}` : heading;
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
      <div className="flex items-center gap-2 transition-[opacity,translate] duration-200">
        <span
          className={cn("flex size-5 shrink-0 items-center justify-center", iconConfig.className)}
        >
          {showRunningCommandSpinner ? (
            <div className="loader" aria-hidden="true" />
          ) : (
            <EntryIcon className="size-3" />
          )}
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          {rawCommand ? (
            <div className="max-w-full">
              <p
                className={cn(
                  "truncate text-[11px] leading-5",
                  workToneClass(workEntry.tone, workEntry.status),
                  preview ? "text-muted-foreground/70" : "",
                )}
                title={displayText}
              >
                <span className={cn(workEntry.status === "failed" ? "text-destructive" : "text-foreground/80", workToneClass(workEntry.tone, workEntry.status))}>
                  {heading}
                </span>
                {preview && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="max-w-full cursor-default text-muted-foreground/55 transition-colors hover:text-muted-foreground/75 focus-visible:text-muted-foreground/75">
                        {" "}
                        - {preview}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      align="start"
                      side="top"
                      className="max-w-[min(56rem,calc(100vw-2rem))] border-border/60 bg-popover px-1.5 py-1 text-popover-foreground shadow-md"
                    >
                      <div className="max-w-[min(56rem,calc(100vw-2rem))] overflow-x-auto font-mono text-[11px] leading-4 whitespace-nowrap">
                        {rawCommand}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
              </p>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="block min-w-0 w-full cursor-default text-left"
                  title={displayText}
                  aria-label={displayText}
                >
                  <p
                    className={cn(
                      "truncate text-[11px] leading-5",
                      workToneClass(workEntry.tone, workEntry.status),
                      preview ? "text-muted-foreground/70" : "",
                    )}
                  >
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span className={cn("truncate", workEntry.status === "failed" ? "text-destructive" : "text-foreground/80", workToneClass(workEntry.tone, workEntry.status))}>
                        {heading}
                      </span>
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
                    </span>
                    {preview && <span className="text-muted-foreground/55"> - {preview}</span>}
                  </p>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[min(720px,calc(100vw-2rem))]">
                <p className="whitespace-pre-wrap wrap-break-word text-xs leading-5">{displayText}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
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

import type { TurnId } from "@cozea/assistant-contracts";
import type { TimelineEntry } from "./session-logic";
import { formatDuration } from "./session-logic";
import { workEntryIndicatesFailure, workLogEntryIsToolLike } from "./MessagesTimeline.logic";
import { toolIsRunning } from "./toolPhase";

/** Narrow lifecycle input; no provider-specific or presentation busy heuristics. */
export interface ConversationTurn {
  turnId: TurnId;
  state: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ConversationFold {
  turnId: TurnId;
  anchorEntryId: string;
  createdAt: string;
  hiddenEntryIds: ReadonlySet<string>;
  label: string;
}

export interface ConversationProjection {
  terminalMessageIds: ReadonlySet<string>;
  actionMessageIds: ReadonlySet<string>;
  activeTurnIds: ReadonlySet<TurnId>;
  folds: readonly ConversationFold[];
  /** Message id → last visible entry belonging to its response footer. */
  footerAfterEntryId: ReadonlyMap<string, string>;
}

export function conversationEntryTurnId(entry: TimelineEntry): TurnId | null {
  if (entry.kind === "message")
    return entry.message.role === "assistant" ? (entry.message.turnId ?? null) : null;
  if (entry.kind === "proposed-plan") return entry.proposedPlan.turnId;
  return entry.entry.turnId ?? null;
}

function staysOutsideFold(entry: TimelineEntry): boolean {
  if (entry.kind !== "work") return false;
  const kind = entry.entry.sourceActivityKind ?? entry.entry.activityKind ?? "";
  // Background tasks may outlive the turn that launched them. Never make a
  // running operation disappear merely because its parent response settled.
  return toolIsRunning(entry.entry) || kind.startsWith("task.") || kind.startsWith("agent.");
}

function isCompaction(entry: TimelineEntry): boolean {
  if (entry.kind !== "work") return false;
  return [entry.entry.sourceActivityKind, entry.entry.activityKind, entry.entry.itemType].some(
    (kind) =>
      kind === "context-compaction" ||
      kind === "contextCompaction" ||
      kind === "context_compaction",
  );
}

/**
 * Adapts pinned T3 terminal-message, visual-response, fold and trailing-footer
 * semantics to Cozea DTOs. Kept pure so live and snapshot inputs share one rule.
 * Source: vendor/t3code/apps/web/src/components/chat/MessagesTimeline.logic.ts.
 */
export function projectConversation(input: {
  entries: readonly TimelineEntry[];
  latestTurn?: ConversationTurn | null;
  runningTurnId?: TurnId | null;
  isWorking: boolean;
}): ConversationProjection {
  const { entries, latestTurn } = input;
  const unsettled =
    input.runningTurnId ??
    (latestTurn && (latestTurn.state === "running" || latestTurn.completedAt === null)
      ? latestTurn.turnId
      : null);
  const lastUser = entries.findLastIndex(
    (entry) => entry.kind === "message" && entry.message.role === "user",
  );
  const activeTurnIds = new Set<TurnId>();
  if (unsettled) activeTurnIds.add(unsettled);
  if (unsettled && input.isWorking) {
    for (const entry of entries.slice(lastUser + 1)) {
      const turnId = conversationEntryTurnId(entry);
      if (turnId) activeTurnIds.add(turnId);
    }
  }

  const terminalByResponse = new Map<string, Extract<TimelineEntry, { kind: "message" }>>();
  const messageIndex = new Map<string, number>();
  let unkeyedResponse = 0;
  for (const [index, entry] of entries.entries()) {
    if (entry.kind !== "message") continue;
    if (entry.message.role === "user") unkeyedResponse++;
    if (entry.message.role !== "assistant") continue;
    terminalByResponse.set(
      entry.message.turnId ? `turn:${entry.message.turnId}` : `unkeyed:${unkeyedResponse}`,
      entry,
    );
    messageIndex.set(entry.message.id, index);
  }
  const terminalMessageIds = new Set(
    [...terminalByResponse.values()].map((entry) => String(entry.message.id)),
  );
  const actionMessageIds = new Set<string>();
  for (const entry of terminalByResponse.values()) {
    const turnId = entry.message.turnId;
    const belongsToLiveResponse = turnId
      ? activeTurnIds.has(turnId)
      : input.isWorking && (messageIndex.get(entry.message.id) ?? -1) > lastUser;
    if (!entry.message.streaming && !belongsToLiveResponse) actionMessageIds.add(entry.message.id);
  }

  interface Group {
    entries: TimelineEntry[];
    start: string;
  }
  const groups = new Map<TurnId, Group>();
  let userBoundary: string | null = null;
  for (const entry of entries) {
    if (entry.kind === "message" && entry.message.role === "user") {
      userBoundary = entry.createdAt;
      continue;
    }
    // Proposed plans retain their own disclosure and implementation controls.
    if (entry.kind === "proposed-plan") continue;
    const turnId = conversationEntryTurnId(entry);
    if (!turnId) continue;
    let group = groups.get(turnId);
    if (!group) {
      group = { entries: [], start: userBoundary ?? entry.createdAt };
      groups.set(turnId, group);
      userBoundary = null;
    }
    group.entries.push(entry);
  }
  const folds: ConversationFold[] = [];
  for (const [turnId, group] of groups) {
    if (
      activeTurnIds.has(turnId) ||
      group.entries.some((entry) => entry.kind === "message" && entry.message.streaming)
    )
      continue;
    const terminalIndex = group.entries.findIndex(
      (entry) => entry.kind === "message" && terminalMessageIds.has(entry.message.id),
    );
    const terminal = group.entries[terminalIndex];
    const hiddenEntryIds = new Set<string>();
    for (const [index, entry] of group.entries.entries()) {
      if (index === terminalIndex || staysOutsideFold(entry)) continue;
      const singleTrailing =
        index === terminalIndex + 1 &&
        group.entries.length === terminalIndex + 2 &&
        entry.kind === "work" &&
        !workEntryIndicatesFailure(entry.entry);
      if (terminalIndex >= 0 && index > terminalIndex && !singleTrailing && !isCompaction(entry))
        continue;
      hiddenEntryIds.add(entry.id);
    }
    // A standalone compaction is useful context, not an otherwise empty fold.
    if (!group.entries.some((entry) => hiddenEntryIds.has(entry.id) && !isCompaction(entry)))
      continue;
    const anchor = group.entries.find((entry) => hiddenEntryIds.has(entry.id));
    const last = group.entries.at(-1);
    if (!anchor || !last) continue;
    const start =
      latestTurn?.turnId === turnId ? (latestTurn.startedAt ?? group.start) : group.start;
    const terminalEnd =
      terminal?.kind === "message" ? (terminal.message.completedAt ?? terminal.createdAt) : "";
    const lastEnd =
      last.kind === "message" ? (last.message.completedAt ?? last.createdAt) : last.createdAt;
    const end =
      latestTurn?.turnId === turnId
        ? (latestTurn.completedAt ?? lastEnd)
        : terminalEnd > lastEnd
          ? terminalEnd
          : lastEnd;
    const elapsed = Date.parse(end) - Date.parse(start);
    const duration = Number.isFinite(elapsed) && elapsed >= 0 ? formatDuration(elapsed) : null;
    const state = latestTurn?.turnId === turnId ? latestTurn.state : "completed";
    const label =
      state === "interrupted"
        ? duration
          ? `You stopped after ${duration}`
          : "You stopped this response"
        : state === "error"
          ? duration
            ? `Failed after ${duration}`
            : "Response failed"
          : duration
            ? `Worked for ${duration}`
            : "Worked";
    folds.push({
      turnId,
      anchorEntryId: anchor.id,
      createdAt: anchor.createdAt,
      hiddenEntryIds,
      label,
    });
  }

  const footerAfterEntryId = new Map<string, string>();
  for (const terminal of terminalByResponse.values()) {
    if (!actionMessageIds.has(terminal.message.id)) continue;
    let anchor = terminal.id;
    const index = messageIndex.get(terminal.message.id) ?? -1;
    for (let cursor = index + 1; cursor < entries.length; cursor++) {
      const next = entries[cursor]!;
      if (next.kind === "message") break;
      if (
        next.kind === "work" &&
        next.entry.turnId === terminal.message.turnId &&
        workLogEntryIsToolLike(next.entry)
      )
        // Anchor to the folded position too: expanding trailing work must keep
        // the footer after it. The metadata row itself stays outside the fold.
        anchor = next.id;
    }
    footerAfterEntryId.set(terminal.message.id, anchor);
  }
  return { terminalMessageIds, actionMessageIds, activeTurnIds, folds, footerAfterEntryId };
}

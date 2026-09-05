import type { TurnId } from "@cozea/assistant-contracts";
import type { TimelineEntry, WorkLogEntry } from "./session-logic";
import { projectConversation, type ConversationTurn } from "./conversationProjection";
import {
  omitSupersededLifecycleMarkers,
  workLogEntryIsToolLike,
  type GenerationStatusPhase,
} from "./MessagesTimeline.logic";
import { deriveToolPhase, isDiagnosticWorkEntry, summarizeToolPhase, toolRowId } from "./toolPhase";
import type { ConversationActivityEntries } from "./conversationActivityEntries";
import type { ProviderTaskActivity } from "./providerActivity";
import type { ActivePlanState } from "./session-logic";

export type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
export type TimelineProposedPlan = Extract<
  TimelineEntry,
  { kind: "proposed-plan" }
>["proposedPlan"];
type RowIdentity = { id: string; createdAt: string; expandedFoldId?: string };
/** Larger disclosures must remain individually virtualized by the single list. */
export const MAX_INLINE_FOLD_ROWS = 24;
export type ConversationRow = RowIdentity &
  (
    | { kind: "work" | "notices"; groupedEntries: WorkLogEntry[] }
    | {
        kind: "work-toggle";
        groupId: string;
        hiddenCount: number;
        expanded: boolean;
        summary: string;
        active: boolean;
        liveIds: ReadonlySet<string>;
        groupedEntries: WorkLogEntry[];
      }
    | { kind: "message"; message: TimelineMessage; showActions: boolean }
    | { kind: "assistant-meta"; message: TimelineMessage }
    | { kind: "proposed-plan"; proposedPlan: TimelineProposedPlan }
    | {
        kind: "turn-fold";
        turnId: TurnId;
        label: string;
        expanded: boolean;
        children: ConversationRow[];
        virtualized?: boolean;
      }
    | { kind: "turn-fold-content"; turnId: TurnId; expanded: boolean; children: ConversationRow[] }
    | { kind: "turn-status"; startedAt: string | null; summary: string | null }
    | { kind: "thinking" }
    | { kind: "input-waiting"; requestKind: "approval" | "question" }
    | { kind: "provider-task"; task: ProviderTaskActivity; expanded: boolean }
    | { kind: "provider-plan"; plan: ActivePlanState }
  );

export interface ConversationRowsInput {
  entries: readonly TimelineEntry[];
  latestTurn?: ConversationTurn | null;
  runningTurnId?: TurnId | null;
  activeTurnId?: TurnId | null;
  isWorking: boolean;
  activeWorkStartedAt: string | null;
  generationStatusPhase: GenerationStatusPhase;
  expanded: Readonly<Record<string, boolean>>;
  activity?: ConversationActivityEntries;
  waitingFor?: "approval" | "question" | null;
}

export function stableWorkIdentity(entry: WorkLogEntry): string {
  return entry.toolCallId
    ? `tool:${entry.turnId ?? "no-turn"}:${entry.toolCallId}`
    : toolRowId(entry);
}

/** One deterministic projection for both snapshot history and live arrivals. */
export function buildConversationRows(input: ConversationRowsInput): ConversationRow[] {
  const { entries } = input;
  const projection = projectConversation(input);
  const phase = deriveToolPhase(
    entries,
    input.isWorking,
    input.runningTurnId ?? input.activeTurnId,
  );
  const foldByEntry = new Map<string, string>();
  for (const fold of projection.folds)
    for (const id of fold.hiddenEntryIds) foldByEntry.set(id, fold.turnId);
  const raw: ConversationRow[] = [];
  const rowEntryIds = new Map<string, readonly string[]>();
  const add = (row: ConversationRow, ids: readonly string[]) => {
    raw.push(row);
    rowEntryIds.set(row.id, ids);
  };

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const task = input.activity?.tasks.get(entry.id);
    if (task) {
      add(
        {
          kind: "provider-task",
          id: entry.id,
          createdAt: entry.createdAt,
          task,
          expanded: input.expanded[entry.id] ?? false,
        },
        [entry.id],
      );
      continue;
    }
    const plan = input.activity?.plans.get(entry.id);
    if (plan) {
      add({ kind: "provider-plan", id: entry.id, createdAt: entry.createdAt, plan }, [entry.id]);
      continue;
    }
    if (entry.kind === "message") {
      add(
        {
          kind: "message",
          id: entry.id,
          createdAt: entry.createdAt,
          message: entry.message,
          showActions:
            projection.actionMessageIds.has(entry.message.id) &&
            projection.footerAfterEntryId.get(entry.message.id) === entry.id,
        },
        [entry.id],
      );
      continue;
    }
    if (entry.kind === "proposed-plan") {
      add(
        {
          kind: "proposed-plan",
          id: entry.id,
          createdAt: entry.createdAt,
          proposedPlan: entry.proposedPlan,
        },
        [entry.id],
      );
      continue;
    }
    const run = [entry.entry];
    while (
      entries[index + 1]?.kind === "work" &&
      !input.activity?.tasks.has(entries[index + 1]!.id) &&
      !input.activity?.plans.has(entries[index + 1]!.id)
    ) {
      const next = entries[++index]!;
      if (next.kind === "work") run.push(next.entry);
    }
    const deduped = omitSupersededLifecycleMarkers(run, (work) => work);
    let start = 0;
    for (let cut = 1; cut <= deduped.length; cut++) {
      const first = deduped[start]!;
      const next = deduped[cut];
      if (
        next &&
        isDiagnosticWorkEntry(next) === isDiagnosticWorkEntry(first) &&
        workLogEntryIsToolLike(next) === workLogEntryIsToolLike(first) &&
        next.turnId === first.turnId &&
        foldByEntry.get(toolRowId(next)) === foldByEntry.get(toolRowId(first))
      )
        continue;
      const groupedEntries = deduped.slice(start, cut);
      const id = stableWorkIdentity(first);
      const createdAt = first.timelineOrigin?.createdAt ?? first.createdAt;
      const ids = groupedEntries.map(toolRowId);
      if (isDiagnosticWorkEntry(first))
        add({ kind: "notices", id, createdAt, groupedEntries }, ids);
      else if (!workLogEntryIsToolLike(first))
        add({ kind: "work", id, createdAt, groupedEntries }, ids);
      else {
        const active =
          !input.waitingFor &&
          input.generationStatusPhase !== "thinking" &&
          groupedEntries.some(
            (work) => phase.liveIds.has(toolRowId(work)) || phase.trailingId === toolRowId(work),
          );
        const groupId = `work-group:${id}`;
        add(
          {
            kind: "work-toggle",
            id: `work-toggle:${id}`,
            createdAt,
            groupedEntries,
            groupId,
            expanded: input.expanded[groupId] ?? false,
            hiddenCount: groupedEntries.length,
            active,
            liveIds: phase.liveIds,
            summary: summarizeToolPhase(groupedEntries, active),
          },
          ids,
        );
      }
      start = cut;
    }
  }

  const folds = new Map(projection.folds.map((fold) => [String(fold.turnId), fold]));
  const emittedFolds = new Set<string>();
  const result: ConversationRow[] = [];
  const footerByAnchor = new Map<string, TimelineMessage>();
  for (const entry of entries) {
    if (entry.kind !== "message") continue;
    const anchor = projection.footerAfterEntryId.get(entry.message.id);
    if (anchor && anchor !== entry.id) footerByAnchor.set(anchor, entry.message);
  }
  for (const row of raw) {
    const ids = rowEntryIds.get(row.id) ?? [];
    const foldId = ids.length ? foldByEntry.get(ids[0]!) : undefined;
    const fold = foldId ? folds.get(foldId) : undefined;
    if (fold) {
      const previous = result.at(-1);
      let foldRow =
        previous &&
        (previous.kind === "turn-fold" || previous.kind === "turn-fold-content") &&
        previous.turnId === fold.turnId
          ? previous
          : undefined;
      if (!foldRow && !emittedFolds.has(fold.turnId)) {
        const id = `turn-fold:${fold.turnId}`;
        foldRow = {
          kind: "turn-fold",
          id,
          createdAt: fold.createdAt,
          turnId: fold.turnId,
          label: fold.label,
          expanded: input.expanded[id] ?? false,
          children: [],
        };
        emittedFolds.add(fold.turnId);
        result.push(foldRow);
      } else if (!foldRow) {
        // Keep noncontiguous hidden work in its original position when expanded.
        // In particular, trailing tools must not move ahead of the final text.
        foldRow = {
          kind: "turn-fold-content",
          id: `turn-fold-content:${fold.turnId}:${row.id}`,
          createdAt: row.createdAt,
          turnId: fold.turnId,
          expanded: input.expanded[`turn-fold:${fold.turnId}`] ?? false,
          children: [],
        };
        result.push(foldRow);
      }
      foldRow.children.push(row);
    } else result.push(row);
    for (const id of ids) {
      const message = footerByAnchor.get(id);
      if (message)
        result.push({
          kind: "assistant-meta",
          id: `assistant-meta:${message.id}`,
          createdAt: row.createdAt,
          message,
        });
    }
  }
  if (input.waitingFor) {
    result.push({
      kind: "input-waiting",
      id: "input-waiting-row",
      requestKind: input.waitingFor,
      createdAt: input.activeWorkStartedAt ?? "",
    });
  } else if (input.isWorking) {
    if (input.generationStatusPhase === "thinking") {
      result.push({
        kind: "thinking",
        id: "thinking-indicator-row",
        createdAt: input.activeWorkStartedAt ?? "",
      });
    } else if (!phase.active) {
      result.push({
        kind: "turn-status",
        id: `turn-status:${input.runningTurnId ?? input.activeTurnId ?? "pending"}`,
        createdAt: input.activeWorkStartedAt ?? "",
        startedAt: input.activeWorkStartedAt,
        summary: null,
      });
    }
  }
  const foldSizes = new Map<string, number>();
  for (const row of result) {
    if (row.kind === "turn-fold" || row.kind === "turn-fold-content")
      foldSizes.set(row.turnId, (foldSizes.get(row.turnId) ?? 0) + row.children.length);
  }
  return result.flatMap((row): ConversationRow[] => {
    if (
      (row.kind !== "turn-fold" && row.kind !== "turn-fold-content") ||
      (foldSizes.get(row.turnId) ?? 0) <= MAX_INLINE_FOLD_ROWS
    )
      return [row];
    const header: ConversationRow[] =
      row.kind === "turn-fold" ? [{ ...row, children: [], virtualized: true }] : [];
    return row.expanded
      ? [
          ...header,
          ...row.children.map((child) => ({ ...child, expandedFoldId: `turn-fold:${row.turnId}` })),
        ]
      : header;
  });
}

function sameEntries(a: readonly WorkLogEntry[], b: readonly WorkLogEntry[]) {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}
export function conversationRowsEqual(a: ConversationRow, b: ConversationRow): boolean {
  if (a === b) return true;
  if (
    a.id !== b.id ||
    a.kind !== b.kind ||
    a.createdAt !== b.createdAt ||
    a.expandedFoldId !== b.expandedFoldId
  )
    return false;
  if (a.kind === "message" && b.kind === "message")
    return a.message === b.message && a.showActions === b.showActions;
  if (a.kind === "assistant-meta" && b.kind === "assistant-meta") return a.message === b.message;
  if (a.kind === "provider-task" && b.kind === "provider-task")
    return a.task === b.task && a.expanded === b.expanded;
  if (a.kind === "provider-plan" && b.kind === "provider-plan") return a.plan === b.plan;
  if (a.kind === "proposed-plan" && b.kind === "proposed-plan")
    return a.proposedPlan === b.proposedPlan;
  if ((a.kind === "work" || a.kind === "notices") && (b.kind === "work" || b.kind === "notices"))
    return sameEntries(a.groupedEntries, b.groupedEntries);
  if (a.kind === "work-toggle" && b.kind === "work-toggle")
    return (
      a.expanded === b.expanded &&
      a.summary === b.summary &&
      a.active === b.active &&
      a.liveIds.size === b.liveIds.size &&
      [...a.liveIds].every((id) => b.liveIds.has(id)) &&
      sameEntries(a.groupedEntries, b.groupedEntries)
    );
  if (
    (a.kind === "turn-fold" || a.kind === "turn-fold-content") &&
    (b.kind === "turn-fold" || b.kind === "turn-fold-content")
  )
    return (
      (a.kind !== "turn-fold" || b.kind !== "turn-fold" || a.label === b.label) &&
      (a.kind !== "turn-fold" || b.kind !== "turn-fold" || a.virtualized === b.virtualized) &&
      a.expanded === b.expanded &&
      a.children.length === b.children.length &&
      a.children.every((row, index) => conversationRowsEqual(row, b.children[index]!))
    );
  if (a.kind === "turn-status" && b.kind === "turn-status")
    return a.startedAt === b.startedAt && a.summary === b.summary;
  if (a.kind === "input-waiting" && b.kind === "input-waiting")
    return a.requestKind === b.requestKind;
  return a.kind === "thinking" && b.kind === "thinking";
}

/** Preserve unrelated row objects without hiding authoritative replacement data. */
export function reuseConversationRows(
  previous: readonly ConversationRow[],
  next: ConversationRow[],
): ConversationRow[] {
  const byId = new Map(previous.map((row) => [row.id, row]));
  return next.map((row) => {
    const old = byId.get(row.id);
    if (old && conversationRowsEqual(old, row)) return old;
    if (
      (old?.kind === "turn-fold" || old?.kind === "turn-fold-content") &&
      (row.kind === "turn-fold" || row.kind === "turn-fold-content")
    )
      return { ...row, children: reuseConversationRows(old.children, row.children) };
    return row;
  });
}

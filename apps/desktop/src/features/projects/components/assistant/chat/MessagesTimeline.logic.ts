import {
  isToolLifecycleItemType,
  type OrchestrationThreadActivity,
  type TurnId,
} from "@cozea/assistant-contracts";
import type { TimelineEntry, WorkLogEntry } from "./session-logic";
import { normalizedToolAction } from "./toolDetailPresentation";

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

export type GenerationStatusPhase = "thinking" | "working";

function timelineEntryTurnId(entry: TimelineEntry): TurnId | null {
  if (entry.kind === "message") {
    return entry.message.role === "assistant" ? (entry.message.turnId ?? null) : null;
  }
  if (entry.kind === "proposed-plan") {
    return entry.proposedPlan.turnId;
  }
  return entry.entry.turnId ?? null;
}

/** Pin a turn header after its triggering user message and before generated content. */
export function deriveTurnHeaderIndex(
  timelineEntries: ReadonlyArray<TimelineEntry>,
  turnId: TurnId | null | undefined,
): number {
  if (!turnId) {
    const latestUserMessageIndex = timelineEntries.findLastIndex(
      (entry) => entry.kind === "message" && entry.message.role === "user",
    );
    return latestUserMessageIndex + 1;
  }

  const firstOwnedEntryIndex = timelineEntries.findIndex(
    (entry) => timelineEntryTurnId(entry) === turnId,
  );
  if (firstOwnedEntryIndex < 0) {
    const latestUserMessageIndex = timelineEntries.findLastIndex(
      (entry) => entry.kind === "message" && entry.message.role === "user",
    );
    return latestUserMessageIndex + 1;
  }

  const triggeringUserMessageIndex = timelineEntries.findLastIndex(
    (entry, index) =>
      index < firstOwnedEntryIndex &&
      entry.kind === "message" &&
      entry.message.role === "user",
  );
  return triggeringUserMessageIndex >= 0 ? triggeringUserMessageIndex + 1 : firstOwnedEntryIndex;
}

export const deriveActiveTurnHeaderIndex = deriveTurnHeaderIndex;

/**
 * Explicit provider reasoning is the only state that renders as Thinking.
 * Active turns otherwise render as Working, including providers that do not
 * expose reasoning lifecycle events.
 */
export function deriveGenerationStatusPhase(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  activeTurnId: TurnId | null | undefined,
): GenerationStatusPhase {
  if (!activeTurnId) return "working";
  const markers = activities
    .filter((activity) => activity.turnId === activeTurnId)
    .filter(
      (activity) =>
        activity.kind === "reasoning.started" || activity.kind === "reasoning.completed",
    )
    .sort((left, right) => {
      if (left.sequence !== undefined && right.sequence !== undefined) {
        return left.sequence - right.sequence;
      }
      const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
      if (createdAtOrder !== 0) return createdAtOrder;
      if (left.kind !== right.kind) return left.kind === "reasoning.started" ? -1 : 1;
      return left.id.localeCompare(right.id);
    });
  return markers.at(-1)?.kind === "reasoning.started" ? "thinking" : "working";
}

/* -------------------------------------------------------------------------
 * Tool group summarization
 *
 * Ported from the upstream t3code timeline logic so a collapsed work group can
 * describe itself ("Read 4 files and ran 2 commands") instead of showing a bare
 * count. Kept as pure functions over WorkLogEntry so they stay testable without
 * mounting the timeline.
 * ---------------------------------------------------------------------- */

export type ToolGroupAction = "read" | "edit" | "command" | "code-search" | "search" | "other";
export type ToolGroupSummaryKind =
  | ToolGroupAction
  | "dynamic-tool"
  | "agent-tool"
  | "tone-tool"
  | "mixed";

/** Providers report grep as a web search; the label is the only thing separating them. */
export function workLogEntryIsLocalCodeSearch(entry: WorkLogEntry): boolean {
  return (
    entry.itemType === "web_search" &&
    /\bgrep\b/i.test(normalizeCompactToolLabel(entry.toolTitle ?? entry.label))
  );
}

export function toolGroupAction(entry: WorkLogEntry): ToolGroupAction {
  if (
    entry.requestKind === "file-read" ||
    entry.itemType === "image_view" ||
    (entry.itemType === "dynamic_tool_call" && entry.toolTitle === "Read File")
  ) {
    return "read";
  }
  if (
    entry.requestKind === "file-change" ||
    entry.itemType === "file_change" ||
    (entry.changedFiles?.length ?? 0) > 0
  ) {
    return "edit";
  }
  if (entry.requestKind === "command" || entry.itemType === "command_execution" || entry.command) {
    return "command";
  }
  if (workLogEntryIsLocalCodeSearch(entry)) return "code-search";
  if (entry.itemType === "web_search") return "search";
  // Providers that only report a category leave the real tool name in the
  // detail; recover it so the group summary can still count reads and edits.
  const recovered = normalizedToolAction({ title: entry.toolTitle, detail: entry.detail });
  if (recovered) return recovered;
  return "other";
}

/**
 * Edits count distinct files, not calls: three edits to one file read as
 * "Changed 1 file". Entries with no file details still count once each so a
 * provider that omits them cannot silently vanish from the summary.
 */
function toolGroupActionCount(
  action: ToolGroupAction,
  entries: ReadonlyArray<WorkLogEntry>,
): number {
  if (action !== "edit") return entries.length;

  const changedFiles = new Set<string>();
  let editsWithoutFileDetails = 0;
  for (const entry of entries) {
    if (!entry.changedFiles || entry.changedFiles.length === 0) {
      editsWithoutFileDetails += 1;
      continue;
    }
    for (const file of entry.changedFiles) changedFiles.add(file);
  }
  return changedFiles.size + editsWithoutFileDetails;
}

function toolGroupActionLabel(action: ToolGroupAction, count: number): string {
  switch (action) {
    case "read":
      return `Read ${count} ${count === 1 ? "file" : "files"}`;
    case "edit":
      return `Changed ${count} ${count === 1 ? "file" : "files"}`;
    case "command":
      return `Ran ${count} ${count === 1 ? "command" : "commands"}`;
    case "search":
      return `Searched the web ${count} ${count === 1 ? "time" : "times"}`;
    case "code-search":
      return `Searched code ${count} ${count === 1 ? "time" : "times"}`;
    case "other":
      return `Used ${count} ${count === 1 ? "tool" : "tools"}`;
  }
}

/** Immediate, provider-neutral fallback while generated tool summaries are disabled or unavailable. */
export function summarizeToolGroup(entries: ReadonlyArray<WorkLogEntry>): string {
  const summaryEntries = omitSupersededLifecycleMarkers(entries, (entry) => entry);
  const groupedEntries = new Map<ToolGroupAction, WorkLogEntry[]>();
  for (const entry of summaryEntries) {
    const action = toolGroupAction(entry);
    const group = groupedEntries.get(action);
    if (group) group.push(entry);
    else groupedEntries.set(action, [entry]);
  }
  const labels = [...groupedEntries].map(([action, actionEntries]) =>
    toolGroupActionLabel(action, toolGroupActionCount(action, actionEntries)),
  );
  const sentenceLabels = labels.map((label, index) =>
    index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1),
  );
  if (sentenceLabels.length < 2) return sentenceLabels[0] ?? "";
  if (sentenceLabels.length === 2) return sentenceLabels.join(" and ");
  return `${sentenceLabels.slice(0, -1).join(", ")}, and ${sentenceLabels.at(-1)}`;
}

/**
 * Providers without stable tool-call ids emit a start marker and a terminal
 * marker for the same call, which would otherwise render twice. Walking in
 * reverse, drop any id-less, status-less start marker once a terminal entry
 * with the same (turn, itemType, label) identity has already been seen.
 */
export function omitSupersededLifecycleMarkers<T>(
  entries: readonly T[],
  workEntryFor: (entry: T) => WorkLogEntry,
): T[] {
  const laterTerminalIdentities = new Set<string>();
  const reversedEntries: T[] = [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const workEntry = workEntryFor(entry);
    const normalizedLabel = normalizeCompactToolLabel(workEntry.toolTitle ?? workEntry.label);
    const identity = [
      workEntry.turnId ?? "no-turn",
      workEntry.itemType ?? "",
      normalizedLabel,
    ].join("\u001f");
    const isStatuslessIdlessMarker =
      workEntry.toolCallId === undefined &&
      workEntry.toolLifecycleStatus === undefined &&
      (workEntry.sourceActivityKind === "tool.started" ||
        workEntry.sourceActivityKind === "tool.updated");
    if (isStatuslessIdlessMarker && laterTerminalIdentities.has(identity)) continue;

    reversedEntries.push(entry);
    if (
      workEntry.sourceActivityKind === "tool.completed" ||
      (workEntry.toolLifecycleStatus !== undefined &&
        workEntry.toolLifecycleStatus !== "inProgress")
    ) {
      laterTerminalIdentities.add(identity);
    }
  }

  return reversedEntries.toReversed();
}

/** Which icon a collapsed group should carry; "mixed" when the group is not uniform. */
export function toolGroupSummaryKind(entries: ReadonlyArray<WorkLogEntry>): ToolGroupSummaryKind {
  const actions = new Set(entries.map(toolGroupAction));
  if (actions.size !== 1) return "mixed";

  const action = actions.values().next().value!;
  if (action !== "other") return action;

  const fallbackKinds = new Set(
    entries.map((entry): ToolGroupSummaryKind => {
      if (entry.itemType === "mcp_tool_call") return "other";
      if (entry.itemType === "dynamic_tool_call") return "dynamic-tool";
      if (entry.itemType === "collab_agent_tool_call" || entry.taskId) return "agent-tool";
      if (entry.tone === "thinking") return "agent-tool";
      if (entry.tone === "tool") return "tone-tool";
      return "other";
    }),
  );
  return fallbackKinds.size === 1 ? fallbackKinds.values().next().value! : "mixed";
}

/**
 * Stable identity for a work group: prefer the provider's tool-call id so the
 * group survives lifecycle updates, and fall back to the timeline entry id.
 */
export function workGroupIdentity(timelineEntryId: string, entry: WorkLogEntry): string {
  return entry.toolCallId
    ? `tool:${entry.turnId ?? "no-turn"}:${entry.toolCallId}`
    : timelineEntryId;
}

export function workGroupId(timelineEntryId: string, entry: WorkLogEntry): string {
  return `work-group:${workGroupIdentity(timelineEntryId, entry)}`;
}

/**
 * A work entry that represents a tool invocation rather than narration. Tone
 * covers provider rows that carry no lifecycle metadata; the remaining checks
 * catch tool rows that arrive as plain info.
 */
export function workLogEntryIsToolLike(entry: WorkLogEntry): boolean {
  if (entry.tone === "tool" || entry.tone === "thinking" || entry.tone === "error") {
    return true;
  }
  if (entry.command !== undefined && entry.command.trim().length > 0) {
    return true;
  }
  if (entry.requestKind !== undefined) {
    return true;
  }
  return entry.itemType !== undefined && isToolLifecycleItemType(entry.itemType);
}

/**
 * Matches the failure states `workToneIcon` renders inside the group, so a
 * collapsed toggle cannot claim success over a failed row it is hiding.
 */
export function workEntryIndicatesFailure(entry: WorkLogEntry): boolean {
  return entry.status === "failed" || entry.tone === "error";
}

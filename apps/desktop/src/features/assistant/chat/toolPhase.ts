import type { TurnId } from "@cozea/assistant-contracts";
import type { TimelineEntry, WorkLogEntry } from "./session-logic";
import {
  summarizeToolGroup,
  workEntryIndicatesFailure,
  workLogEntryIsToolLike,
} from "./MessagesTimeline.logic";

export function toolRowId(entry: WorkLogEntry): string {
  return entry.timelineOrigin?.id ?? entry.id;
}

export function toolIsRunning(entry: WorkLogEntry): boolean {
  const status = entry.toolLifecycleStatus ?? entry.status;
  if (status !== undefined) return status === "inProgress";
  return ["tool.started", "tool.updated", "tool.progress"].includes(
    entry.sourceActivityKind ?? entry.activityKind ?? "",
  );
}

export function isDiagnosticWorkEntry(entry: WorkLogEntry): boolean {
  return ["runtime.error", "runtime.warning", "config.warning", "deprecation.notice"].includes(
    entry.activityKind ?? "",
  );
}

/** A text arrival ends the preceding tool phase, even for providers missing a terminal marker. */
export function deriveToolPhase(
  entries: readonly TimelineEntry[],
  working: boolean,
  turnId?: TurnId | null,
) {
  const liveIds = new Set<string>();
  let trailingId: string | null = null;
  if (!working) return { liveIds, trailingId, active: false };
  const boundary = entries.findLastIndex((entry) => entry.kind === "message");
  for (const entry of entries.slice(boundary + 1)) {
    if (
      entry.kind !== "work" ||
      isDiagnosticWorkEntry(entry.entry) ||
      !workLogEntryIsToolLike(entry.entry)
    )
      continue;
    if (turnId && entry.entry.turnId && entry.entry.turnId !== turnId) continue;
    trailingId = toolRowId(entry.entry);
    if (toolIsRunning(entry.entry)) liveIds.add(trailingId);
  }
  return { liveIds, trailingId, active: trailingId !== null };
}

export function summarizeToolPhase(entries: readonly WorkLogEntry[], active: boolean): string {
  entries = entries.filter(workLogEntryIsToolLike);
  const failures = entries.filter(workEntryIndicatesFailure).length;
  const completed = entries.filter((entry) => !workEntryIndicatesFailure(entry) && (entry.toolLifecycleStatus ?? entry.status) === "completed");
  const stopped = entries.filter(entry => ["cancelled", "stopped"].includes(entry.toolLifecycleStatus ?? entry.status ?? "")).length;
  const declined = entries.filter(entry => (entry.toolLifecycleStatus ?? entry.status) === "declined").length;
  const unresolved = entries.length - completed.length - failures - stopped - declined;
  const actions = completed.length ? summarizeToolGroup(completed) : active ? "Working" : "";
  const failed = failures ? `${failures} ${failures === 1 ? "action" : "actions"} failed` : "";
  const interrupted = stopped ? `${stopped} ${stopped === 1 ? "action" : "actions"} stopped` : "";
  const rejected = declined ? `${declined} ${declined === 1 ? "action" : "actions"} declined` : "";
  const unfinished = !active && unresolved ? `${unresolved} ${unresolved === 1 ? "action" : "actions"} unfinished` : "";
  return [actions, failed, interrupted, rejected, unfinished].filter(Boolean).join(" · ") || "Used tools";
}

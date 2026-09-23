import type { TurnId } from "@cozea/assistant-contracts";
import type { TimelineEntry, WorkLogEntry } from "./session-logic";
import { formatWorkspaceRelativePath } from "@/features/assistant/lib/filePathDisplay";
import {
  normalizeCompactToolLabel,
  summarizeToolGroup,
  toolGroupAction,
  workEntryIndicatesFailure,
  workLogEntryIsToolLike,
} from "./MessagesTimeline.logic";
import { commandProgramName } from "./shellCommandProgram";
import { workEntryPreview } from "./workEntryPresentation";

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

export function liveWorkEntryTaskLabel(
  entry: WorkLogEntry,
  workspaceRoot?: string,
): string {
  const action = toolGroupAction(entry);
  if (action === "command") {
    const cmd = entry.command?.trim();
    if (cmd) {
      const program = commandProgramName(cmd);
      return program ? `Running ${program}` : "Running command";
    }
    return "Running command";
  }
  if (action === "read") {
    const target =
      entry.detail ??
      entry.changedFiles?.[0] ??
      (entry as { filePath?: string }).filePath;
    const preview = target
      ? formatWorkspaceRelativePath(target, workspaceRoot)
      : workEntryPreview(entry, workspaceRoot);
    return preview ? `Reading ${preview}` : "Reading file";
  }
  if (action === "edit") {
    const target =
      entry.detail ??
      entry.changedFiles?.[0] ??
      (entry as { filePath?: string }).filePath;
    const preview = target
      ? formatWorkspaceRelativePath(target, workspaceRoot)
      : workEntryPreview(entry, workspaceRoot);
    return preview ? `Modifying ${preview}` : "Modifying file";
  }
  if (action === "code-search") {
    return "Searching code";
  }
  if (action === "search") {
    return "Searching web";
  }
  const rawTitle = entry.toolTitle ?? entry.label;
  if (rawTitle) {
    const compact = normalizeCompactToolLabel(rawTitle).trim();
    if (compact) {
      return `Running ${compact.toLowerCase()}`;
    }
  }
  return "Working";
}

export function summarizeToolPhase(
  entries: readonly WorkLogEntry[],
  active: boolean,
  workspaceRoot?: string,
): string {
  entries = entries.filter(workLogEntryIsToolLike);
  const failures = entries.filter(workEntryIndicatesFailure).length;
  const completed = entries.filter(
    (entry) =>
      !workEntryIndicatesFailure(entry) &&
      (entry.toolLifecycleStatus ?? entry.status) === "completed",
  );
  const stopped = entries.filter((entry) =>
    ["cancelled", "stopped"].includes(entry.toolLifecycleStatus ?? entry.status ?? ""),
  ).length;
  const declined = entries.filter(
    (entry) => (entry.toolLifecycleStatus ?? entry.status) === "declined",
  ).length;
  const unresolved = entries.length - completed.length - failures - stopped - declined;

  let actions = "";
  if (active) {
    const runningEntry =
      entries.findLast(toolIsRunning) ??
      (unresolved > 0
        ? entries.findLast(
            (entry) =>
              !workEntryIndicatesFailure(entry) &&
              (entry.toolLifecycleStatus ?? entry.status) !== "completed" &&
              !["cancelled", "stopped", "declined"].includes(
                entry.toolLifecycleStatus ?? entry.status ?? "",
              ),
          )
        : undefined);
    const runningLabel = runningEntry
      ? liveWorkEntryTaskLabel(runningEntry, workspaceRoot)
      : "Working";
    actions = completed.length
      ? `${summarizeToolGroup(completed)} · ${runningLabel}`
      : runningLabel;
  } else {
    actions = completed.length ? summarizeToolGroup(completed) : "";
  }

  const failed = failures ? `${failures} ${failures === 1 ? "action" : "actions"} failed` : "";
  const interrupted = stopped ? `${stopped} ${stopped === 1 ? "action" : "actions"} stopped` : "";
  const rejected = declined ? `${declined} ${declined === 1 ? "action" : "actions"} declined` : "";
  const unfinished =
    !active && unresolved ? `${unresolved} ${unresolved === 1 ? "action" : "actions"} unfinished` : "";
  return (
    [actions, failed, interrupted, rejected, unfinished].filter(Boolean).join(" · ") ||
    "Used tools"
  );
}

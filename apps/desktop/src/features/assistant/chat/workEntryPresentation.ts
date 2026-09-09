import { formatWorkspaceRelativePath } from "@/lib/filePathDisplay";
import { commandProgramName } from "./shellCommandProgram";
import { normalizeCompactToolLabel } from "./MessagesTimeline.logic";
import type { deriveTimelineEntries } from "./session-logic";

type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineWorkEntry = Extract<TimelineEntry, { kind: "work" }>["entry"];

export function workEntryPreview(
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

export function normalizePathLikeValue(value: string): string {
  return value.trim().replace(/\\/g, "/");
}

export function workEntryPreviewDuplicatesSingleChangedFile(
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

export function workEntryRawCommand(
  workEntry: Pick<TimelineWorkEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

export function liveWorkEntryLabel(
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

export function isRunningWorkEntry(
  workEntry: Pick<TimelineWorkEntry, "activityKind" | "status">,
): boolean {
  return workEntry.activityKind === "tool.progress" || workEntry.status === "inProgress";
}

export function isCommandLikeWorkEntry(
  workEntry: Pick<TimelineWorkEntry, "requestKind" | "itemType" | "command">,
): boolean {
  return (
    workEntry.requestKind === "command" ||
    workEntry.itemType === "command_execution" ||
    Boolean(workEntry.command)
  );
}

export function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

export function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
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

export function workEntryStatusBadge(workEntry: TimelineWorkEntry): {
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

export function sameDisplayedText(left: string, right: string): boolean {
  return left.replace(/\s+/gu, " ").trim() === right.replace(/\s+/gu, " ").trim();
}

export function buildWorkEntryExpandedBody(
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

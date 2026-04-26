import type { ToolLifecycleItemType } from "@cozea/assistant-contracts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function trimMatchingOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : trimmed;
  }
  return trimmed;
}

function executableBasename(value: string): string | undefined {
  const trimmed = trimMatchingOuterQuotes(value);
  if (trimmed.length === 0) {
    return undefined;
  }
  const normalized = trimmed.replace(/\\/gu, "/");
  const lastSegment = normalized.split("/").at(-1)?.trim().toLowerCase();
  return lastSegment && lastSegment.length > 0 ? lastSegment : undefined;
}

function splitExecutableAndRest(value: string): { executable: string; rest: string } | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    const closeIndex = trimmed.indexOf(quote, 1);
    if (closeIndex <= 0) {
      return undefined;
    }
    return {
      executable: trimmed.slice(0, closeIndex + 1),
      rest: trimmed.slice(closeIndex + 1).trim(),
    };
  }

  const firstWhitespace = trimmed.search(/\s/u);
  if (firstWhitespace < 0) {
    return {
      executable: trimmed,
      rest: "",
    };
  }

  return {
    executable: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

const SHELL_WRAPPER_SPECS = [
  {
    executables: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"],
    wrapperFlagPattern: /(?:^|\s)-command\s+/iu,
  },
  {
    executables: ["cmd", "cmd.exe"],
    wrapperFlagPattern: /(?:^|\s)\/c\s+/u,
  },
  {
    executables: ["bash", "sh", "zsh"],
    wrapperFlagPattern: /(?:^|\s)-(?:l)?c\s+/u,
  },
] as const;

function unwrapCommandRemainder(value: string, wrapperFlagPattern: RegExp): string | undefined {
  const match = wrapperFlagPattern.exec(value);
  if (!match) {
    return undefined;
  }
  const command = value.slice(match.index + match[0].length).trim();
  if (command.length === 0) {
    return undefined;
  }
  const unwrapped = trimMatchingOuterQuotes(command);
  return unwrapped.length > 0 ? unwrapped : undefined;
}

function unwrapKnownShellCommandWrapper(value: string): string {
  const split = splitExecutableAndRest(value);
  if (!split || split.rest.length === 0) {
    return value;
  }
  const shell = executableBasename(split.executable);
  if (!shell) {
    return value;
  }
  const spec = SHELL_WRAPPER_SPECS.find((candidate) =>
    candidate.executables.includes(shell),
  );
  if (!spec) {
    return value;
  }
  return unwrapCommandRemainder(split.rest, spec.wrapperFlagPattern) ?? value;
}

function formatCommandArrayPart(value: string): string {
  return /[\s"'`]/u.test(value) ? `"${value.replace(/"/gu, '\\"')}"` : value;
}

function formatCommandValue(value: unknown): string | undefined {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return parts.length > 0 ? parts.map((part) => formatCommandArrayPart(part)).join(" ") : undefined;
}

function normalizeCommandValue(value: unknown): string | undefined {
  const formatted = formatCommandValue(value);
  return formatted ? unwrapKnownShellCommandWrapper(formatted) : undefined;
}

function rawCommandValue(value: unknown, normalizedCommand: string | undefined): string | undefined {
  const formatted = formatCommandValue(value);
  if (!formatted || !normalizedCommand || formatted === normalizedCommand) {
    return undefined;
  }
  return formatted;
}

function stripTrailingExitCode(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code \d+>)\s*$/iu.exec(trimmed);
  const output = match?.groups?.output?.trim() ?? trimmed;
  return output.length > 0 ? output : undefined;
}

function extractCommandFromTitle(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  const backtickMatch = /`([^`]+)`/u.exec(title);
  return backtickMatch?.[1]?.trim() || undefined;
}

function extractToolCommand(
  data: Record<string, unknown> | undefined,
  title: string | undefined,
): {
  command?: string;
  rawCommand?: string;
} {
  const item = asRecord(data?.item);
  const itemInput = asRecord(item?.input);
  const itemResult = asRecord(item?.result);
  const rawInput = asRecord(data?.rawInput);
  const commandCandidates = [
    { command: normalizeCommandValue(item?.command), rawCommand: rawCommandValue(item?.command, normalizeCommandValue(item?.command)) },
    { command: normalizeCommandValue(itemInput?.command), rawCommand: rawCommandValue(itemInput?.command, normalizeCommandValue(itemInput?.command)) },
    { command: normalizeCommandValue(itemResult?.command), rawCommand: rawCommandValue(itemResult?.command, normalizeCommandValue(itemResult?.command)) },
    { command: normalizeCommandValue(data?.command), rawCommand: rawCommandValue(data?.command, normalizeCommandValue(data?.command)) },
    { command: normalizeCommandValue(rawInput?.command), rawCommand: rawCommandValue(rawInput?.command, normalizeCommandValue(rawInput?.command)) },
  ];
  const direct = commandCandidates.find((candidate) => candidate.command !== undefined);
  if (direct?.command) {
    return direct;
  }
  const executable = asTrimmedString(rawInput?.executable);
  const args = normalizeCommandValue(rawInput?.args);
  if (executable && args) {
    const rawExecutable = formatCommandValue(rawInput.executable) ?? executable;
    const rawArgs = formatCommandValue(rawInput.args);
    const rawCommand =
      rawArgs && rawExecutable ? `${rawExecutable} ${rawArgs}` : rawExecutable;
    const command = `${executable} ${args}`;
    return {
      command,
      ...(rawCommand !== command ? { rawCommand } : {}),
    };
  }
  if (executable) {
    return {
      command: executable,
    };
  }
  const titleCommand = extractCommandFromTitle(title);
  return titleCommand ? { command: titleCommand } : {};
}

function maybePathLike(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value.includes("/") ||
    value.includes("\\") ||
    value.startsWith(".") ||
    /\.(?:[a-z0-9]{1,12})$/iu.test(value)
  ) {
    return value;
  }
  return undefined;
}

function collectPaths(value: unknown, paths: string[], seen: Set<string>, depth: number): void {
  if (depth > 4 || paths.length >= 8) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPaths(entry, paths, seen, depth + 1);
      if (paths.length >= 8) {
        return;
      }
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const key of ["path", "filePath", "relativePath", "filename", "newPath", "oldPath"]) {
    const candidate = maybePathLike(asTrimmedString(record[key]));
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    paths.push(candidate);
    if (paths.length >= 8) {
      return;
    }
  }
  for (const nestedKey of [
    "locations",
    "item",
    "input",
    "result",
    "rawInput",
    "rawOutput",
    "data",
    "changes",
    "args",
    "resolution",
    "files",
    "failed",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectPaths(record[nestedKey], paths, seen, depth + 1);
    if (paths.length >= 8) {
      return;
    }
  }
}

function extractChangedPaths(data: Record<string, unknown> | undefined): string[] {
  const paths: string[] = [];
  collectPaths(data, paths, new Set<string>(), 0);
  return paths;
}

function extractPrimaryPath(data: Record<string, unknown> | undefined): string | undefined {
  return extractChangedPaths(data)[0];
}

function normalizeEquivalentValue(value: string | undefined): string | undefined {
  const trimmed = asTrimmedString(value);
  if (!trimmed) {
    return undefined;
  }
  return trimmed
    .replace(/\s+/gu, " ")
    .replace(/\s+(?:complete|completed|started)\s*$/iu, "")
    .trim();
}

function isEquivalent(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeEquivalentValue(left)?.toLowerCase();
  const normalizedRight = normalizeEquivalentValue(right)?.toLowerCase();
  return normalizedLeft !== undefined && normalizedLeft === normalizedRight;
}

function classifyToolAction(input: {
  readonly itemType?: ToolLifecycleItemType | null | undefined;
  readonly title?: string | undefined;
  readonly data?: Record<string, unknown> | undefined;
}): "command" | "read" | "file_change" | "search" | "other" {
  const itemType = input.itemType ?? undefined;
  const kind = asTrimmedString(input.data?.kind)?.toLowerCase();
  const title = asTrimmedString(input.title)?.toLowerCase();
  if (itemType === "command_execution" || kind === "execute" || title === "terminal") {
    return "command";
  }
  if (kind === "read" || title === "read file") {
    return "read";
  }
  if (
    itemType === "file_change" ||
    kind === "edit" ||
    kind === "move" ||
    kind === "delete" ||
    kind === "write"
  ) {
    return "file_change";
  }
  if (itemType === "web_search" || kind === "search" || title === "find" || title === "grep") {
    return "search";
  }
  return "other";
}

export interface ToolActivityPresentationInput {
  readonly itemType?: ToolLifecycleItemType | null | undefined;
  readonly title?: string | null | undefined;
  readonly detail?: string | null | undefined;
  readonly data?: unknown;
  readonly fallbackSummary?: string | null | undefined;
}

export interface ToolActivityPresentation {
  readonly summary: string;
  readonly detail?: string | undefined;
  readonly command?: string | undefined;
  readonly rawCommand?: string | undefined;
  readonly primaryPath?: string | undefined;
  readonly changedPaths?: ReadonlyArray<string> | undefined;
}

function summarizeToolTextOutput(value: string): string | undefined {
  const lines = value
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "```");
  const firstLine = lines[0];
  if (firstLine) {
    return firstLine;
  }
  if (lines.length > 1) {
    return `${lines.length} lines`;
  }
  return undefined;
}

function summarizeRawOutput(data: Record<string, unknown> | undefined): string | undefined {
  const rawOutput = asRecord(data?.rawOutput);
  if (!rawOutput) {
    return undefined;
  }

  const totalFiles =
    typeof rawOutput.totalFiles === "number" && Number.isFinite(rawOutput.totalFiles)
      ? rawOutput.totalFiles
      : undefined;
  if (totalFiles !== undefined) {
    const suffix = rawOutput.truncated === true ? "+" : "";
    return `${totalFiles} file${totalFiles === 1 ? "" : "s"}${suffix}`;
  }

  const content = asTrimmedString(rawOutput.content) ?? asTrimmedString(rawOutput.stdout);
  if (content) {
    return summarizeToolTextOutput(content);
  }

  return undefined;
}

export function deriveToolActivityPresentation(
  input: ToolActivityPresentationInput,
): ToolActivityPresentation {
  const title = asTrimmedString(input.title);
  const detail = stripTrailingExitCode(asTrimmedString(input.detail));
  const fallbackSummary = asTrimmedString(input.fallbackSummary) ?? "Tool";
  const data = asRecord(input.data);
  const commandInfo = extractToolCommand(data, title);
  const primaryPath = extractPrimaryPath(data);
  const changedPaths = extractChangedPaths(data);
  const rawOutputSummary = summarizeRawOutput(data);
  const action = classifyToolAction({
    itemType: input.itemType,
    title,
    data,
  });

  if (action === "command") {
    return {
      summary: "Ran command",
      ...(commandInfo.command ? { detail: commandInfo.command } : {}),
      ...(commandInfo.command ? { command: commandInfo.command } : {}),
      ...(commandInfo.rawCommand ? { rawCommand: commandInfo.rawCommand } : {}),
    };
  }

  if (action === "read") {
    if (primaryPath) {
      return {
        summary: "Read file",
        detail: primaryPath,
        primaryPath,
        ...(changedPaths.length > 0 ? { changedPaths } : {}),
      };
    }
    if (rawOutputSummary) {
      return {
        summary: "Read file",
        detail: rawOutputSummary,
      };
    }
    return {
      summary: "Read file",
    };
  }

  if (action === "file_change") {
    return {
      summary: "Changed files",
      ...(primaryPath ? { detail: primaryPath } : {}),
      ...(primaryPath ? { primaryPath } : {}),
      ...(changedPaths.length > 0 ? { changedPaths } : {}),
    };
  }

  if (action === "search") {
    const query =
      asTrimmedString(asRecord(data?.rawInput)?.query) ??
      asTrimmedString(asRecord(data?.rawInput)?.pattern) ??
      asTrimmedString(asRecord(data?.rawInput)?.searchTerm);
    return {
      summary: "Searched files",
      ...(query ? { detail: query } : rawOutputSummary ? { detail: rawOutputSummary } : {}),
    };
  }

  if (detail && !isEquivalent(detail, title) && !isEquivalent(detail, fallbackSummary)) {
    return {
      summary: title ?? fallbackSummary,
      detail,
      ...(commandInfo.command ? { command: commandInfo.command } : {}),
      ...(commandInfo.rawCommand ? { rawCommand: commandInfo.rawCommand } : {}),
      ...(primaryPath ? { primaryPath } : {}),
      ...(changedPaths.length > 0 ? { changedPaths } : {}),
    };
  }

  return {
    summary: title ?? fallbackSummary,
    ...(rawOutputSummary &&
    !isEquivalent(rawOutputSummary, title) &&
    !isEquivalent(rawOutputSummary, fallbackSummary)
      ? { detail: rawOutputSummary }
      : {}),
    ...(commandInfo.command ? { command: commandInfo.command } : {}),
    ...(commandInfo.rawCommand ? { rawCommand: commandInfo.rawCommand } : {}),
    ...(primaryPath ? { primaryPath } : {}),
    ...(changedPaths.length > 0 ? { changedPaths } : {}),
  };
}

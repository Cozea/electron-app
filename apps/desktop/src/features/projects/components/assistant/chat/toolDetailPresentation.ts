/**
 * Recovers a readable heading and detail from provider tool rows whose title is
 * only a generic category.
 *
 * Some adapters (notably the Claude Agent SDK path) label every tool row with
 * its category — "Tool call", "File change", "MCP tool call" — and serialize the
 * real tool name plus its arguments into the detail as `Read: {"file_path":…}`.
 * That renders as a wall of JSON. Everything needed to do better is already in
 * that string, so parse it back out rather than showing it raw.
 *
 * Adapters that already produce good titles (ACP's "Read file", Codex's
 * `server · tool`) are left untouched — see isGenericToolTitle.
 */

/** Titles that carry no information beyond the tool category. */
const GENERIC_TOOL_TITLES = new Set([
  "command run",
  "file change",
  "mcp tool call",
  "subagent task",
  "web search",
  "image view",
  "tool call",
  "item",
  "tool",
]);

export function isGenericToolTitle(title: string | undefined): boolean {
  if (!title) return true;
  return GENERIC_TOOL_TITLES.has(title.trim().toLowerCase());
}

export interface ParsedToolDetail {
  readonly toolName: string;
  readonly args: Record<string, unknown> | null;
  /** Detail text when it was not a JSON payload (e.g. `Bash: bun test`). */
  readonly text: string | null;
}

/**
 * Splits `ToolName: <rest>` into its parts. `rest` is parsed as JSON when it
 * looks like an object, and kept as text otherwise. Returns null when the
 * detail does not have this shape at all.
 */
export function parseToolDetail(detail: string | undefined): ParsedToolDetail | null {
  const trimmed = detail?.trim();
  if (!trimmed) return null;

  const separator = trimmed.indexOf(": ");
  if (separator <= 0) return null;

  const toolName = trimmed.slice(0, separator).trim();
  // A tool name is a bare identifier; anything with spaces or punctuation is
  // prose that happens to contain a colon.
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(toolName)) return null;

  const rest = trimmed.slice(separator + 2).trim();
  if (!rest) return null;

  if (rest.startsWith("{")) {
    // The adapter truncates long payloads with a trailing ellipsis, so a parse
    // failure here is expected rather than exceptional.
    try {
      const parsed: unknown = JSON.parse(rest);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { toolName, args: parsed as Record<string, unknown>, text: null };
      }
    } catch {
      // fall through to salvage
    }
    // Adapters cap the payload (Claude truncates at 397 chars), so an edit
    // carrying a large body arrives as invalid JSON. Recover whatever complete
    // string fields the prefix still holds rather than dropping the row's file.
    const salvaged = salvageJsonStringFields(rest);
    return { toolName, args: salvaged, text: null };
  }

  return { toolName, args: null, text: rest };
}

/**
 * Pull complete `"key": "value"` pairs out of a truncated JSON prefix. Only
 * fully-closed string values are taken, so a half-written value is skipped
 * rather than reported with its tail missing.
 */
function salvageJsonStringFields(input: string): Record<string, unknown> | null {
  const pattern = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"((?:[^"\\]|\\.)*)"/gu;
  const salvaged: Record<string, unknown> = {};
  let found = false;
  for (const match of input.matchAll(pattern)) {
    const key = match[1];
    const raw = match[2];
    if (key === undefined || raw === undefined) continue;
    try {
      salvaged[key] = JSON.parse(`"${raw}"`) as string;
      found = true;
    } catch {
      // Skip a value we cannot decode rather than guessing at it.
    }
  }
  return found ? salvaged : null;
}

function firstString(
  args: Record<string, unknown> | null,
  keys: ReadonlyArray<string>,
): string | undefined {
  if (!args) return undefined;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

const PATH_KEYS = ["file_path", "filePath", "path", "notebook_path", "target_file"] as const;
const PATTERN_KEYS = ["pattern", "query", "regex", "search"] as const;
const COMMAND_KEYS = ["command", "cmd", "script"] as const;
const URL_KEYS = ["url", "href"] as const;
const PROMPT_KEYS = ["description", "prompt", "instructions"] as const;

export interface ToolDetailStat {
  readonly additions: number;
  readonly deletions: number;
}

export interface ToolDetailPresentation {
  /** Past-tense verb shown in muted weight: "Created", "Edited", "Read". */
  readonly heading: string;
  /** The object of the verb — a basename for file work, else a command or query. */
  readonly detail: string | undefined;
  /** Full path behind a basename, for tooltips and diff navigation. */
  readonly path: string | undefined;
  /** Line counts derived from the tool arguments, when they carry the content. */
  readonly stat: ToolDetailStat | undefined;
}

/** Lines in a payload, ignoring one trailing newline. */
function countLines(value: string): number {
  if (value.length === 0) return 0;
  const withoutTrailingNewline = value.endsWith("\n") ? value.slice(0, -1) : value;
  return withoutTrailingNewline.split("\n").length;
}

function basename(pathValue: string): string {
  return pathValue.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? pathValue;
}

/**
 * Derive line counts from edit-shaped arguments. A write carries the whole file
 * as `content`; an edit carries the before/after strings; a multi-edit carries
 * an array of them. Anything else yields no stat rather than a guessed one.
 */
function deriveStat(
  normalized: string,
  args: Record<string, unknown> | null,
): ToolDetailStat | undefined {
  if (!args) return undefined;

  if (normalized === "write" || normalized === "create" || normalized === "createfile") {
    const content = args.content ?? args.file_text ?? args.text;
    if (typeof content === "string") {
      return { additions: countLines(content), deletions: 0 };
    }
    return undefined;
  }

  const edits = Array.isArray(args.edits) ? args.edits : [args];
  let additions = 0;
  let deletions = 0;
  let sawEdit = false;
  for (const edit of edits) {
    if (edit === null || typeof edit !== "object") continue;
    const record = edit as Record<string, unknown>;
    const before = record.old_string ?? record.oldString ?? record.old_str;
    const after = record.new_string ?? record.newString ?? record.new_str;
    if (typeof before !== "string" && typeof after !== "string") continue;
    sawEdit = true;
    if (typeof before === "string") deletions += countLines(before);
    if (typeof after === "string") additions += countLines(after);
  }
  return sawEdit ? { additions, deletions } : undefined;
}

/**
 * Maps a parsed tool call to a human heading plus the one argument worth
 * showing. Names follow the common agent tool vocabulary; anything unrecognized
 * falls back to the tool's own name, which still beats raw JSON.
 */
export function presentToolDetail(parsed: ParsedToolDetail): ToolDetailPresentation {
  const { toolName, args, text } = parsed;
  const normalized = toolName.toLowerCase();
  const path = firstString(args, PATH_KEYS);
  const pattern = firstString(args, PATTERN_KEYS);
  const command = firstString(args, COMMAND_KEYS) ?? (text ?? undefined);
  const url = firstString(args, URL_KEYS);
  const stat = deriveStat(normalized, args);

  /** File work reads as "<verb> <basename>", with the path kept for the tooltip. */
  const forFile = (heading: string): ToolDetailPresentation => ({
    heading,
    detail: path ? basename(path) : undefined,
    path,
    stat,
  });
  const forValue = (heading: string, value: string | undefined): ToolDetailPresentation => ({
    heading,
    detail: value,
    path: undefined,
    stat: undefined,
  });

  if (normalized === "read" || normalized === "readfile" || normalized === "view") {
    return forFile("Read");
  }
  if (normalized === "write" || normalized === "create" || normalized === "createfile") {
    return forFile("Created");
  }
  if (
    normalized === "edit" ||
    normalized === "multiedit" ||
    normalized === "notebookedit" ||
    normalized === "applypatch" ||
    normalized === "str_replace_editor"
  ) {
    return forFile("Edited");
  }
  if (normalized === "delete" || normalized === "remove" || normalized === "rm") {
    return forFile("Deleted");
  }
  if (
    normalized === "bash" ||
    normalized === "shell" ||
    normalized === "run" ||
    normalized === "terminal" ||
    normalized === "executecommand"
  ) {
    return forValue("Ran", command);
  }
  if (normalized === "grep" || normalized === "search" || normalized === "codebase_search") {
    return forValue("Searched", pattern);
  }
  if (
    normalized === "glob" ||
    normalized === "find" ||
    normalized === "listfiles" ||
    normalized === "ls"
  ) {
    return forValue("Listed", pattern ?? path);
  }
  if (normalized === "websearch") {
    return forValue("Searched the web", pattern);
  }
  if (normalized === "webfetch" || normalized === "fetch") {
    return forValue("Fetched", url);
  }
  if (normalized === "task" || normalized === "agent") {
    return forValue("Delegated", firstString(args, PROMPT_KEYS));
  }
  if (normalized === "todowrite" || normalized === "todoread") {
    return forValue("Updated todos", undefined);
  }

  // MCP tools arrive as `mcp__<server>__<tool>`. The server name is noise in a
  // timeline — the tool name alone identifies the call.
  const mcpMatch = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/.exec(toolName);
  if (mcpMatch?.[1]) {
    return forValue(mcpMatch[1], undefined);
  }

  return {
    heading: toolName,
    detail: path ? basename(path) : (command ?? pattern ?? url),
    path,
    stat,
  };
}

/**
 * Entry point: given a row's title and detail, return improved values, or null
 * when the row is already well presented and should be left alone.
 */
/** A title that is itself a bare tool name, e.g. OpenCode's `read` / `bash`. */
function toolNameTitle(title: string | undefined): string | null {
  const trimmed = title?.trim();
  if (!trimmed || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(trimmed)) return null;
  // Only claim it when the name maps to a verb we actually know; anything else
  // is left to the existing capitalized-title rendering.
  const probe = presentToolDetail({ toolName: trimmed, args: null, text: null });
  return probe.heading === trimmed ? null : trimmed;
}

/**
 * Detail that is tool *output* rather than an argument — OpenCode sends the
 * command's stdout or the file's contents here. Never worth a row preview.
 */
function detailLooksLikeOutput(detail: string | undefined): boolean {
  if (!detail) return false;
  return detail.includes("\n") || detail.trim().length > 120;
}

export function normalizeToolRowPresentation(input: {
  readonly title: string | undefined;
  readonly detail: string | undefined;
}): ToolDetailPresentation | null {
  // Providers that embed the tool name in the detail (`Read: {json}`).
  if (isGenericToolTitle(input.title)) {
    const parsed = parseToolDetail(input.detail);
    if (parsed) return presentToolDetail(parsed);
    return null;
  }

  // Providers that put the tool name in the title and the tool's output in the
  // detail. The verb is recoverable; the arguments are not, so show the verb
  // alone rather than a wall of stdout.
  const named = toolNameTitle(input.title);
  if (named) {
    const presentation = presentToolDetail({
      toolName: named,
      args: null,
      text: detailLooksLikeOutput(input.detail) ? null : (input.detail?.trim() ?? null),
    });
    return presentation;
  }

  return null;
}

/** Action classification recovered from a generic row, for group summaries. */
export type NormalizedToolAction = "read" | "edit" | "command" | "code-search" | "search";

const HEADING_ACTIONS: ReadonlyMap<string, NormalizedToolAction> = new Map([
  ["Read", "read"],
  ["Created", "edit"],
  ["Edited", "edit"],
  ["Deleted", "edit"],
  ["Ran", "command"],
  ["Searched", "code-search"],
  ["Listed", "code-search"],
  ["Searched the web", "search"],
  ["Fetched", "search"],
]);

/**
 * Lets a group summary say "Read 1 file" instead of "Used 1 tool" for rows whose
 * provider only reported a generic category. Returns null when the row is
 * already well labelled or the tool is unrecognized.
 */
export function normalizedToolAction(input: {
  readonly title: string | undefined;
  readonly detail: string | undefined;
}): NormalizedToolAction | null {
  const presentation = normalizeToolRowPresentation(input);
  if (!presentation) return null;
  return HEADING_ACTIONS.get(presentation.heading) ?? null;
}

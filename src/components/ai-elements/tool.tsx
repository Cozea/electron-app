 
"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { getFileIcon, getFolderIcon } from "@/lib/fileExplorer/fileIcons";
import type { ToolUIPart } from "ai";
import {
  CheckIcon,
  ChevronDownIcon,
  XIcon,
  Loader2Icon,
  // Tool-specific icons (matching VS Code Codicons)
  FileTextIcon,
  FolderOpenIcon,
  SearchIcon,
  FileSearch2Icon,
  FilePlusIcon,
  PencilIcon,
  FilesIcon,
  TerminalIcon,
  GlobeIcon,
  ListChecksIcon,
  GitCompareIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement, createElement } from "react";
import { CodeBlock } from "./code-block";

// Tool name to icon mapping (matching VS Code Codicons)
const TOOL_ICONS: Record<string, LucideIcon> = {
  // Filesystem - read operations
  read: FileTextIcon,
  list: FolderOpenIcon,
  glob: SearchIcon,
  grep: FileSearch2Icon,
  // Filesystem - write operations
  write: FilePlusIcon,
  edit: PencilIcon,
  multiedit: FilesIcon,
  // Terminal/Code
  bash: TerminalIcon,
  apply_patch: GitCompareIcon,
  // Web
  web_search: GlobeIcon,
  // Workflow
  plan_write: ListChecksIcon,
  todowrite: ListChecksIcon,
  preview_start: GlobeIcon,
  preview_browser: GlobeIcon,
  build_complete: CheckIcon,
};

export const getToolIcon = (toolName: string): LucideIcon => {
  return TOOL_ICONS[toolName] || WrenchIcon;
};

// Tool message templates for present and past tense
const TOOL_MESSAGES: Record<string, { present: string; past: string }> = {
  read: { present: "Reading", past: "Read" },
  list: { present: "Listing", past: "Listed" },
  glob: { present: "Searching", past: "Searched" },
  grep: { present: "Searching in", past: "Searched in" },
  write: { present: "Creating", past: "Created" },
  edit: { present: "Editing", past: "Edited" },
  multiedit: { present: "Editing", past: "Edited" },
  bash: { present: "Running", past: "Ran" },
  apply_patch: { present: "Applying patch", past: "Applied patch" },
  web_search: { present: "Searching", past: "Searched" },
  plan_write: { present: "Writing plans", past: "Wrote plans" },
  todowrite: { present: "Updating tasks", past: "Updated tasks" },
  preview_start: { present: "Starting preview", past: "Started preview" },
  preview_browser: { present: "Checking page", past: "Checked page" },
  build_complete: { present: "Finalizing build", past: "Finalized build" },
};

// Extract filename from a file path
const getFileName = (filePath: string): string => {
  if (!filePath) return "";
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

// Extract folder name from a path
const getFolderName = (path: string): string => {
  if (!path) return "";
  const parts = path.replace(/[/\\]$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || path;
};

// Get the target (file/folder/query) from tool input
const getToolTarget = (
  toolName: string,
  input: Record<string, unknown> | undefined
): { type: "file" | "folder" | "query" | "command" | null; value: string } => {
  if (!input) return { type: null, value: "" };

  switch (toolName) {
    case "read":
    case "write":
    case "edit":
      return {
        type: "file",
        value: getFileName(String(input.filePath || input.file_path || "")),
      };
    case "list":
      return {
        type: "folder",
        value: getFolderName(String(input.path || input.dirPath || input.dir_path || "")),
      };
    case "glob":
    case "grep":
      return {
        type: "query",
        value: String(input.pattern || input.query || ""),
      };
    case "bash":
      return {
        type: "command",
        value: String(input.command || ""),
      };
    case "web_search":
      return {
        type: "query",
        value: String(input.query || ""),
      };
    case "multiedit": {
      const edits = (Array.isArray(input.edits) ? input.edits : input.replacements) as Array<{ filePath?: string }> | undefined;
      if (edits && edits.length > 0) {
        const defaultFilePath = typeof input.filePath === 'string' ? input.filePath : undefined;
        const fileCount = new Set(edits.map((r) => r.filePath || defaultFilePath)).size;
        return {
          type: "file",
          value: fileCount > 1 ? `${fileCount} files` : getFileName(String(edits[0]?.filePath || defaultFilePath || "")),
        };
      }
      return { type: null, value: "" };
    }
    default:
      return { type: null, value: "" };
  }
};

interface DiffStats {
  added: number;
  removed: number;
}

function countContentLines(content: string): number {
  if (!content) return 0;
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized) return 0;
  const lines = normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
  return lines.filter(() => true).length;
}

function getDiffStatsForTool(
  toolName?: string,
  input?: Record<string, unknown>
) : DiffStats | null {
  if (!toolName || !input) return null;

  if (toolName === "write" || toolName === "edit") {
    const filePath = input.filePath || input.file_path;
    if (typeof filePath !== "string" || !filePath.trim()) return null;
    const oldString = String(input.oldString || input.old_string || "");
    const newString = String(input.newString || input.new_string || input.content || "");
    const added = countContentLines(newString);
    const removed = countContentLines(oldString);
    return added > 0 || removed > 0 ? { added, removed } : null;
  }

  if (toolName === "multiedit") {
    const edits = Array.isArray(input.edits) ? input.edits : Array.isArray(input.replacements) ? input.replacements : [];
    const defaultFilePath = typeof input.filePath === 'string' ? input.filePath : undefined;
    let added = 0;
    let removed = 0;
    for (const item of edits) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const filePath = record.filePath || record.file_path || defaultFilePath;
      if (typeof filePath !== "string" || filePath.trim().length === 0) continue;
      added += countContentLines(String(record.newString || record.new_string || ""));
      removed += countContentLines(String(record.oldString || record.old_string || ""));
    }
    return added > 0 || removed > 0 ? { added, removed } : null;
  }

  if (toolName === "apply_patch") {
    const patchInput = input.patchText || input.input || input.patch;
    if (typeof patchInput !== "string" || !patchInput.trim()) return null;
    let added = 0;
    let removed = 0;
    const lines = patchInput.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
      if (line.startsWith("+")) {
        added += 1;
      } else if (line.startsWith("-")) {
        removed += 1;
      }
    }
    return added > 0 || removed > 0 ? { added, removed } : null;
  }

  return null;
}

const DiffStatsBadge = ({ added, removed }: DiffStats) => (
  <span className="inline-flex items-center gap-1 font-mono text-[13px] leading-none tabular-nums">
    {added > 0 ? <span className="text-emerald-400/70">+{added}</span> : null}
    {removed > 0 ? <span className="text-red-400/70">-{removed}</span> : null}
  </span>
);

function getToolHeaderCopy(
  toolName: string | undefined,
  input: Record<string, unknown> | undefined,
  title: string | undefined,
  type: string,
  state: ToolState
): { heading: string; preview: string | null } {
  const isComplete = state === "output-available";
  const isError = state === "output-error" || state === "output-denied";
  const target = toolName ? getToolTarget(toolName, input) : { type: null, value: "" };
  const messages = toolName ? TOOL_MESSAGES[toolName] : null;
  const actionVerb = messages
    ? isComplete || isError
      ? messages.past
      : messages.present
    : title ?? type.split("-").slice(1).join("-");

  const preview = target.value.trim().length > 0 ? target.value.trim() : null;
  return {
    heading: actionVerb,
    preview,
  };
}

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      "group/tool-row not-prose w-full rounded-md data-[state=closed]:mb-1 data-[state=open]:mb-2",
      className
    )}
    {...props}
  />
);

// Non-expandable tool display (for tools like read where output isn't useful to show)
export type ToolStaticProps = ComponentProps<"div"> & {
  title?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  type?: string;
  state: ToolState;
};

export const ToolStatic = ({
  className,
  title,
  toolName,
  input,
  type = "function",
  state,
  ...props
}: ToolStaticProps) => {
  const Icon = toolName ? getToolIcon(toolName) : WrenchIcon;
  const diffStats = getDiffStatsForTool(toolName, input);
  const headerCopy = getToolHeaderCopy(toolName, input, title, type, state);
  const displayText = headerCopy.preview
    ? `${headerCopy.heading} - ${headerCopy.preview}`
    : headerCopy.heading;

  return (
    <div
      className={cn("not-prose mb-1 w-full rounded-md px-1 py-1", className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center">
          {createElement(Icon, { className: "size-4 text-muted-foreground/70" })}
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="truncate text-[13px] leading-5 text-muted-foreground/70" title={displayText}>
            <span className="text-foreground/85">{headerCopy.heading}</span>
            {headerCopy.preview ? (
              <span className="text-muted-foreground/55"> - {headerCopy.preview}</span>
            ) : null}
          </p>
        </div>
        {diffStats ? <DiffStatsBadge added={diffStats.added} removed={diffStats.removed} /> : null}
        {getStatusIcon(state)}
      </div>
    </div>
  );
};

ToolStatic.displayName = "ToolStatic";

type ToolState = ToolUIPart["state"] | "approval-requested" | "approval-responded";

export type ToolHeaderProps = {
  title?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  type: ToolUIPart["type"] | string;
  state: ToolState;
  className?: string;
};

// VS Code style status icon (icon only, no text)
export const getStatusIcon = (status: ToolState): ReactNode => {
  switch (status) {
    case "input-streaming":
      return <Loader2Icon className="size-4 text-muted-foreground animate-spin" />;
    case "input-available":
      return <Loader2Icon className="size-4 text-muted-foreground animate-spin" />;
    case "approval-requested":
      return <Loader2Icon className="size-4 text-yellow-500 animate-spin" />;
    case "approval-responded":
      return <CheckIcon className="size-4 text-blue-500" />;
    case "output-available":
      return null;
    case "output-error":
      return <XIcon className="size-4 text-red-500" />;
    case "output-denied":
      return <XIcon className="size-4 text-orange-500" />;
    default:
      return <Loader2Icon className="size-4 text-muted-foreground animate-spin" />;
  }
};

export const ToolHeader = ({
  className,
  title,
  toolName,
  input,
  type,
  state,
  ...props
}: ToolHeaderProps) => {
  const Icon = toolName ? getToolIcon(toolName) : WrenchIcon;
  const diffStats = getDiffStatsForTool(toolName, input);
  const headerCopy = getToolHeaderCopy(toolName, input, title, type, state);
  const displayText = headerCopy.preview
    ? `${headerCopy.heading} - ${headerCopy.preview}`
    : headerCopy.heading;

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-background/80",
        className
      )}
      {...props}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        {createElement(Icon, { className: "size-4 text-muted-foreground/70" })}
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="truncate text-[13px] leading-5 text-muted-foreground/70" title={displayText}>
          <span className="text-foreground/85">{headerCopy.heading}</span>
          {headerCopy.preview ? (
            <span className="text-muted-foreground/55"> - {headerCopy.preview}</span>
          ) : null}
        </p>
      </div>
      {diffStats ? <DiffStatsBadge added={diffStats.added} removed={diffStats.removed} /> : null}
      {getStatusIcon(state)}
      <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground/65 opacity-0 transition-[opacity,transform] group-hover/tool-row:opacity-100 group-focus-within/tool-row:opacity-100 group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden p-4", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock
        code={JSON.stringify(input, null, 2)}
        language="json"
        className="[--codeblock-surface:var(--tool-surface)] [--codeblock-foreground:var(--tool-surface-foreground)] border-0"
      />
    </div>
  </div>
);

// Visual directory listing component
type DirEntry = {
  name: string;
  type: "file" | "directory";
};

const ListDirOutput = ({ entries }: { entries: DirEntry[] }) => {
  // Separate directories and files, then sort alphabetically
  const directories = entries
    .filter((e) => e.type === "directory")
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((e) => e.type === "file")
    .sort((a, b) => a.name.localeCompare(b.name));
  const sortedEntries = [...directories, ...files];

  return (
    <div className="p-3 space-y-0.5">
      {sortedEntries.map((entry, index) => {
        const isDirectory = entry.type === "directory";
        const icon = isDirectory
          ? getFolderIcon(entry.name, false, { width: 16, height: 16 })
          : getFileIcon(entry.name, { width: 16, height: 16 });

        return (
          <div
            key={`${entry.name}-${index}`}
            className="flex items-center gap-2 py-0.5 px-1 rounded hover:bg-muted/50"
          >
            {icon}
            <span className={cn("text-sm", isDirectory && "font-medium")}>
              {entry.name}
            </span>
          </div>
        );
      })}
      {sortedEntries.length === 0 && (
        <div className="text-sm text-muted-foreground italic">Empty directory</div>
      )}
    </div>
  );
};

// Parse list output into structured entries
const parseListDirOutput = (output: unknown): DirEntry[] | null => {
  try {
    let data = output;

    // If output is a string, try to parse it as JSON
    if (typeof data === "string") {
      data = JSON.parse(data);
    }

    // Check if it's an array of entries with name and type
    if (Array.isArray(data)) {
      const entries = data as Array<{ name?: string; type?: string }>;
      if (entries.length > 0 && entries[0].name && entries[0].type) {
        return entries.map((e) => ({
          name: String(e.name),
          type: e.type === "directory" ? "directory" : "file",
        }));
      }
    }

    // Check if it has an 'entries' property (common format)
    if (typeof data === "object" && data !== null && "entries" in data) {
      const wrapper = data as { entries: Array<{ name?: string; type?: string }> };
      if (Array.isArray(wrapper.entries)) {
        return wrapper.entries.map((e) => ({
          name: String(e.name),
          type: e.type === "directory" ? "directory" : "file",
        }));
      }
    }

    return null;
  } catch {
    return null;
  }
};

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolUIPart["output"];
  errorText?: ToolUIPart["errorText"];
  toolName?: string;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  toolName,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  // Check for list special rendering
  const listDirEntries = toolName === "list" ? parseListDirOutput(output) : null;
  const showOutputLabel = errorText ? true : !listDirEntries;

  let Output = <div>{output as ReactNode}</div>;

  if (listDirEntries) {
    Output = <ListDirOutput entries={listDirEntries} />;
  } else if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock
        code={JSON.stringify(output, null, 2)}
        language="json"
        className="[--codeblock-surface:var(--tool-surface)] [--codeblock-foreground:var(--tool-surface-foreground)] border-0"
      />
    );
  } else if (typeof output === "string") {
    Output = (
      <CodeBlock
        code={output}
        language="json"
        className="[--codeblock-surface:var(--tool-surface)] [--codeblock-foreground:var(--tool-surface-foreground)] border-0"
      />
    );
  }

  return (
    <div className={cn("space-y-2 p-4", className)} {...props}>
      {showOutputLabel ? (
        <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {errorText ? "Error" : "Result"}
        </h4>
      ) : null}
      <div
        className={cn(
          "app-scrollbar overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-[var(--tool-surface)] text-[var(--tool-surface-foreground)]"
        )}
      >
        {errorText && <div className="p-3">{errorText}</div>}
        {!errorText && Output}
      </div>
    </div>
  );
};

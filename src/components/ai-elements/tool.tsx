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
  CircleDashedIcon,
  // Tool-specific icons (matching VS Code Codicons)
  FileTextIcon,
  FolderOpenIcon,
  SearchIcon,
  FileSearch2Icon,
  FilePlusIcon,
  FolderPlusIcon,
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
import { isValidElement } from "react";
import { CodeBlock } from "./code-block";

// Tool name to icon mapping (matching VS Code Codicons)
const TOOL_ICONS: Record<string, LucideIcon> = {
  // Filesystem - read operations
  read_file: FileTextIcon,
  list_dir: FolderOpenIcon,
  file_search: SearchIcon,
  grep_search: FileSearch2Icon,
  // Filesystem - write operations
  create_file: FilePlusIcon,
  create_directory: FolderPlusIcon,
  replace_string_in_file: PencilIcon,
  multi_replace_string_in_file: FilesIcon,
  // Terminal/Code
  run_in_terminal: TerminalIcon,
  get_terminal_output: TerminalIcon,
  apply_patch: GitCompareIcon,
  // Web
  web_search: GlobeIcon,
  google_search: GlobeIcon,
  // Custom
  todo_list: ListChecksIcon,
};

export const getToolIcon = (toolName: string): LucideIcon => {
  return TOOL_ICONS[toolName] || WrenchIcon;
};

// Tool message templates for present and past tense
const TOOL_MESSAGES: Record<string, { present: string; past: string }> = {
  read_file: { present: "Reading", past: "Read" },
  list_dir: { present: "Listing", past: "Listed" },
  file_search: { present: "Searching", past: "Searched" },
  grep_search: { present: "Searching in", past: "Searched in" },
  create_file: { present: "Creating", past: "Created" },
  create_directory: { present: "Creating", past: "Created" },
  replace_string_in_file: { present: "Editing", past: "Edited" },
  multi_replace_string_in_file: { present: "Editing", past: "Edited" },
  run_in_terminal: { present: "Running", past: "Ran" },
  get_terminal_output: { present: "Getting output", past: "Got output" },
  apply_patch: { present: "Applying patch", past: "Applied patch" },
  web_search: { present: "Searching", past: "Searched" },
  google_search: { present: "Searching", past: "Searched" },
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
    case "read_file":
    case "create_file":
    case "replace_string_in_file":
      return {
        type: "file",
        value: getFileName(String(input.filePath || input.file_path || "")),
      };
    case "list_dir":
    case "create_directory":
      return {
        type: "folder",
        value: getFolderName(String(input.path || input.dirPath || input.dir_path || "")),
      };
    case "file_search":
    case "grep_search":
      return {
        type: "query",
        value: String(input.query || input.pattern || ""),
      };
    case "run_in_terminal":
      return {
        type: "command",
        value: String(input.command || ""),
      };
    case "web_search":
    case "google_search":
      return {
        type: "query",
        value: String(input.query || ""),
      };
    case "multi_replace_string_in_file": {
      const replacements = input.replacements as Array<{ filePath?: string }> | undefined;
      if (replacements && replacements.length > 0) {
        const fileCount = new Set(replacements.map(r => r.filePath)).size;
        return {
          type: "file",
          value: fileCount > 1 ? `${fileCount} files` : getFileName(String(replacements[0]?.filePath || "")),
        };
      }
      return { type: null, value: "" };
    }
    default:
      return { type: null, value: "" };
  }
};

// File pill component showing tech icon + filename
const FilePill = ({
  fileName,
  type,
}: {
  fileName: string;
  type: "file" | "folder";
}) => {
  const icon = type === "folder"
    ? getFolderIcon(fileName, false, { width: 14, height: 14 })
    : getFileIcon(fileName, { width: 14, height: 14 });

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted/80 px-2 py-0.5 text-xs font-medium">
      {icon}
      <span className="max-w-[120px] truncate">{fileName}</span>
    </span>
  );
};

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

// Non-expandable tool display (for tools like read_file where output isn't useful to show)
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
  const isComplete = state === "output-available";
  const isError = state === "output-error" || state === "output-denied";

  // Get the target from input (file, folder, command, query)
  const target = toolName ? getToolTarget(toolName, input) : { type: null, value: "" };

  // Get the action verb (present or past tense based on state)
  const messages = toolName ? TOOL_MESSAGES[toolName] : null;
  const actionVerb = messages
    ? (isComplete || isError ? messages.past : messages.present)
    : null;

  // Render the header content
  const renderHeaderContent = () => {
    if (actionVerb && target.value) {
      return (
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm">{actionVerb}</span>
          {(target.type === "file" || target.type === "folder") && !target.value.includes(" files") ? (
            <FilePill fileName={target.value} type={target.type} />
          ) : target.type === "command" ? (
            <code className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-xs max-w-[200px] truncate">
              {target.value}
            </code>
          ) : target.type === "query" ? (
            <span className="rounded bg-muted/80 px-1.5 py-0.5 text-xs max-w-[150px] truncate">
              "{target.value}"
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{target.value}</span>
          )}
        </div>
      );
    }

    return (
      <span className="font-medium text-sm">
        {title ?? type.split("-").slice(1).join("-")}
      </span>
    );
  };

  return (
    <div
      className={cn("not-prose mb-4 w-full rounded-md border", className)}
      {...props}
    >
      <div className="flex w-full items-center gap-4 p-3">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          {renderHeaderContent()}
          {getStatusIcon(state)}
        </div>
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
      return <CircleDashedIcon className="size-3.5 text-muted-foreground" />;
    case "input-available":
      return <Loader2Icon className="size-3.5 text-muted-foreground animate-spin" />;
    case "approval-requested":
      return <Loader2Icon className="size-3.5 text-yellow-500 animate-spin" />;
    case "approval-responded":
      return <CheckIcon className="size-3.5 text-blue-500" />;
    case "output-available":
      return <CheckIcon className="size-3.5 text-green-500" />;
    case "output-error":
      return <XIcon className="size-3.5 text-red-500" />;
    case "output-denied":
      return <XIcon className="size-3.5 text-orange-500" />;
    default:
      return <CircleDashedIcon className="size-3.5 text-muted-foreground" />;
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
  const isComplete = state === "output-available";
  const isError = state === "output-error" || state === "output-denied";

  // Get the target from input (file, folder, command, query)
  const target = toolName ? getToolTarget(toolName, input) : { type: null, value: "" };

  // Get the action verb (present or past tense based on state)
  const messages = toolName ? TOOL_MESSAGES[toolName] : null;
  const actionVerb = messages
    ? (isComplete || isError ? messages.past : messages.present)
    : null;

  // Render the header content
  const renderHeaderContent = () => {
    // If we have a dynamic message with target, show it
    if (actionVerb && target.value) {
      return (
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm">{actionVerb}</span>
          {(target.type === "file" || target.type === "folder") && !target.value.includes(" files") ? (
            <FilePill fileName={target.value} type={target.type} />
          ) : target.type === "command" ? (
            <code className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-xs max-w-[200px] truncate">
              {target.value}
            </code>
          ) : target.type === "query" ? (
            <span className="rounded bg-muted/80 px-1.5 py-0.5 text-xs max-w-[150px] truncate">
              "{target.value}"
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{target.value}</span>
          )}
        </div>
      );
    }

    // Fallback to title or type
    return (
      <span className="font-medium text-sm">
        {title ?? type.split("-").slice(1).join("-")}
      </span>
    );
  };

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-4 p-3",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        {renderHeaderContent()}
        {getStatusIcon(state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
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
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
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

// Parse list_dir output into structured entries
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

  // Check for list_dir special rendering
  const listDirEntries = toolName === "list_dir" ? parseListDirOutput(output) : null;

  let Output = <div>{output as ReactNode}</div>;

  if (listDirEntries) {
    Output = <ListDirOutput entries={listDirEntries} />;
  } else if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2 p-4", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div className="p-3">{errorText}</div>}
        {!errorText && Output}
      </div>
    </div>
  );
};

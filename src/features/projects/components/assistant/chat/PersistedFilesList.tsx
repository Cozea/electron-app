import { memo } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatWorkspaceRelativePath } from "@/lib/filePathDisplay";
import { cn } from "@/lib/utils";

import { VscodeEntryIcon } from "./VscodeEntryIcon";

interface PersistedFilesListProps {
  savedFiles?: ReadonlyArray<string>;
  failedFiles?: ReadonlyArray<{ path: string; error?: string | null }>;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
}

const MAX_VISIBLE_SAVED_FILES = 6;
const MAX_VISIBLE_FAILED_FILES = 4;

function fileRowClassName(kind: "saved" | "failed"): string {
  return kind === "failed"
    ? "text-destructive hover:bg-destructive/6"
    : "text-muted-foreground/85 hover:bg-background/80";
}

function countLabel(label: string, count: number): string {
  return `${label} (${count})`;
}

export const PersistedFilesList = memo(function PersistedFilesList(
  props: PersistedFilesListProps,
) {
  const savedFiles = props.savedFiles ?? [];
  const failedFiles = props.failedFiles ?? [];

  if (savedFiles.length === 0 && failedFiles.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 space-y-1 pl-6">
      {savedFiles.length > 0 ? (
        <div className="space-y-0.5">
          <p className="px-1 text-[10px] font-medium uppercase tracking-[0.08em] text-emerald-700/80 dark:text-emerald-300/80">
            {countLabel("Saved", savedFiles.length)}
          </p>
          <div className="space-y-0.5">
            {savedFiles.slice(0, MAX_VISIBLE_SAVED_FILES).map((filePath) => (
              <PersistedFileRow
                key={`saved:${filePath}`}
                filePath={filePath}
                kind="saved"
                workspaceRoot={props.workspaceRoot}
                resolvedTheme={props.resolvedTheme}
              />
            ))}
            {savedFiles.length > MAX_VISIBLE_SAVED_FILES ? (
              <p className="px-1 text-[10px] text-muted-foreground/55">
                +{savedFiles.length - MAX_VISIBLE_SAVED_FILES} more
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {failedFiles.length > 0 ? (
        <div className="space-y-0.5">
          <p className="px-1 text-[10px] font-medium uppercase tracking-[0.08em] text-destructive/80">
            {countLabel("Failed", failedFiles.length)}
          </p>
          <div className="space-y-0.5">
            {failedFiles.slice(0, MAX_VISIBLE_FAILED_FILES).map((file) => (
              <PersistedFileRow
                key={`failed:${file.path}`}
                filePath={file.path}
                detail={file.error ?? undefined}
                kind="failed"
                workspaceRoot={props.workspaceRoot}
                resolvedTheme={props.resolvedTheme}
              />
            ))}
            {failedFiles.length > MAX_VISIBLE_FAILED_FILES ? (
              <p className="px-1 text-[10px] text-muted-foreground/55">
                +{failedFiles.length - MAX_VISIBLE_FAILED_FILES} more
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});

const PersistedFileRow = memo(function PersistedFileRow(props: {
  filePath: string;
  detail?: string;
  kind: "saved" | "failed";
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
}) {
  const displayPath = formatWorkspaceRelativePath(props.filePath, props.workspaceRoot);
  const title = props.detail ? `${displayPath}\n${props.detail}` : displayPath;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors",
            fileRowClassName(props.kind),
          )}
          title={title}
        >
          <VscodeEntryIcon
            pathValue={props.filePath}
            kind="file"
            theme={props.resolvedTheme}
            className="size-3.5"
          />
          <span className="truncate font-mono text-[10px] leading-4">{displayPath}</span>
        </div>
      </TooltipTrigger>
      {props.detail ? (
        <TooltipContent className="max-w-[min(42rem,calc(100vw-2rem))]">
          <p className="whitespace-pre-wrap break-words text-xs leading-5">{title}</p>
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
});

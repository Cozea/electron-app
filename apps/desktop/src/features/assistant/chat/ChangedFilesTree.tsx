

import { HugeiconsIcon } from '@hugeicons/react'
import {
  ChevronDoubleCloseIcon as __ChevronRightIconHugeIcon,
  ArrowUpDownIcon as __ChevronsUpDownIconHugeIcon,
  FileValidationIcon as __FileDiffIconHugeIcon,
} from '@hugeicons/core-free-icons'

import { type TurnId } from "@cozea/assistant-contracts";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { type TurnDiffFileChange } from "@/features/assistant/model/types";
import { buildTurnDiffTree, summarizeTurnDiffStats, type TurnDiffTreeNode } from "./turnDiffTree";
import {
  changedFileName,
  selectChangedFilePreview,
  summarizeChangedFileScopes,
} from "./changedFilesPresentation";
import { cn } from "@/lib/utils";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { VscodeEntryIcon } from "./VscodeEntryIcon";
import { usePretextOverflowTitleFor } from "@/hooks/usePretextOverflowTitle";
import { NativeProjectFolderIcon } from "@/components/NativeProjectFolderIcon";

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const { files, allDirectoriesExpanded, onOpenTurnDiff, resolvedTheme, turnId } = props;
  const { containerRef, getOverflowTitle } = usePretextOverflowTitleFor<HTMLDivElement>({
    font: "13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  });
  const treeNodes = useMemo(() => buildTurnDiffTree(files), [files]);
  const directoryPathsKey = useMemo(
    () => collectDirectoryPaths(treeNodes).join("\u0000"),
    [treeNodes],
  );
  const allDirectoryExpansionState = useMemo(
    () =>
      buildDirectoryExpansionState(
        directoryPathsKey ? directoryPathsKey.split("\u0000") : [],
        allDirectoriesExpanded,
      ),
    [allDirectoriesExpanded, directoryPathsKey],
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>(() =>
    buildDirectoryExpansionState(directoryPathsKey ? directoryPathsKey.split("\u0000") : [], true),
  );
  useEffect(() => {
    setExpandedDirectories(allDirectoryExpansionState);
  }, [allDirectoryExpansionState]);

  const toggleDirectory = useCallback((pathValue: string, fallbackExpanded: boolean) => {
    setExpandedDirectories((current) => ({
      ...current,
      [pathValue]: !(current[pathValue] ?? fallbackExpanded),
    }));
  }, []);

  const renderTreeNode = (node: TurnDiffTreeNode, depth: number) => {
    const leftPadding = 8 + depth * 14;
    const getNodeTitle = (hasStat: boolean) => {
      const leadingGlyphSpace = 14 + 6 + 14 + 6;
      const trailingSpace = hasStat ? 72 : 8;
      const reservedWidth = leftPadding + leadingGlyphSpace + trailingSpace;
      return getOverflowTitle(node.name, reservedWidth);
    };
    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? depth === 0;
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
            style={{ paddingLeft: `${leftPadding}px` }}
            onClick={() => toggleDirectory(node.path, depth === 0)}
          >
            <HugeiconsIcon icon={__ChevronRightIconHugeIcon}
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
                isExpanded && "rotate-90",
              )}
            />
            <NativeProjectFolderIcon folderPath={node.path} className="size-3.5" imgClassName="size-3.5" />
            <span
              className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90"
              title={getNodeTitle(Boolean(node.stat && hasNonZeroStat(node.stat)))}
            >
              {node.name}
            </span>
            {hasNonZeroStat(node.stat) && (
              <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
                <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
              </span>
            )}
          </button>
          {isExpanded && (
            <div className="space-y-0.5">
              {node.children.map((childNode) => renderTreeNode(childNode, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        key={`file:${node.path}`}
        type="button"
        className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
        style={{ paddingLeft: `${leftPadding}px` }}
        onClick={() => onOpenTurnDiff(turnId, node.path)}
      >
        <span aria-hidden="true" className="size-3.5 shrink-0" />
        <VscodeEntryIcon
          pathValue={node.path}
          kind="file"
          theme={resolvedTheme}
          className="size-3.5 text-muted-foreground/70"
        />
        <span
          className="truncate font-mono text-[11px] text-muted-foreground/80 group-hover:text-foreground/90"
          title={getNodeTitle(Boolean(node.stat))}
        >
          {node.name}
        </span>
        {node.stat && (
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
            <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
          </span>
        )}
      </button>
    );
  };

  return <div ref={containerRef} className="space-y-0.5">{treeNodes.map((node) => renderTreeNode(node, 0))}</div>;
});

function collectDirectoryPaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
}

function buildDirectoryExpansionState(
  directoryPaths: ReadonlyArray<string>,
  expanded: boolean,
): Record<string, boolean> {
  const expandedState: Record<string, boolean> = {};
  for (const directoryPath of directoryPaths) {
    expandedState[directoryPath] = expanded;
  }
  return expandedState;
}

/**
 * Collapsible wrapper around the changed-files tree, ported from upstream.
 * Collapsed it shows a scope tally and a spread of file chips rather than the
 * whole tree, so a turn touching thirty files stays readable in the timeline.
 */
export const ChangedFilesCard = memo(function ChangedFilesCard(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  expanded: boolean;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onExpandedChange: (expanded: boolean) => void;
  onToggleAllDirectories: () => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const {
    turnId,
    files,
    expanded,
    allDirectoriesExpanded,
    resolvedTheme,
    onExpandedChange,
    onToggleAllDirectories,
    onOpenTurnDiff,
  } = props;
  const summaryStat = useMemo(() => summarizeTurnDiffStats(files), [files]);
  const scopeSummary = useMemo(() => summarizeChangedFileScopes(files), [files]);
  const previewFiles = useMemo(() => selectChangedFilePreview(files), [files]);

  if (files.length === 0) return null;

  return (
    <div
      className="mt-2 rounded-lg bg-[var(--assistant-change-card-surface)] p-2.5"
      data-changed-files-state={expanded ? "expanded" : "preview"}
    >
      <div className="group mb-2 flex items-center justify-between gap-2 pr-2 pl-1.5 pt-1">
        <button
          type="button"
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left text-[11px] font-normal text-muted-foreground/60 transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onExpandedChange(!expanded)}
        >
          <HugeiconsIcon
            icon={__ChevronRightIconHugeIcon}
            className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
            aria-hidden="true"
          />
          <span>
            {files.length} changed file{files.length === 1 ? "" : "s"}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasNonZeroStat(summaryStat) && (
            <div className="font-mono text-[10px] tabular-nums">
              <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
            </div>
          )}
          {expanded && (
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
              onClick={onToggleAllDirectories}
              title={allDirectoriesExpanded ? "Collapse all" : "Expand all"}
              aria-label={allDirectoriesExpanded ? "Collapse all" : "Expand all"}
            >
              <HugeiconsIcon icon={__ChevronsUpDownIconHugeIcon} className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            className="flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onOpenTurnDiff(turnId, files[0]?.path)}
            title="Open the full diff"
            aria-label="Open the full diff"
          >
            <HugeiconsIcon icon={__FileDiffIconHugeIcon} className="size-3.5" />
          </button>
        </div>
      </div>
      {expanded ? (
        <ChangedFilesTree
          key={`changed-files-tree:${turnId}`}
          turnId={turnId}
          files={files}
          allDirectoriesExpanded={allDirectoriesExpanded}
          resolvedTheme={resolvedTheme}
          onOpenTurnDiff={onOpenTurnDiff}
        />
      ) : (
        <div className="px-1.5 pb-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground/60">
            {scopeSummary.map((scope, index) => (
              <span key={scope.label} className="inline-flex items-center gap-1">
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                <span className="font-mono text-foreground/75">{scope.label}</span>
                <span>
                  {scope.fileCount} file{scope.fileCount === 1 ? "" : "s"}
                </span>
              </span>
            ))}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {previewFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                className="inline-flex max-w-48 items-center gap-1 rounded-md border border-[var(--assistant-change-chip-border)] bg-[var(--assistant-change-chip-surface)] px-1.5 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={file.path}
                aria-label={`Open diff for ${file.path}`}
                onClick={() => onOpenTurnDiff(turnId, file.path)}
              >
                <VscodeEntryIcon
                  pathValue={file.path}
                  kind="file"
                  theme={resolvedTheme}
                  className="size-3 shrink-0"
                />
                <span className="truncate">{changedFileName(file.path)}</span>
              </button>
            ))}
            {files.length > previewFiles.length && (
              <button
                type="button"
                className="rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onExpandedChange(true)}
              >
                Show all {files.length} files
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

import { memo, useCallback, useMemo, useState } from "react";
import { HugeiconsIcon } from '@hugeicons/react';
import { 
  ArrowRight01Icon as __ChevronRightHugeIcon, 
  File01Icon as __FileIconHugeIcon
} from '@hugeicons/core-free-icons';

import { cn } from "@/lib/utils";
import { buildTurnDiffTree, type TurnDiffTreeNode } from "../../lib/turnDiffTree";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import type { ActivityFeedItem } from "../../pages/ChangesPage";
import { NativeProjectFolderIcon } from "@/features/projects/components/NativeProjectFolderIcon";
import { usePretextOverflowTitleFor } from "@/hooks/usePretextOverflowTitle";

const EMPTY_DIRECTORY_OVERRIDES: Record<string, boolean> = {};
const TREE_LABEL_FONT = "13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  files: ReadonlyArray<ActivityFeedItem>;
  allDirectoriesExpanded: boolean;
  onOpenFile: (filePath: string) => void;
}) {
  const { files, allDirectoriesExpanded, onOpenFile } = props;
  const { containerRef, getOverflowTitle } = usePretextOverflowTitleFor<HTMLDivElement>({ font: TREE_LABEL_FONT });
  const treeNodes = useMemo(() => buildTurnDiffTree(files), [files]);
  const directoryPathsKey = useMemo(
    () => collectDirectoryPaths(treeNodes).join("\u0000"),
    [treeNodes],
  );
  
  const expansionStateKey = `${allDirectoriesExpanded ? "expanded" : "collapsed"}\u0000${directoryPathsKey}`;
  const [directoryExpansionState, setDirectoryExpansionState] = useState<{
    key: string;
    overrides: Record<string, boolean>;
  }>(() => ({
    key: expansionStateKey,
    overrides: {},
  }));
  
  const expandedDirectories =
    directoryExpansionState.key === expansionStateKey
      ? directoryExpansionState.overrides
      : EMPTY_DIRECTORY_OVERRIDES;

  const toggleDirectory = useCallback(
    (pathValue: string) => {
      setDirectoryExpansionState((current) => {
        const nextOverrides = current.key === expansionStateKey ? current.overrides : {};
        return {
          key: expansionStateKey,
          overrides: {
            ...nextOverrides,
            [pathValue]: !(nextOverrides[pathValue] ?? allDirectoriesExpanded),
          },
        };
      });
    },
    [allDirectoriesExpanded, expansionStateKey],
  );

  const getTreeLabelTitle = useCallback(
    (name: string, depth: number, hasStat: boolean) => {
      const leftPadding = 8 + depth * 14;
      const leadingGlyphSpace = 14 + 6 + 16 + 6; // chevron + gaps + folder icon
      const trailingSpace = hasStat ? 72 : 8; // stat chip + right padding, or padding only
      const reservedWidth = leftPadding + leadingGlyphSpace + trailingSpace;
      return getOverflowTitle(name, reservedWidth);
    },
    [getOverflowTitle],
  );

  const renderTreeNode = (node: TurnDiffTreeNode, depth: number) => {
    const leftPadding = 8 + depth * 14;
    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? allDirectoriesExpanded;
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
            style={{ paddingLeft: `${leftPadding}px` }}
            onClick={() => toggleDirectory(node.path)}
          >
            <HugeiconsIcon
              icon={__ChevronRightHugeIcon}
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
                isExpanded && "rotate-90",
              )}
            />
            <NativeProjectFolderIcon
              folderPath={null}
              isOpen={false}
              className="size-4 shrink-0"
              imgClassName="size-4 shrink-0 object-contain"
            />
            <span
              className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90"
              title={getTreeLabelTitle(node.name, depth, Boolean(node.stat && hasNonZeroStat(node.stat)))}
            >
              {node.name}
            </span>
            {node.stat && hasNonZeroStat(node.stat) && (
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
        onClick={() => onOpenFile(node.path)}
      >
        <span aria-hidden="true" className="size-3.5 shrink-0" />
        <HugeiconsIcon
          icon={__FileIconHugeIcon}
          className="size-3.5 text-muted-foreground/70"
        />
        <span
          className="truncate font-mono text-[11px] text-muted-foreground/80 group-hover:text-foreground/90"
          title={getTreeLabelTitle(node.name, depth, Boolean(node.stat))}
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

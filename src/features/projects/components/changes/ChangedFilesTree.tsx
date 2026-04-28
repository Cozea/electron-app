import { memo, useMemo } from "react";
import type { ActivityFeedItem } from "../../pages/ChangesPage";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { cn } from "@/lib/utils";

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  files: ReadonlyArray<ActivityFeedItem>;
  allDirectoriesExpanded: boolean;
  onOpenFile: (filePath: string) => void;
}) {
  const { files, allDirectoriesExpanded, onOpenFile } = props;

  const paths = useMemo(() => files.map(f => f.filePath), [files]);

  const statsMap = useMemo(() => {
    const map = new Map<string, { additions: number, deletions: number }>();
    for (const f of files) {
      if (typeof f.additions !== 'number' || typeof f.deletions !== 'number') continue;
      map.set(f.filePath, { additions: f.additions, deletions: f.deletions });
      const parts = f.filePath.split('/').filter(Boolean);
      let current = '';
      for (let i = 0; i < parts.length - 1; i++) {
        current = current ? `${current}/${parts[i]}` : parts[i];
        const stat = map.get(current) || { additions: 0, deletions: 0 };
        stat.additions += f.additions;
        stat.deletions += f.deletions;
        map.set(current, stat);
      }
    }
    return map;
  }, [files]);

  const { model } = useFileTree({
    paths,
    flattenEmptyDirectories: true,
    initialExpansion: allDirectoriesExpanded ? 'open' : 'closed',
    renderRowDecoration: ({ item }) => {
      const stat = statsMap.get(item.path);
      if (!stat || (stat.additions === 0 && stat.deletions === 0)) return null;
      return { text: `+${stat.additions} -${stat.deletions}` };
    },
    onSelectionChange: (selectedPaths) => {
      if (selectedPaths.length > 0) {
        const path = selectedPaths[0];
        onOpenFile(path);
        // We defer deselection slightly to allow the click to register
        setTimeout(() => {
          model.getItem(path)?.deselect();
        }, 50);
      }
    }
  });

  return (
    <div className="w-full">
      <style>{`
        /* Minimal custom styling for the tree component to match Cozea */
        .cozea-pierre-tree {
          --trees-bg: transparent;
          --trees-fg: var(--foreground);
          --trees-selected-bg-override: transparent;
          --trees-hover-bg: color-mix(in oklch, var(--background) 80%, transparent);
          --trees-row-height: 28px;
          --trees-font-size: 11px;
          --trees-font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          --trees-indent-size: 14px;
        }
      `}</style>
      <FileTree 
        model={model} 
        className={cn("cozea-pierre-tree")}
      />
    </div>
  );
});

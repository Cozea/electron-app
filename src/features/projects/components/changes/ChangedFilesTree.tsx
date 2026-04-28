import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { ActivityFeedItem } from "../../pages/ChangesPage";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { prepareFileTreeInput, type GitStatusEntry } from "@pierre/trees";

function toGitStatusEntry(file: ActivityFeedItem): GitStatusEntry {
  return {
    path: file.filePath,
    status:
      file.changeType === "create"
        ? "added"
        : file.changeType === "delete"
          ? "deleted"
          : file.changeType === "rename"
            ? "renamed"
            : "modified",
  };
}

function collectAncestorDirectoryPaths(filePaths: ReadonlyArray<string>): string[] {
  const directoryPaths = new Set<string>();

  for (const filePath of filePaths) {
    const parts = filePath.split("/").filter(Boolean);
    let currentPath = "";

    for (const part of parts.slice(0, -1)) {
      currentPath = `${currentPath}${part}/`;
      directoryPaths.add(currentPath);
    }
  }

  return [...directoryPaths];
}

const treeStyle = {
  height: "100%",
  "--trees-bg-override": "transparent",
  "--trees-bg-muted-override": "var(--sidebar-pill-hover-bg, color-mix(in oklch, var(--foreground) 10%, transparent))",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-selected-bg-override": "var(--sidebar-pill-hover-bg, color-mix(in oklch, var(--foreground) 10%, transparent))",
  "--trees-selected-fg-override": "var(--sidebar-pill-hover-fg, var(--foreground))",
  "--trees-selected-focused-border-color-override": "transparent",
} as CSSProperties;

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  files: ReadonlyArray<ActivityFeedItem>;
  allDirectoriesExpanded: boolean;
  onOpenFile: (filePath: string) => void;
  selectedFilePath?: string | null;
}) {
  const { files, allDirectoriesExpanded, onOpenFile, selectedFilePath } = props;

  const filePaths = useMemo(() => files.map((file) => file.filePath), [files]);
  const filePathSet = useMemo(() => new Set(filePaths), [filePaths]);
  const preparedInput = useMemo(() => {
    return prepareFileTreeInput(filePaths, {
      flattenEmptyDirectories: true,
    });
  }, [filePaths]);

  const gitStatus = useMemo(() => {
    return files.map(toGitStatusEntry);
  }, [files]);

  const initialExpandedPaths = useMemo(
    () => (allDirectoriesExpanded ? collectAncestorDirectoryPaths(filePaths) : []),
    [allDirectoriesExpanded, filePaths],
  );
  const filePathSetRef = useRef(filePathSet);
  const onOpenFileRef = useRef(onOpenFile);

  useEffect(() => {
    filePathSetRef.current = filePathSet;
  }, [filePathSet]);

  useEffect(() => {
    onOpenFileRef.current = onOpenFile;
  }, [onOpenFile]);

  const { model } = useFileTree({
    preparedInput,
    initialExpansion: allDirectoriesExpanded ? "open" : "closed",
    initialExpandedPaths,
    initialSelectedPaths: selectedFilePath ? [selectedFilePath] : undefined,
    gitStatus,
    icons: { set: "standard" },
    onSelectionChange: (selectedPaths) => {
      const selectedPath = selectedPaths[0];
      if (selectedPath && filePathSetRef.current.has(selectedPath)) {
        onOpenFileRef.current(selectedPath);
      }
    },
  });

  useEffect(() => {
    model.resetPaths(filePaths, { preparedInput, initialExpandedPaths });
  }, [filePaths, initialExpandedPaths, model, preparedInput]);

  useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  useEffect(() => {
    if (selectedFilePath && filePathSet.has(selectedFilePath)) {
      model.getItem(selectedFilePath)?.select();
    }
  }, [filePathSet, model, selectedFilePath]);

  return (
    <div className="h-full min-h-0 w-full">
      <FileTree 
        model={model} 
        className="h-full min-h-0 w-full"
        style={treeStyle}
      />
    </div>
  );
});

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
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

function getClickedTreeItemPath(event: MouseEvent): string | null {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement && target.dataset.type === "item") {
      return target.dataset.itemPath ?? null;
    }
  }

  return null;
}

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  files: ReadonlyArray<ActivityFeedItem>;
  allDirectoriesExpanded: boolean;
  onFileFilterChange: (filePath: string | null) => void;
  selectedFilePath?: string | null;
}) {
  const { files, allDirectoriesExpanded, onFileFilterChange, selectedFilePath } = props;

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
  const onFileFilterChangeRef = useRef(onFileFilterChange);
  const syncSelectionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    filePathSetRef.current = filePathSet;
  }, [filePathSet]);

  useEffect(() => {
    onFileFilterChangeRef.current = onFileFilterChange;
  }, [onFileFilterChange]);

  const { model } = useFileTree({
    preparedInput,
    initialExpansion: allDirectoriesExpanded ? "open" : "closed",
    initialExpandedPaths,
    initialSelectedPaths: selectedFilePath ? [selectedFilePath] : undefined,
    gitStatus,
    icons: { set: "standard" },
    onSelectionChange: (selectedPaths) => {
      let selectedPath: string | undefined;
      for (let index = selectedPaths.length - 1; index >= 0; index -= 1) {
        const path = selectedPaths[index];
        if (filePathSetRef.current.has(path)) {
          selectedPath = path;
          break;
        }
      }

      if (selectedPath) {
        onFileFilterChangeRef.current(selectedPath);
        return;
      }

      if (selectedPaths.length === 0) {
        onFileFilterChangeRef.current(null);
        return;
      }

      queueMicrotask(() => syncSelectionRef.current?.());
    },
  });

  const syncModelSelectionToFilter = useCallback(() => {
    const selectedPaths = model.getSelectedPaths();

    if (!selectedFilePath || !filePathSet.has(selectedFilePath)) {
      for (const selectedPath of selectedPaths) {
        model.getItem(selectedPath)?.deselect();
      }
      return;
    }

    for (const selectedPath of selectedPaths) {
      if (selectedPath !== selectedFilePath) {
        model.getItem(selectedPath)?.deselect();
      }
    }

    const selectedItem = model.getItem(selectedFilePath);
    if (selectedItem && !selectedItem.isSelected()) {
      selectedItem.select();
    }
  }, [filePathSet, model, selectedFilePath]);

  useEffect(() => {
    syncSelectionRef.current = syncModelSelectionToFilter;
  }, [syncModelSelectionToFilter]);

  const handleTreeClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;

      const clickedPath = getClickedTreeItemPath(event.nativeEvent);
      if (clickedPath && !filePathSetRef.current.has(clickedPath)) {
        queueMicrotask(syncModelSelectionToFilter);
        return;
      }

      if (
        clickedPath &&
        clickedPath === selectedFilePath &&
        filePathSetRef.current.has(clickedPath)
      ) {
        onFileFilterChangeRef.current(null);
      }
    },
    [selectedFilePath, syncModelSelectionToFilter],
  );

  useEffect(() => {
    model.resetPaths(filePaths, { preparedInput, initialExpandedPaths });
  }, [filePaths, initialExpandedPaths, model, preparedInput]);

  useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  useEffect(() => {
    syncModelSelectionToFilter();
  }, [syncModelSelectionToFilter]);

  return (
    <div className="h-full min-h-0 w-full">
      <FileTree 
        model={model} 
        className="h-full min-h-0 w-full"
        onClick={handleTreeClick}
        style={treeStyle}
      />
    </div>
  );
});

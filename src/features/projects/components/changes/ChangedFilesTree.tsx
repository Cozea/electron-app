import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { prepareFileTreeInput, type GitStatusEntry } from "@pierre/trees";

export interface ChangedFilesTreeFile {
  filePath: string;
  changeType: "create" | "modify" | "delete" | "rename";
}

function toGitStatusEntry(file: ChangedFilesTreeFile): GitStatusEntry {
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

interface ChangedFilesTreeInput {
  filePaths: string[];
  filePathSet: Set<string>;
  preparedInput: ReturnType<typeof prepareFileTreeInput>;
  gitStatus: GitStatusEntry[];
  initialExpandedPaths: string[];
}

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  files: ReadonlyArray<ChangedFilesTreeFile>;
  allDirectoriesExpanded: boolean;
  onFileFilterChange: (filePath: string | null) => void;
  selectedFilePath?: string | null;
}) {
  const { files, allDirectoriesExpanded, onFileFilterChange, selectedFilePath } = props;

  const treeInput = useMemo<ChangedFilesTreeInput>(() => {
    const filePaths = files.map((file) => file.filePath);
    return {
      filePaths,
      filePathSet: new Set(filePaths),
      preparedInput: prepareFileTreeInput(filePaths, {
        flattenEmptyDirectories: true,
      }),
      gitStatus: files.map(toGitStatusEntry),
      initialExpandedPaths: allDirectoriesExpanded ? collectAncestorDirectoryPaths(filePaths) : [],
    };
  }, [allDirectoriesExpanded, files]);
  const filePathSetRef = useRef(treeInput.filePathSet);
  const onFileFilterChangeRef = useRef(onFileFilterChange);
  const syncSelectionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    filePathSetRef.current = treeInput.filePathSet;
  }, [treeInput]);

  useEffect(() => {
    onFileFilterChangeRef.current = onFileFilterChange;
  }, [onFileFilterChange]);

  const { model } = useFileTree({
    preparedInput: treeInput.preparedInput,
    initialExpansion: allDirectoriesExpanded ? "open" : "closed",
    initialExpandedPaths: treeInput.initialExpandedPaths,
    initialSelectedPaths: selectedFilePath ? [selectedFilePath] : undefined,
    gitStatus: treeInput.gitStatus,
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

    if (!selectedFilePath || !treeInput.filePathSet.has(selectedFilePath)) {
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
  }, [model, selectedFilePath, treeInput]);

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
    model.resetPaths(treeInput.filePaths, {
      preparedInput: treeInput.preparedInput,
      initialExpandedPaths: treeInput.initialExpandedPaths,
    });
  }, [model, treeInput]);

  useEffect(() => {
    model.setGitStatus(treeInput.gitStatus);
  }, [model, treeInput]);

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

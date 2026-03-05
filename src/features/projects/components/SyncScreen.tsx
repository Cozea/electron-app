import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  Download,
  File,
  Folder,
  GitMerge,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react"
import type { SyncProgress, SyncPlan } from "@/lib/sync/types"
import { getSyncPlanSummary } from "@/lib/sync/types"
import { cn } from "@/lib/utils"

interface SyncScreenProps {
  progress: SyncProgress
  plan: SyncPlan | null
  onContinue: () => void
  onRetry: () => void
  onCancel?: () => void
  onSync?: (resolvedPlan: SyncPlan) => void
  syncActionLabel?: string
  syncActionIcon?: "download"
  hideContinue?: boolean
  variant?: "fullscreen" | "panel"
}

type ChangeItemType = "download" | "upload" | "delete" | "conflict" | "merged"

interface ChangeItem {
  path: string
  type: ChangeItemType
}

type FileTreeNode = FileTreeFolderNode | FileTreeFileNode

interface FileTreeFolderNode {
  kind: "folder"
  name: string
  path: string
  children: FileTreeNode[]
}

interface FileTreeFileNode {
  kind: "file"
  name: string
  path: string
  itemType: ChangeItemType
}

interface MutableFolderNode {
  name: string
  path: string
  folders: Map<string, MutableFolderNode>
  files: Map<string, FileTreeFileNode>
}

const CHANGE_ITEM_PRIORITY: Record<ChangeItemType, number> = {
  conflict: 0,
  upload: 1,
  download: 2,
  delete: 3,
  merged: 4,
}

function collectChangeItems(plan: SyncPlan | null): ChangeItem[] {
  if (!plan) return []

  const byPath = new Map<string, ChangeItemType>()

  const mergeEntry = (pathValue: string, type: ChangeItemType) => {
    const existing = byPath.get(pathValue)
    if (!existing || CHANGE_ITEM_PRIORITY[type] < CHANGE_ITEM_PRIORITY[existing]) {
      byPath.set(pathValue, type)
    }
  }

  for (const entry of plan.downloads) mergeEntry(entry.path, "download")
  for (const entry of plan.uploads) mergeEntry(entry.path, "upload")
  for (const entry of plan.localDeletes) mergeEntry(entry.path, "delete")
  for (const entry of plan.cloudDeletes) mergeEntry(entry.path, "delete")
  for (const entry of plan.autoMerged) mergeEntry(entry.path, "merged")
  for (const entry of plan.conflicts) mergeEntry(entry.path, "conflict")

  return Array.from(byPath.entries())
    .map(([pathValue, type]) => ({ path: pathValue, type }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function folderPathForFilePath(pathValue: string): string[] {
  const segments = pathValue.split("/").filter(Boolean)
  if (segments.length <= 1) {
    return []
  }

  const folders = segments.slice(0, -1)
  const paths: string[] = []
  let current = ""
  for (const segment of folders) {
    current = current ? `${current}/${segment}` : segment
    paths.push(current)
  }
  return paths
}

function buildFileTree(changeItems: ChangeItem[]): FileTreeNode[] {
  const root: MutableFolderNode = {
    name: "",
    path: "",
    folders: new Map(),
    files: new Map(),
  }

  for (const item of changeItems) {
    const segments = item.path.split("/").filter(Boolean)
    if (segments.length === 0) continue

    const fileName = segments[segments.length - 1]
    const folderSegments = segments.slice(0, -1)
    let currentFolder = root
    let currentPath = ""

    for (const segment of folderSegments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      let nextFolder = currentFolder.folders.get(segment)
      if (!nextFolder) {
        nextFolder = {
          name: segment,
          path: currentPath,
          folders: new Map(),
          files: new Map(),
        }
        currentFolder.folders.set(segment, nextFolder)
      }
      currentFolder = nextFolder
    }

    currentFolder.files.set(fileName, {
      kind: "file",
      name: fileName,
      path: item.path,
      itemType: item.type,
    })
  }

  const toNodes = (folder: MutableFolderNode): FileTreeNode[] => {
    const folderNodes: FileTreeFolderNode[] = Array.from(folder.folders.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        kind: "folder",
        name: entry.name,
        path: entry.path,
        children: toNodes(entry),
      }))

    const fileNodes: FileTreeFileNode[] = Array.from(folder.files.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({ ...entry }))

    return [...folderNodes, ...fileNodes]
  }

  return toNodes(root)
}

function getChangeItemPresentation(type: ChangeItemType) {
  switch (type) {
    case "conflict":
      return { Icon: AlertTriangle, iconClassName: "text-amber-500", badgeLabel: "Conflict" }
    case "upload":
      return { Icon: Upload, iconClassName: "text-green-500", badgeLabel: "Upload" }
    case "download":
      return { Icon: Download, iconClassName: "text-blue-500", badgeLabel: "Download" }
    case "delete":
      return { Icon: Trash2, iconClassName: "text-orange-500", badgeLabel: "Delete" }
    case "merged":
      return { Icon: GitMerge, iconClassName: "text-violet-500", badgeLabel: "Merged" }
    default:
      return { Icon: File, iconClassName: "text-muted-foreground", badgeLabel: "File" }
  }
}

function getConflictOptions(conflict: SyncPlan["conflicts"][number] | null): Array<{
  value: string
  label: string
}> {
  if (!conflict) return []

  if (conflict.localEntry && conflict.cloudEntry) {
    return [
      { value: "upload", label: "Keep local and upload to cloud" },
      { value: "download", label: "Keep cloud and download locally" },
    ]
  }

  if (conflict.localEntry && !conflict.cloudEntry) {
    return [
      { value: "upload", label: "Restore local file to cloud" },
      { value: "delete-local", label: "Accept cloud deletion" },
    ]
  }

  if (!conflict.localEntry && conflict.cloudEntry) {
    return [
      { value: "download", label: "Restore cloud file locally" },
      { value: "delete-cloud", label: "Keep local deletion and delete in cloud" },
    ]
  }

  return []
}

function getConflictDecisionForPreference(
  conflict: SyncPlan["conflicts"][number],
  preference: "local" | "cloud"
): string | null {
  if (conflict.localEntry && conflict.cloudEntry) {
    return preference === "local" ? "upload" : "download"
  }

  if (conflict.localEntry && !conflict.cloudEntry) {
    return preference === "local" ? "upload" : "delete-local"
  }

  if (!conflict.localEntry && conflict.cloudEntry) {
    return preference === "local" ? "delete-cloud" : "download"
  }

  return null
}

function buildResolvedPlanFromConflictResolutions(
  plan: SyncPlan,
  conflicts: SyncPlan["conflicts"],
  resolutions: Record<string, string>
): SyncPlan {
  const next: SyncPlan = {
    downloads: [...plan.downloads],
    uploads: [...plan.uploads],
    localDeletes: [...plan.localDeletes],
    cloudDeletes: [...plan.cloudDeletes],
    conflicts: [],
    autoMerged: [...(plan.autoMerged ?? [])],
    noChange: plan.noChange,
  }

  for (const conflict of conflicts) {
    const decision = resolutions[conflict.path]
    if (!decision) continue

    if (decision === "download") {
      if (!conflict.cloudEntry) continue
      next.downloads.push({ ...conflict, type: "download" })
    } else if (decision === "upload") {
      if (!conflict.localEntry) continue
      next.uploads.push({ ...conflict, type: "upload" })
    } else if (decision === "delete-local") {
      next.localDeletes.push({ ...conflict, type: "delete-local" })
    } else if (decision === "delete-cloud") {
      next.cloudDeletes.push({ ...conflict, type: "delete-cloud" })
    }
  }

  return next
}

export function SyncScreen({
  progress,
  plan,
  onContinue,
  onRetry,
  onCancel,
  onSync,
  syncActionLabel,
  syncActionIcon,
  hideContinue = false,
  variant = "fullscreen",
}: SyncScreenProps) {
  const { status, message, current, total } = progress
  const summary = plan ? getSyncPlanSummary(plan) : null
  const conflicts = useMemo(() => plan?.conflicts ?? [], [plan])
  const changeItems = useMemo(() => collectChangeItems(plan), [plan])
  const fileTree = useMemo(() => buildFileTree(changeItems), [changeItems])
  const isPanel = variant === "panel"

  const [conflictResolutions, setConflictResolutions] = useState<Record<string, string>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [indeterminateProgress, setIndeterminateProgress] = useState(18)

  useEffect(() => {
    setConflictResolutions({})
  }, [plan])

  useEffect(() => {
    if (status !== "syncing" || total > 0) {
      setIndeterminateProgress(18)
      return
    }

    const timer = window.setInterval(() => {
      setIndeterminateProgress((previous) => (previous >= 88 ? 18 : previous + 14))
    }, 280)

    return () => window.clearInterval(timer)
  }, [status, total])

  useEffect(() => {
    if (changeItems.length === 0) {
      if (selectedPath !== null) setSelectedPath(null)
      return
    }

    if (!selectedPath || !changeItems.some((item) => item.path === selectedPath)) {
      setSelectedPath(conflicts[0]?.path ?? changeItems[0].path)
    }
  }, [changeItems, conflicts, selectedPath])

  useEffect(() => {
    if (fileTree.length === 0) {
      setExpandedFolders({})
      return
    }

    setExpandedFolders((prev) => {
      const next = { ...prev }

      const markRootExpanded = (nodes: FileTreeNode[]) => {
        for (const node of nodes) {
          if (node.kind === "folder") {
            next[node.path] = true
          }
        }
      }

      markRootExpanded(fileTree)
      return next
    })
  }, [fileTree])

  useEffect(() => {
    if (!selectedPath) return

    const parentPaths = folderPathForFilePath(selectedPath)
    if (parentPaths.length === 0) return

    setExpandedFolders((prev) => {
      let changed = false
      const next = { ...prev }
      for (const folderPath of parentPaths) {
        if (!next[folderPath]) {
          next[folderPath] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [selectedPath])

  const activeConflict = useMemo(() => {
    if (conflicts.length === 0) return null
    return conflicts.find((entry) => entry.path === selectedPath) ?? conflicts[0]
  }, [conflicts, selectedPath])

  const activeConflictOptions = useMemo(
    () => getConflictOptions(activeConflict),
    [activeConflict]
  )

  const allConflictsResolved = useMemo(() => {
    if (!plan) return false
    if (conflicts.length === 0) return true
    return conflicts.every((entry) => Boolean(conflictResolutions[entry.path]))
  }, [plan, conflicts, conflictResolutions])

  const resolvedConflictCount = useMemo(() => {
    return conflicts.filter((entry) => Boolean(conflictResolutions[entry.path])).length
  }, [conflicts, conflictResolutions])

  const resolvedPlan = useMemo(() => {
    if (!plan) return null
    if (conflicts.length === 0) return plan
    return buildResolvedPlanFromConflictResolutions(plan, conflicts, conflictResolutions)
  }, [plan, conflicts, conflictResolutions])

  const getStatusIcon = () => {
    switch (status) {
      case "idle":
      case "checking":
      case "planning":
        return <Loader2 className="h-8 w-8 animate-spin text-primary" />
      case "syncing":
        return <Cloud className="h-8 w-8 text-primary animate-pulse" />
      case "complete":
        return <Check className="h-8 w-8 text-green-500" />
      case "error":
        return <CloudOff className="h-8 w-8 text-destructive" />
    }
  }

  const getStatusTitle = () => {
    switch (status) {
      case "idle":
        return "Preparing Sync"
      case "checking":
        return "Checking Files"
      case "planning":
        return "Planning Sync"
      case "syncing":
        return "Syncing Files"
      case "complete":
        return "Sync Complete"
      case "error":
        return "Sync Failed"
    }
  }

  const canRetry = status === "error"
  const canSync = status === "planning" && Boolean(summary && summary.totalChanges > 0 && onSync)
  const canCancel =
    hideContinue &&
    Boolean(onCancel) &&
    (status === "complete" || status === "error" || status === "planning")
  const canContinue =
    !hideContinue &&
    (status === "complete" || status === "error" || status === "planning")
  const canConflictQuickActions =
    status === "planning" && conflicts.length > 0 && Boolean(plan && onSync)
  const showConflictActionSet = canConflictQuickActions && !hideContinue
  const showSkipHint =
    !showConflictActionSet &&
    !hideContinue &&
    status === "planning" &&
    Boolean(summary && summary.totalChanges > 0)
  const showFooter = canRetry || canSync || canCancel || canContinue || showSkipHint

  const showSidebar = !isPanel && status !== "syncing" && changeItems.length > 0
  const isLocalRestoreMode =
    hideContinue &&
    Boolean(
      summary &&
      summary.downloads > 0 &&
      summary.uploads === 0 &&
      summary.deletes === 0 &&
      summary.conflicts === 0
    )

  const mainTitle = isLocalRestoreMode
    ? "No local files found"
    : conflicts.length > 0 && status === "planning"
      ? "Resolve file conflicts"
      : getStatusTitle()

  const mainDescription = isLocalRestoreMode
    ? "Download cloud files to restore this project on your machine."
    : conflicts.length > 0 && status === "planning"
      ? "Choose whether local or cloud content should win for each conflicting file."
      : message

  const applyConflictPreset = (
    preference: "local" | "cloud",
    mode: "fill" | "replace" = "fill"
  ) => {
    if (!plan || !onSync || conflicts.length === 0) return

    const nextResolutions: Record<string, string> = mode === "replace" ? {} : { ...conflictResolutions }
    for (const conflict of conflicts) {
      if (mode === "fill" && nextResolutions[conflict.path]) continue
      const decision = getConflictDecisionForPreference(conflict, preference)
      if (decision) {
        nextResolutions[conflict.path] = decision
      }
    }

    setConflictResolutions(nextResolutions)
    const nextPlan = buildResolvedPlanFromConflictResolutions(plan, conflicts, nextResolutions)
    onSync(nextPlan)
  }

  const handleUpdateCloudAction = () => {
    if (!onSync || !plan) return

    if (conflicts.length === 0) {
      if (resolvedPlan) onSync(resolvedPlan)
      return
    }

    if (allConflictsResolved && resolvedPlan) {
      onSync(resolvedPlan)
      return
    }

    applyConflictPreset("local", "replace")
  }

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }))
  }

  const renderFileTreeNodes = (nodes: FileTreeNode[], depth: number) => {
    return (
      <>
        {nodes.map((node) => {
          if (node.kind === "folder") {
            const isExpanded = expandedFolders[node.path] ?? false
            return (
              <div key={`folder:${node.path}`} className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => toggleFolder(node.path)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
                  style={{ paddingLeft: `${8 + depth * 14}px` }}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{node.name}</span>
                </button>
                {isExpanded && node.children.length > 0 && (
                  <div className="space-y-0.5">
                    {renderFileTreeNodes(node.children, depth + 1)}
                  </div>
                )}
              </div>
            )
          }

          const { Icon, iconClassName, badgeLabel } = getChangeItemPresentation(node.itemType)
          const isSelected = selectedPath === node.path
          return (
            <button
              key={`file:${node.path}`}
              type="button"
              onClick={() => setSelectedPath(node.path)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                isSelected
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
              )}
              style={{ paddingLeft: `${22 + depth * 14}px` }}
            >
              <Icon className={cn("h-4 w-4 shrink-0", iconClassName)} />
              <span className="min-w-0 flex-1 truncate text-sm">{node.name}</span>
              <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                {badgeLabel}
              </span>
            </button>
          )
        })}
      </>
    )
  }

  return (
    <div
      className={cn(
        isPanel
          ? "w-full max-h-[min(76vh,720px)] overflow-hidden rounded-2xl bg-secondary p-4 dark:bg-secondary sm:p-5"
          : "flex min-h-screen flex-col items-center justify-center bg-background p-6 md:p-8"
      )}
    >
      <div className={cn("w-full", isPanel ? "space-y-5" : "max-w-6xl space-y-5")}>
        {!isPanel && (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1 text-left">
              <h1 className="text-3xl font-semibold tracking-tight">{getStatusTitle()}</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
            </div>
            {summary && status !== "syncing" && summary.totalChanges > 0 && (
              <div className="flex w-fit min-h-10 items-center rounded-full bg-secondary/80 p-1 dark:bg-secondary/40">
                <div className="inline-flex items-center gap-0.5 px-1 text-[11px] font-medium leading-none text-blue-500">
                  <ArrowDown className="h-3 w-3" />
                  <span className="tabular-nums">{summary.downloads}</span>
                </div>
                <span className="px-0.5 text-[10px] leading-none text-muted-foreground/50">•</span>
                <div className="inline-flex items-center gap-0.5 px-1 text-[11px] font-medium leading-none text-green-500">
                  <ArrowUp className="h-3 w-3" />
                  <span className="tabular-nums">{summary.uploads}</span>
                </div>
                <span className="px-0.5 text-[10px] leading-none text-muted-foreground/50">•</span>
                <div className="inline-flex items-center gap-0.5 px-1 text-[11px] font-medium leading-none text-orange-500">
                  <span className="text-sm leading-none">-</span>
                  <span className="tabular-nums">{summary.deletes}</span>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-5">
            {isPanel && (
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-background">
                    {getStatusIcon()}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h2 className="text-xl font-semibold leading-tight">{getStatusTitle()}</h2>
                    <p className="text-sm text-muted-foreground">{message}</p>
                  </div>
                </div>

                {summary && status !== "syncing" && summary.totalChanges > 0 && (
                  <div className="flex w-fit min-h-10 shrink-0 items-center rounded-full bg-secondary p-1">
                    <div className="inline-flex items-center gap-0.5 px-1 text-[11px] font-medium leading-none text-blue-500">
                      <ArrowDown className="h-3 w-3" />
                      <span className="tabular-nums">{summary.downloads}</span>
                    </div>
                    <span className="px-0.5 text-[10px] leading-none text-muted-foreground/50">•</span>
                    <div className="inline-flex items-center gap-0.5 px-1 text-[11px] font-medium leading-none text-green-500">
                      <ArrowUp className="h-3 w-3" />
                      <span className="tabular-nums">{summary.uploads}</span>
                    </div>
                    <span className="px-0.5 text-[10px] leading-none text-muted-foreground/50">•</span>
                    <div className="inline-flex items-center gap-0.5 px-1 text-[11px] font-medium leading-none text-orange-500">
                      <span className="text-sm leading-none">-</span>
                      <span className="tabular-nums">{summary.deletes}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(status === "syncing" || status === "complete") && total > 0 && (
              <div className="space-y-2">
                <Progress value={(current / total) * 100} className="h-2" />
                <p className="text-xs text-center text-muted-foreground">
                  {current} / {total} files
                </p>
              </div>
            )}

            {status === "syncing" && total === 0 && (
              <div className="space-y-2">
                <Progress value={indeterminateProgress} className="h-2" />
                <p className="text-xs text-center text-muted-foreground">
                  {isLocalRestoreMode ? "Restoring files from cloud..." : "Applying sync changes..."}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {summary && summary.conflicts > 0 && (
                <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-300">
                  {summary.conflicts} conflict{summary.conflicts > 1 ? "s" : ""} require review
                </span>
              )}
              {summary && summary.autoMerged > 0 && (
                <span className="rounded-full bg-violet-500/10 px-3 py-1 text-xs text-violet-700 dark:text-violet-300">
                  {summary.autoMerged} auto-merged file{summary.autoMerged > 1 ? "s" : ""}
                </span>
              )}
              {isLocalRestoreMode && (
                <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs text-blue-700 dark:text-blue-300">
                  Local workspace is empty
                </span>
              )}
            </div>

            <div
              className={cn(
                showSidebar
                  ? "grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]"
                  : "grid grid-cols-1"
              )}
            >
              {showSidebar && (
                <aside className="rounded-xl p-3">
                  <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Changed Files
                  </p>
                  <ScrollArea className="mt-2 h-[300px] rounded-lg p-1.5">
                    <div className="space-y-0.5">
                      {renderFileTreeNodes(fileTree, 0)}
                    </div>
                  </ScrollArea>
                </aside>
              )}

              <section
                className={cn(
                  "rounded-xl p-4 md:p-5",
                  isPanel ? "bg-background" : "bg-background/40"
                )}
              >
                {status === "planning" && conflicts.length > 0 && activeConflict ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Conflict File
                        </p>
                        <p className="break-all text-base font-medium">{activeConflict.path}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {resolvedConflictCount} / {conflicts.length} resolved
                      </p>
                    </div>

                    <p className="text-sm text-muted-foreground">{activeConflict.reason}</p>

                    <RadioGroup
                      value={conflictResolutions[activeConflict.path] ?? ""}
                      onValueChange={(value) =>
                        setConflictResolutions((prev) => ({
                          ...prev,
                          [activeConflict.path]: value,
                        }))
                      }
                      className="grid gap-2 md:grid-cols-2"
                    >
                      {activeConflictOptions.map((option) => {
                        const id = `conflict:${activeConflict.path}:${option.value}`
                        const isSelected = conflictResolutions[activeConflict.path] === option.value
                        return (
                          <label
                            key={option.value}
                            htmlFor={id}
                            className={cn(
                              "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                              isSelected
                                ? "bg-background text-foreground"
                                : "bg-secondary/65 text-muted-foreground hover:bg-background/70 hover:text-foreground dark:bg-secondary/30"
                            )}
                          >
                            <RadioGroupItem id={id} value={option.value} />
                            <span>{option.label}</span>
                          </label>
                        )
                      })}
                    </RadioGroup>

                    {conflicts.length > 1 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Files Needing Resolution
                        </p>
                        <ScrollArea className="h-28 rounded-lg bg-secondary/55 p-1.5 dark:bg-secondary/25">
                          <div className="space-y-1">
                            {conflicts.map((entry) => {
                              const isResolved = Boolean(conflictResolutions[entry.path])
                              const isSelected = selectedPath === entry.path
                              return (
                                <button
                                  key={`conflict-file:${entry.path}`}
                                  type="button"
                                  onClick={() => setSelectedPath(entry.path)}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                                    isSelected
                                      ? "bg-background text-foreground"
                                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                                  )}
                                >
                                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                                  <span className="min-w-0 flex-1 truncate">{entry.path}</span>
                                  {isResolved && (
                                    <span className="rounded-md bg-green-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-green-600 dark:text-green-300">
                                      Done
                                    </span>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/70 dark:bg-secondary/35">
                      {isLocalRestoreMode ? (
                        <Download className="h-6 w-6 text-blue-500" />
                      ) : (
                        getStatusIcon()
                      )}
                    </div>
                    <h3 className="text-2xl font-semibold tracking-tight">{mainTitle}</h3>
                    <p className="max-w-xl text-sm text-muted-foreground">{mainDescription}</p>
                  </div>
                )}
              </section>
            </div>

          {showFooter && (
            <div className="space-y-2">
              <div className={cn("flex flex-wrap gap-2", isPanel ? "justify-center" : "justify-end")}>
                {canRetry && (
                  <Button variant="secondary" onClick={onRetry}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                )}
                {canSync && !showConflictActionSet && (
                  <Button
                    onClick={() => resolvedPlan && onSync?.(resolvedPlan)}
                    disabled={!resolvedPlan || !allConflictsResolved}
                  >
                    {syncActionIcon === "download" && <Download className="mr-2 h-4 w-4" />}
                    {syncActionLabel ?? (conflicts.length > 0 ? "Update cloud" : "Sync changes")}
                  </Button>
                )}
                {showConflictActionSet && (
                  <Button onClick={handleUpdateCloudAction}>
                    Update cloud
                  </Button>
                )}
                {showConflictActionSet && (
                  <Button
                    variant="secondary"
                    onClick={() => applyConflictPreset("cloud", "replace")}
                  >
                    Accept cloud
                  </Button>
                )}
                {canCancel && (
                  <Button variant="secondary" onClick={onCancel}>
                    Cancel
                  </Button>
                )}
                {canContinue && (
                  <Button
                    variant={
                      showConflictActionSet ||
                      (status === "planning" && summary && summary.totalChanges > 0)
                        ? "secondary"
                        : "default"
                    }
                    onClick={onContinue}
                  >
                    {showConflictActionSet
                      ? "Work offline"
                      : status === "planning" && summary && summary.totalChanges > 0
                      ? "Work offline"
                      : "Continue"}
                    {!showConflictActionSet && <ArrowRight className="ml-2 h-4 w-4" />}
                  </Button>
                )}
              </div>

              {showSkipHint && (
                <p className={cn("text-xs text-muted-foreground", isPanel ? "text-center" : "text-right")}>
                  Click continue to skip sync and work offline
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

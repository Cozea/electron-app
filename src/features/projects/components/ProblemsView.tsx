import { useMemo, useState, useCallback } from "react"
import {
    AlertTriangle,
    Info,
    List,
    ListTree,
    RefreshCw,
    ChevronDown,
    ChevronRight,
    Trash2,
    X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useProblemsStore, selectProjectProblems, type ProblemItem } from "@/stores/useProblemsStore"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

interface ProblemsViewProps {
    projectPath?: string | null
    onOpenFile?: (filePath: string, line?: number, column?: number) => void
    searchQuery?: string
}

type ViewMode = "tree" | "table"

const severityOrder: Record<ProblemItem["severity"], number> = {
    error: 0,
    warning: 1,
    info: 2,
}

const normalizePath = (value: string) => value.replace(/^file:\/\//i, "").replace(/\\/g, "/")

const toRelativePath = (filePath: string, projectPath?: string | null) => {
    if (!projectPath) return filePath
    const normalizedProject = normalizePath(projectPath).replace(/\/$/, "")
    const normalizedFile = normalizePath(filePath)
    if (normalizedFile.startsWith(normalizedProject)) {
        const relative = normalizedFile.slice(normalizedProject.length).replace(/^\/+/, "")
        return relative || normalizedFile
    }
    return normalizedFile
}

const getSeverityIcon = (severity: ProblemItem["severity"]) => {
    if (severity === "info") return Info
    return AlertTriangle
}

const formatLocation = (error: ProblemItem) => {
    if (!error.file) return null
    const line = error.line ? `${error.line}` : null
    const col = error.column ? `${error.column}` : null
    if (!line && !col) return null
    return `${line ?? ""}${col ? `:${col}` : ""}`
}

export function ProblemsView({ projectPath, onOpenFile, searchQuery = "" }: ProblemsViewProps) {
    const errors = useProblemsStore(selectProjectProblems(projectPath))
    const clearErrors = useProblemsStore((state) => state.actions.clearProblems)
    const dismissError = useProblemsStore((state) => state.actions.dismissProblem)

    const [viewMode, setViewMode] = useState<ViewMode>("tree")
    const [showErrors, setShowErrors] = useState(true)
    const [showWarnings, setShowWarnings] = useState(true)
    const [showInfos, setShowInfos] = useState(true)
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())

    const activeErrors = useMemo(() => errors.filter((error) => !error.dismissed), [errors])

    const severityCounts = useMemo(() => {
        return activeErrors.reduce(
            (acc, error) => {
                acc[error.severity] += 1
                return acc
            },
            { error: 0, warning: 0, info: 0 }
        )
    }, [activeErrors])

    const filteredErrors = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase()
        return activeErrors.filter((error) => {
            if (error.severity === "error" && !showErrors) return false
            if (error.severity === "warning" && !showWarnings) return false
            if (error.severity === "info" && !showInfos) return false
            if (!normalizedQuery) return true
            const file = error.file ? normalizePath(error.file).toLowerCase() : ""
            const message = error.message.toLowerCase()
            const source = error.source.toLowerCase()
            return (
                message.includes(normalizedQuery) ||
                file.includes(normalizedQuery) ||
                source.includes(normalizedQuery)
            )
        })
    }, [activeErrors, searchQuery, showErrors, showWarnings, showInfos])

    const groupedErrors = useMemo(() => {
        const map = new Map<string, { id: string; label: string; file?: string; items: ProblemItem[] }>()
        for (const error of filteredErrors) {
            const fileKey = error.file ? normalizePath(error.file) : "__no_file__"
            const label = error.file ? toRelativePath(error.file, projectPath) : "Unknown file"
            if (!map.has(fileKey)) {
                map.set(fileKey, { id: fileKey, label, file: error.file, items: [] })
            }
            map.get(fileKey)!.items.push(error)
        }

        const groups = Array.from(map.values())
        for (const group of groups) {
            group.items.sort((a, b) => {
                const severityDiff = severityOrder[a.severity] - severityOrder[b.severity]
                if (severityDiff !== 0) return severityDiff
                const lineDiff = (a.line ?? 0) - (b.line ?? 0)
                if (lineDiff !== 0) return lineDiff
                return a.message.localeCompare(b.message)
            })
        }

        groups.sort((a, b) => {
            const aSeverity = a.items[0]?.severity ?? "info"
            const bSeverity = b.items[0]?.severity ?? "info"
            const severityDiff = severityOrder[aSeverity] - severityOrder[bSeverity]
            if (severityDiff !== 0) return severityDiff
            return a.label.localeCompare(b.label)
        })

        return groups
    }, [filteredErrors, projectPath])

    const sortedErrors = useMemo(() => {
        return [...filteredErrors].sort((a, b) => {
            const severityDiff = severityOrder[a.severity] - severityOrder[b.severity]
            if (severityDiff !== 0) return severityDiff
            const fileA = a.file ? normalizePath(a.file) : ""
            const fileB = b.file ? normalizePath(b.file) : ""
            if (fileA !== fileB) return fileA.localeCompare(fileB)
            const lineDiff = (a.line ?? 0) - (b.line ?? 0)
            if (lineDiff !== 0) return lineDiff
            return a.message.localeCompare(b.message)
        })
    }, [filteredErrors])

    const toggleGroup = useCallback((groupId: string) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev)
            if (next.has(groupId)) {
                next.delete(groupId)
            } else {
                next.add(groupId)
            }
            return next
        })
    }, [])

    const handleOpenFile = useCallback((error: ProblemItem) => {
        if (!error.file || !onOpenFile) return
        const normalizedFile = normalizePath(error.file)
        onOpenFile(normalizedFile, error.line, error.column)
    }, [onOpenFile])

    const handleDismiss = useCallback((errorId: string) => {
        if (!projectPath) return
        dismissError(projectPath, errorId)
    }, [dismissError, projectPath])

    const handleRefresh = useCallback(() => {
        if (!projectPath || !window.electronAPI?.diagnostics) return
        void window.electronAPI.diagnostics.refresh({ projectPath })
    }, [projectPath])

    return (
        <div className="h-full flex flex-col bg-sidebar">
            <div className="flex items-center gap-2 px-2 py-1">
                <div className="flex-1" /> {/* Spacer for where search bar used to be */}

                <div className="flex items-center gap-1 shrink-0">
                    <Button
                        variant={showErrors ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setShowErrors((prev) => !prev)}
                    >
                        <AlertTriangle className="h-3 w-3 mr-1 text-destructive" />
                        {severityCounts.error}
                    </Button>
                    <Button
                        variant={showWarnings ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setShowWarnings((prev) => !prev)}
                    >
                        <AlertTriangle className="h-3 w-3 mr-1 text-yellow-500" />
                        {severityCounts.warning}
                    </Button>
                    <Button
                        variant={showInfos ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setShowInfos((prev) => !prev)}
                    >
                        <Info className="h-3 w-3 mr-1 text-blue-400" />
                        {severityCounts.info}
                    </Button>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={handleRefresh}
                        title="Refresh diagnostics"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant={viewMode === "tree" ? "secondary" : "ghost"}
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setViewMode("tree")}
                    >
                        <ListTree className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant={viewMode === "table" ? "secondary" : "ghost"}
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setViewMode("table")}
                    >
                        <List className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => projectPath && clearErrors(projectPath)}
                        title="Clear problems"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            <ScrollArea className="flex-1">
                {filteredErrors.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                        No problems detected
                    </div>
                ) : viewMode === "tree" ? (
                    <div className="p-2 space-y-2">
                        {groupedErrors.map((group) => {
                            const isCollapsed = collapsedGroups.has(group.id)
                            const fileLabel = group.label
                            const fileName = fileLabel.split("/").pop() || fileLabel
                            const groupCount = group.items.length
                            return (
                                <div key={group.id} className="rounded border border-border/60 bg-background/40">
                                    <button
                                        type="button"
                                        onClick={() => toggleGroup(group.id)}
                                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs font-medium text-foreground/80 hover:bg-muted/40 transition-colors"
                                    >
                                        {isCollapsed ? (
                                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                        ) : (
                                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                        )}
                                        <span className="truncate">{fileName}</span>
                                        <span className="text-muted-foreground truncate">({fileLabel})</span>
                                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                            {groupCount}
                                        </span>
                                    </button>
                                    {!isCollapsed && (
                                        <div className="border-t border-border/60 divide-y divide-border/60">
                                            {group.items.map((error) => (
                                                <ProblemRow
                                                    key={error.id}
                                                    error={error}
                                                    onOpenFile={handleOpenFile}
                                                    onDismiss={handleDismiss}
                                                    projectPath={projectPath}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    <div className="p-2 space-y-1">
                        {sortedErrors.map((error) => (
                            <ProblemRow
                                key={error.id}
                                error={error}
                                onOpenFile={handleOpenFile}
                                onDismiss={handleDismiss}
                                projectPath={projectPath}
                            />
                        ))}
                    </div>
                )}
            </ScrollArea>
        </div>
    )
}

interface ProblemRowProps {
    error: ProblemItem
    onOpenFile: (error: ProblemItem) => void
    onDismiss: (id: string) => void
    projectPath?: string | null
}

function ProblemRow({ error, onOpenFile, onDismiss, projectPath }: ProblemRowProps) {
    const Icon = getSeverityIcon(error.severity)
    const location = formatLocation(error)
    const fileLabel = error.file ? toRelativePath(error.file, projectPath) : null
    const clickable = Boolean(error.file)

    return (
        <div
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : -1}
            onClick={() => clickable && onOpenFile(error)}
            onKeyDown={(event) => {
                if (!clickable) return
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onOpenFile(error)
                }
            }}
            className={cn(
                "group flex items-start gap-2 px-2 py-1.5 text-xs",
                clickable ? "cursor-pointer hover:bg-muted/50" : "cursor-default"
            )}
        >
            <Icon
                className={cn(
                    "h-3.5 w-3.5 mt-0.5",
                    error.severity === "error" && "text-destructive",
                    error.severity === "warning" && "text-yellow-500",
                    error.severity === "info" && "text-blue-400"
                )}
            />
            <div className="flex-1 min-w-0">
                <div className="text-foreground/90 truncate">{error.message}</div>
                <div className="flex items-center gap-2 text-muted-foreground mt-0.5">
                    {fileLabel && <span className="truncate">{fileLabel}</span>}
                    {location && <span className="shrink-0">{location}</span>}
                    <span className="shrink-0 uppercase text-[10px]">{error.source}</span>
                </div>
            </div>
            <button
                type="button"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                onClick={(event) => {
                    event.stopPropagation()
                    onDismiss(error.id)
                }}
                title="Dismiss"
            >
                <X className="h-3 w-3" />
            </button>
        </div>
    )
}

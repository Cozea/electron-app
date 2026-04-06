 
import { useMemo, useState, useCallback, createElement, memo } from "react"
import {
    AlertTriangle,
    Info,
    ChevronDown,
    ChevronRight,
    Sparkles,
    X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useProblemsStore, selectProjectProblems, type ProblemItem } from "@/stores/useProblemsStore"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Virtuoso } from "react-virtuoso"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"


interface ProblemsViewProps {
    projectPath?: string | null
    onOpenFile?: (filePath: string, line?: number, column?: number) => void
    searchQuery?: string
    viewMode: ViewMode
    showErrors: boolean
    showWarnings: boolean
    showInfos: boolean
}

export type ViewMode = "tree" | "table"

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

export function ProblemsView({
    projectPath,
    onOpenFile,
    searchQuery = "",
    viewMode,
    showErrors,
    showWarnings,
    showInfos,
}: ProblemsViewProps) {
    const errors = useProblemsStore(selectProjectProblems(projectPath))
    const dismissError = useProblemsStore((state) => state.actions.dismissProblem)
    

    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())

    const activeErrors = useMemo(() => errors.filter((error) => !error.dismissed), [errors])

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

    const handleAskAI = useCallback((error: ProblemItem) => {
        const location = error.file
            ? `${toRelativePath(error.file, projectPath)}${error.line ? `:${error.line}` : ""}${error.column ? `:${error.column}` : ""}`
            : "unknown"

        const prompt = [
            "Help me diagnose and fix this problem.",
            `Severity: ${error.severity}`,
            `Source: ${error.source}`,
            `Location: ${location}`,
            `Message: ${error.message}`,
            "",
            "Please provide:",
            "1. likely root cause",
            "2. exact fix steps",
            "3. a code patch suggestion",
        ].join("\n")

        console.log(prompt)
    }, [console.log, projectPath])

    return (
        <div className="h-full min-w-0 flex flex-col bg-content-surface">
            {filteredErrors.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
                    No problems detected
                </div>
            ) : viewMode === "tree" ? (
                <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block [&>[data-slot=scroll-area-viewport]>div]:!w-full [&>[data-slot=scroll-area-viewport]>div]:!min-w-0">
                    <div className="w-full min-w-0 overflow-hidden p-2 space-y-2">
                        {groupedErrors.map((group) => {
                            const isCollapsed = collapsedGroups.has(group.id)
                            const fileLabel = group.label
                            const fileName = fileLabel.split("/").pop() || fileLabel
                            const groupCount = group.items.length
                            return (
                                <div key={group.id} className="overflow-hidden rounded-xl bg-background/25">
                                    <button
                                        type="button"
                                        onClick={() => toggleGroup(group.id)}
                                        className="group w-full min-w-0 flex items-center gap-2 px-2 py-1.5 text-left text-xs font-medium text-foreground/80 hover:bg-muted/40 transition-colors"
                                    >
                                        {isCollapsed ? (
                                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
                                        ) : (
                                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
                                        )}
                                        <div className="min-w-0 flex-1 flex items-center gap-1 overflow-hidden">
                                            <span className="truncate">{fileName}</span>
                                            <span className="text-muted-foreground truncate">({fileLabel})</span>
                                        </div>
                                        <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                            {groupCount}
                                        </span>
                                    </button>
                                    {!isCollapsed && (
                                        <div className="space-y-0.5 p-1">
                                            {group.items.map((error) => (
                                                <ProblemRow
                                                    key={error.id}
                                                    error={error}
                                                    onOpenFile={handleOpenFile}
                                                    onAskAI={handleAskAI}
                                                    onDismiss={handleDismiss}
                                                    projectPath={projectPath}
                                                    showFileLabel={false}
                                                    showLocation={false}
                                                    showSource={false}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </ScrollArea>
            ) : (
                <div className="min-h-0 flex-1 min-w-0 overflow-hidden p-2">
                    <Virtuoso
                        style={{ height: "100%", minWidth: 0 }}
                        data={sortedErrors}
                        computeItemKey={(_index, error) => error.id}
                        itemContent={(_index, error) => (
                            <ProblemRow
                                error={error}
                                onOpenFile={handleOpenFile}
                                onAskAI={handleAskAI}
                                onDismiss={handleDismiss}
                                projectPath={projectPath}
                            />
                        )}
                    />
                </div>
            )}
        </div>
    )
}

interface ProblemRowProps {
    error: ProblemItem
    onOpenFile: (error: ProblemItem) => void
    onAskAI: (error: ProblemItem) => void
    onDismiss: (id: string) => void
    projectPath?: string | null
    showFileLabel?: boolean
    showLocation?: boolean
    showSource?: boolean
}

const ProblemRow = memo(function ProblemRow({
    error,
    onOpenFile,
    onAskAI,
    onDismiss,
    projectPath,
    showFileLabel = true,
    showLocation = true,
    showSource = true,
}: ProblemRowProps) {
    const severityIcon = getSeverityIcon(error.severity)
    const location = formatLocation(error)
    const fileLabel = error.file ? toRelativePath(error.file, projectPath) : null
    const clickable = Boolean(error.file)
    const hasMeta =
        (showFileLabel && Boolean(fileLabel)) ||
        (showLocation && Boolean(location)) ||
        showSource

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
                "group w-full max-w-full overflow-hidden flex items-start gap-2 px-2 py-1.5 text-xs",
                clickable ? "cursor-pointer hover:bg-muted/50" : "cursor-default"
            )}
        >
            {createElement(severityIcon, {
                className: cn(
                    "h-3.5 w-3.5 mt-0.5",
                    error.severity === "error" && "text-destructive",
                    error.severity === "warning" && "text-yellow-500",
                    error.severity === "info" && "text-blue-400"
                )
            })}
            <div className="flex-1 min-w-0 overflow-hidden">
                <div className="text-foreground/90 truncate">{error.message}</div>
                {hasMeta ? (
                    <div className="min-w-0 flex items-center gap-2 text-muted-foreground mt-0.5">
                        {showFileLabel && fileLabel ? <span className="min-w-0 flex-1 truncate">{fileLabel}</span> : null}
                        {showLocation && location ? <span className="shrink-0">{location}</span> : null}
                        {showSource ? <span className="shrink-0 uppercase text-[10px]">{error.source}</span> : null}
                    </div>
                ) : null}
            </div>
            <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(event) => {
                                event.stopPropagation()
                                onAskAI(error)
                            }}
                            title="Ask AI"
                        >
                            <Sparkles className="h-3.5 w-3.5" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Ask AI</TooltipContent>
                </Tooltip>
                <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={(event) => {
                        event.stopPropagation()
                        onDismiss(error.id)
                    }}
                    title="Dismiss"
                >
                    <X className="h-3 w-3" />
                </button>
            </div>
        </div>
    )
})

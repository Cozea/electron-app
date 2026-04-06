import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { cn } from "@/lib/utils"
import {
    useTerminalStore,
    useTerminalActions,
    selectPanelTerminalCount,
} from "@/stores/useTerminalStore"
import {
    useProblemsStore,
    selectProjectProblems,
    selectUnreadCount,
} from "@/stores/useProblemsStore"
import { requestEditorDiagnosticsRefresh } from "@/hooks/useDiagnosticsBridge"
import { TerminalTabBar, type TerminalPanelView } from "./TerminalTabBar"
import { TerminalInstance } from "./TerminalInstance"
import { TerminalSplitView } from "./TerminalSplitView"
import { ProblemsView, type ViewMode } from "./ProblemsView"

// Panel height constraints
const MIN_PANEL_HEIGHT = 150
const MAX_PANEL_HEIGHT = 600

interface TerminalPanelProps {
    className?: string
    projectPath: string
    onOpenFile?: (filePath: string, line?: number, column?: number) => void
}

export function TerminalPanel({
    className,
    projectPath,
    onOpenFile,
}: TerminalPanelProps) {
    // Use individual primitive selectors to avoid infinite loops
    const isPanelOpen = useTerminalStore((s) => s.isPanelOpen)
    const isMaximized = useTerminalStore((s) => s.isMaximized)
    const panelHeight = useTerminalStore((s) => s.panelHeight)
    const terminals = useTerminalStore((s) => s.terminals)
    const groups = useTerminalStore((s) => s.groups)
    const activeGroupId = useTerminalStore((s) => s.activeGroupId)
    const unreadErrorCount = useProblemsStore(selectUnreadCount(projectPath))
    const projectProblems = useProblemsStore(selectProjectProblems(projectPath))
    const markRead = useProblemsStore((state) => state.actions.markRead)
    const clearProblems = useProblemsStore((state) => state.actions.clearProblems)
    const { setPanelHeight, setPanelOpen } = useTerminalActions()

    // Compute derived values with useMemo
    const activeGroup = useMemo(() => {
        return activeGroupId ? groups[activeGroupId] ?? null : null
    }, [activeGroupId, groups])

    const activeTerminal = useMemo(() => {
        if (!activeGroup?.activeTerminalId) return null
        return terminals[activeGroup.activeTerminalId] ?? null
    }, [activeGroup, terminals])
    const activeGroupTerminals = useMemo(() => {
        if (!activeGroup) return []
        return activeGroup.terminalIds.map((id) => terminals[id]).filter(Boolean)
    }, [activeGroup, terminals])
    const previousTerminalStatusesRef = useRef<Record<string, string>>({})

    const [activeView, setActiveView] = useState<TerminalPanelView>("terminal")
    const [isDragging, setIsDragging] = useState(false)
    const dragStartY = useRef(0)
    const dragStartHeight = useRef(0)

    const [problemsSearchQuery, setProblemsSearchQuery] = useState("")
    const [problemsViewMode, setProblemsViewMode] = useState<ViewMode>("tree")
    const [showProblemErrors, setShowProblemErrors] = useState(true)
    const [showProblemWarnings, setShowProblemWarnings] = useState(true)
    const [showProblemInfos, setShowProblemInfos] = useState(true)

    const problemSeverityCounts = useMemo(
        () =>
            projectProblems.reduce(
                (acc, problem) => {
                    if (problem.dismissed) return acc
                    if (problem.severity === "error") acc.error += 1
                    if (problem.severity === "warning") acc.warning += 1
                    if (problem.severity === "info") acc.info += 1
                    return acc
                },
                { error: 0, warning: 0, info: 0 }
            ),
        [projectProblems]
    )

    const handleRefreshProblems = useCallback(() => {
        requestEditorDiagnosticsRefresh()
    }, [])

    const handleClearProblems = useCallback(() => {
        if (!projectPath) return
        clearProblems(projectPath)
    }, [clearProblems, projectPath])

    // Resize handlers
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        setIsDragging(true)
        dragStartY.current = e.clientY
        dragStartHeight.current = panelHeight
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
    }, [panelHeight])

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return
        const delta = dragStartY.current - e.clientY
        const newHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, dragStartHeight.current + delta))
        setPanelHeight(newHeight)
    }, [isDragging, setPanelHeight])

    const handlePointerUp = useCallback(() => {
        setIsDragging(false)
    }, [])

    const handleDoubleClick = useCallback(() => {
        setPanelHeight(250) // Reset to default
    }, [setPanelHeight])

    // Get terminal count for display
    const terminalCount = useTerminalStore(selectPanelTerminalCount)

    // Determine the actual panel height (maximized = full height)
    const actualHeight = isMaximized ? '100%' : `${panelHeight}px`

    // Hide panel instead of unmounting to keep terminals alive
    const handleViewChange = useCallback((view: TerminalPanelView) => {
        setActiveView(view)
        if (view === "problems") {
            markRead(projectPath)
        }
    }, [markRead, projectPath])

    const terminalInstances = useMemo(() =>
        Object.values(terminals).filter((terminal) => terminal.surface !== 'assistant'),
        [terminals]
    )

    useEffect(() => {
        const previousStatuses = previousTerminalStatusesRef.current
        const nextStatuses: Record<string, string> = {}
        let shouldRefreshDiagnostics = false

        for (const terminal of terminalInstances) {
            nextStatuses[terminal.id] = terminal.status
            if (terminal.projectPath !== projectPath) continue

            const previousStatus = previousStatuses[terminal.id]
            if (
                previousStatus &&
                previousStatus !== terminal.status &&
                (terminal.status === "exited" || terminal.status === "error")
            ) {
                shouldRefreshDiagnostics = true
            }
        }

        previousTerminalStatusesRef.current = nextStatuses

        if (shouldRefreshDiagnostics) {
            requestEditorDiagnosticsRefresh()
        }
    }, [projectPath, terminalInstances])

    return (
        <div
            className={cn(
                "flex flex-col border-t border-border w-full mt-auto relative bg-content-surface",
                isMaximized && "absolute inset-0 z-50",
                !isPanelOpen && "hidden",
                className
            )}
            style={{
                height: actualHeight,
            }}
        >
            {/* Resize Handle (only when not maximized) */}
            {!isMaximized && (
                <div
                    className={cn(
                        "absolute left-0 right-0 top-0 h-1 cursor-ns-resize z-50",
                        "hover:bg-primary/20 transition-colors",
                        isDragging && "bg-primary/30"
                    )}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onDoubleClick={handleDoubleClick}
                    title="Drag to resize, double-click to reset"
                />
            )}

            {/* Tab Bar */}
            <TerminalTabBar
                activeView={activeView}
                onViewChange={handleViewChange}
                problemCount={unreadErrorCount}
                projectPath={projectPath}
                onClose={() => setPanelOpen(false)}
                problemsSearchQuery={problemsSearchQuery}
                onProblemsSearchChange={setProblemsSearchQuery}
                problemsViewMode={problemsViewMode}
                onProblemsViewModeChange={setProblemsViewMode}
                showProblemErrors={showProblemErrors}
                onShowProblemErrorsChange={setShowProblemErrors}
                showProblemWarnings={showProblemWarnings}
                onShowProblemWarningsChange={setShowProblemWarnings}
                showProblemInfos={showProblemInfos}
                onShowProblemInfosChange={setShowProblemInfos}
                problemSeverityCounts={problemSeverityCounts}
                onRefreshProblems={handleRefreshProblems}
                onClearProblems={handleClearProblems}
            />

            {/* Panel Content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {/* Terminal view */}
                <div
                    className={cn(
                        "h-full w-full",
                        activeView !== "terminal" && "hidden"
                    )}
                >
                    {terminalCount === 0 ? (
                        // Empty state
                        <div
                            className="flex items-center justify-center h-full text-muted-foreground"
                        >
                            <div className="text-center">
                                <p className="text-sm">No terminal running</p>
                                <p className="text-xs mt-1">Use the + button to create a new terminal</p>
                            </div>
                        </div>
                    ) : activeGroup && activeGroup.terminalIds.length > 1 && activeGroup.splitDirection ? (
                        // Split view
                        <TerminalSplitView group={activeGroup} />
                    ) : activeGroupTerminals.length > 0 ? (
                        // Keep non-split terminals mounted so switching tabs preserves xterm state/output.
                        <div className="relative h-full w-full">
                            {activeGroupTerminals.map((terminal) => {
                                const isActiveTerminal = terminal.id === activeTerminal?.id
                                return (
                                    <TerminalInstance
                                        key={terminal.id}
                                        terminalId={terminal.id}
                                        className={cn(
                                            "absolute inset-0 h-full w-full transition-opacity duration-150",
                                            isActiveTerminal ? "opacity-100" : "opacity-0 pointer-events-none"
                                        )}
                                        shouldAutoFocus={isActiveTerminal}
                                    />
                                )
                            })}
                        </div>
                    ) : (
                        // Fallback empty state
                        <div
                            className="flex items-center justify-center h-full text-muted-foreground"
                        >
                            <p className="text-sm">Select a terminal</p>
                        </div>
                    )}
                </div>

                {/* Problems view */}
                {activeView === "problems" && (
                    <ProblemsView
                        projectPath={projectPath}
                        onOpenFile={onOpenFile}
                        searchQuery={problemsSearchQuery}
                        viewMode={problemsViewMode}
                        showErrors={showProblemErrors}
                        showWarnings={showProblemWarnings}
                        showInfos={showProblemInfos}
                    />
                )}
            </div>
        </div>
    )
}

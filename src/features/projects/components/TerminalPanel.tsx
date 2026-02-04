import { useCallback, useRef, useState, useMemo, useEffect } from "react"
import { cn } from "@/lib/utils"
import {
    useTerminalStore,
    useTerminalActions,
} from "@/stores/useTerminalStore"
import { useProblemsStore, selectUnreadCount } from "@/stores/useProblemsStore"
import { TerminalTabBar } from "./TerminalTabBar"
import { TerminalInstance } from "./TerminalInstance"
import { TerminalSplitView } from "./TerminalSplitView"
import { ProblemsView } from "./ProblemsView"

// Panel height constraints
const MIN_PANEL_HEIGHT = 150
const MAX_PANEL_HEIGHT = 600

interface TerminalPanelProps {
    className?: string
    projectPath: string
    onOpenFile?: (filePath: string, line?: number, column?: number) => void
}

export function TerminalPanel({ className, projectPath, onOpenFile }: TerminalPanelProps) {
    // Use individual primitive selectors to avoid infinite loops
    const isPanelOpen = useTerminalStore((s) => s.isPanelOpen)
    const isMaximized = useTerminalStore((s) => s.isMaximized)
    const panelHeight = useTerminalStore((s) => s.panelHeight)
    const terminals = useTerminalStore((s) => s.terminals)
    const groups = useTerminalStore((s) => s.groups)
    const activeGroupId = useTerminalStore((s) => s.activeGroupId)
    const unreadErrorCount = useProblemsStore(selectUnreadCount(projectPath))
    const markRead = useProblemsStore((state) => state.actions.markRead)
    const { setPanelHeight, setPanelOpen, reset: resetTerminals } = useTerminalActions()

    // Compute derived values with useMemo
    const activeGroup = useMemo(() => {
        return activeGroupId ? groups[activeGroupId] ?? null : null
    }, [activeGroupId, groups])

    const activeTerminal = useMemo(() => {
        if (!activeGroup?.activeTerminalId) return null
        return terminals[activeGroup.activeTerminalId] ?? null
    }, [activeGroup, terminals])

    // Cleanup all terminals when leaving the project (component unmounts)
    useEffect(() => {
        // Capture terminals at unmount time
        return () => {
            const currentTerminals = useTerminalStore.getState().terminals
            // Kill all terminal processes
            Object.keys(currentTerminals).forEach((terminalId) => {
                window.electronAPI.terminal.kill({ terminalId }).catch(() => {
                    // Ignore errors - terminal may already be dead
                })
            })
            // Reset the terminal store
            resetTerminals()
        }
    }, [resetTerminals]) // Empty deps - only run on unmount

    const [activeView, setActiveView] = useState<"terminal" | "problems">("terminal")
    const [isDragging, setIsDragging] = useState(false)
    const dragStartY = useRef(0)
    const dragStartHeight = useRef(0)

    const [problemsSearchQuery, setProblemsSearchQuery] = useState("")

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
    const terminalCount = Object.keys(terminals).length

    // Determine the actual panel height (maximized = full height)
    const actualHeight = isMaximized ? '100%' : `${panelHeight}px`

    // Hide panel instead of unmounting to keep terminals alive
    const handleViewChange = useCallback((view: "terminal" | "problems") => {
        setActiveView(view)
        if (view === "problems") {
            markRead(projectPath)
        }
    }, [markRead, projectPath])

    return (
        <div
            className={cn(
                "flex flex-col border-t border-border bg-background w-full mt-auto relative",
                isMaximized && "absolute inset-0 z-50",
                !isPanelOpen && "hidden",
                className
            )}
            style={{ height: actualHeight }}
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
                        <div className="flex items-center justify-center h-full bg-sidebar text-muted-foreground">
                            <div className="text-center">
                                <p className="text-sm">No terminal running</p>
                                <p className="text-xs mt-1">Use the + button to create a new terminal</p>
                            </div>
                        </div>
                    ) : activeGroup && activeGroup.terminalIds.length > 1 && activeGroup.splitDirection ? (
                        // Split view
                        <TerminalSplitView group={activeGroup} />
                    ) : activeTerminal ? (
                        // Single terminal
                        <TerminalInstance
                            terminalId={activeTerminal.id}
                            className="h-full"
                        />
                    ) : (
                        // Fallback empty state
                        <div className="flex items-center justify-center h-full bg-sidebar text-muted-foreground">
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
                    />
                )}
            </div>
        </div>
    )
}

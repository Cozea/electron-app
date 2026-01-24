import { useCallback, useRef, useState, useMemo, useEffect } from "react"
import { cn } from "@/lib/utils"
import {
    useTerminalStore,
    useTerminalActions,
} from "@/stores/useTerminalStore"
import { useDevToolsStore } from "@/stores/useDevToolsStore"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TerminalTabBar } from "./TerminalTabBar"
import { TerminalInstance } from "./TerminalInstance"
import { TerminalSplitView } from "./TerminalSplitView"

// Panel height constraints
const MIN_PANEL_HEIGHT = 150
const MAX_PANEL_HEIGHT = 600

type TabType = "console" | "problems"

interface TerminalPanelProps {
    className?: string
    projectPath: string
}

export function TerminalPanel({ className, projectPath }: TerminalPanelProps) {
    // Use individual primitive selectors to avoid infinite loops
    const isPanelOpen = useTerminalStore((s) => s.isPanelOpen)
    const isMaximized = useTerminalStore((s) => s.isMaximized)
    const panelHeight = useTerminalStore((s) => s.panelHeight)
    const terminals = useTerminalStore((s) => s.terminals)
    const groups = useTerminalStore((s) => s.groups)
    const activeGroupId = useTerminalStore((s) => s.activeGroupId)
    const { errors, unreadErrorCount } = useDevToolsStore()
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
    }, []) // Empty deps - only run on unmount

    const [activeTab, setActiveTab] = useState<TabType>("console")
    const [isDragging, setIsDragging] = useState(false)
    const dragStartY = useRef(0)
    const dragStartHeight = useRef(0)

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

    // Don't render if panel is closed
    if (!isPanelOpen) {
        return null
    }

    // Get terminal count for display
    const terminalCount = Object.keys(terminals).length

    // Determine the actual panel height (maximized = full height)
    const actualHeight = isMaximized ? '100%' : `${panelHeight}px`

    return (
        <div
            className={cn(
                "flex flex-col border-t border-border bg-background w-full mt-auto relative",
                isMaximized && "absolute inset-0 z-50",
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
                activeTab={activeTab}
                onTabChange={setActiveTab}
                problemCount={unreadErrorCount}
                projectPath={projectPath}
                onClose={() => setPanelOpen(false)}
            />

            {/* Panel Content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {/* Console tab with terminal */}
                <div
                    className={cn(
                        "h-full w-full",
                        activeTab !== "console" && "hidden"
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

                {/* Problems tab */}
                {activeTab === "problems" && (
                    <div className="h-full">
                        <ScrollArea className="h-full">
                            <div className="p-2 space-y-1">
                                {errors.length === 0 ? (
                                    <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                                        No problems detected
                                    </div>
                                ) : (
                                    errors.map((error) => (
                                        <div
                                            key={error.id}
                                            className={cn(
                                                "p-2 rounded border text-xs",
                                                error.severity === 'error' && "bg-destructive/10 border-destructive/20 text-destructive",
                                                error.severity === 'warning' && "bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400",
                                                error.dismissed && "opacity-50"
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium truncate">{error.message}</p>
                                                    {error.file && (
                                                        <p className="text-muted-foreground mt-0.5">
                                                            {error.file}
                                                            {error.line && `:${error.line}`}
                                                            {error.column && `:${error.column}`}
                                                        </p>
                                                    )}
                                                </div>
                                                <span className="text-[10px] text-muted-foreground shrink-0">
                                                    {error.source}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                )}
            </div>
        </div>
    )
}

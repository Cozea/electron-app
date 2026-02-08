import { useCallback, useEffect, useMemo } from "react"
import {
    Terminal,
    Check,
    Plus,
    ChevronDown,
    Trash2,
    Maximize2,
    Minimize2,
    X,
    Circle,
    AlertTriangle,
    Info,
    List,
    ListTree,
    RefreshCw,
    Search,
    SlidersHorizontal,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
    useTerminalStore,
    useTerminalActions,
} from "@/stores/useTerminalStore"
import type { TerminalInstance } from "@/stores/useTerminalStore"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { ViewMode } from "./ProblemsView"

interface TerminalTabBarProps {
    activeView: "terminal" | "problems"
    onViewChange: (view: "terminal" | "problems") => void
    problemCount?: number
    projectPath: string
    onClose?: () => void
    problemsSearchQuery: string
    onProblemsSearchChange: (query: string) => void
    problemsViewMode: ViewMode
    onProblemsViewModeChange: (mode: ViewMode) => void
    showProblemErrors: boolean
    onShowProblemErrorsChange: (value: boolean) => void
    showProblemWarnings: boolean
    onShowProblemWarningsChange: (value: boolean) => void
    showProblemInfos: boolean
    onShowProblemInfosChange: (value: boolean) => void
    problemSeverityCounts: {
        error: number
        warning: number
        info: number
    }
    onRefreshProblems: () => void
    onClearProblems: () => void
}

const LEGACY_PORT_SUFFIX_PATTERN = /^(.*?)\s*\((\d{2,5})\)\s*$/

function getTerminalTabDisplay(term: TerminalInstance): { label: string; port?: number } {
    if (term.label && typeof term.port === 'number') {
        return { label: term.label, port: term.port }
    }

    const match = term.title.match(LEGACY_PORT_SUFFIX_PATTERN)
    if (match) {
        const parsedPort = Number(match[2])
        if (Number.isFinite(parsedPort)) {
            return {
                label: term.label || match[1].trim() || term.title,
                port: typeof term.port === 'number' ? term.port : parsedPort,
            }
        }
    }

    return {
        label: term.label || term.title,
        port: typeof term.port === 'number' ? term.port : undefined,
    }
}

export function TerminalTabBar({
    activeView,
    onViewChange,
    problemCount = 0,
    projectPath,
    onClose,
    problemsSearchQuery,
    onProblemsSearchChange,
    problemsViewMode,
    onProblemsViewModeChange,
    showProblemErrors,
    onShowProblemErrorsChange,
    showProblemWarnings,
    onShowProblemWarningsChange,
    showProblemInfos,
    onShowProblemInfosChange,
    problemSeverityCounts,
    onRefreshProblems,
    onClearProblems,
}: TerminalTabBarProps) {
    // Use individual primitive selectors
    const terminals = useTerminalStore((s) => s.terminals)
    const groups = useTerminalStore((s) => s.groups)
    const activeGroupId = useTerminalStore((s) => s.activeGroupId)
    const profiles = useTerminalStore((s) => s.profiles)
    const isMaximized = useTerminalStore((s) => s.isMaximized)
    const {
        addTerminal,
        removeTerminal,
        setActiveTerminal,
        toggleMaximized,
        setPanelOpen,
        setProfiles,
    } = useTerminalActions()

    // Compute derived values with useMemo
    const activeGroup = useMemo(() => {
        return activeGroupId ? groups[activeGroupId] ?? null : null
    }, [activeGroupId, groups])

    const activeTerminal = useMemo(() => {
        if (!activeGroup?.activeTerminalId) return null
        return terminals[activeGroup.activeTerminalId] ?? null
    }, [activeGroup, terminals])

    // Load profiles on mount
    useEffect(() => {
        window.electronAPI.terminal.getProfiles().then(setProfiles)
    }, [setProfiles])

    // Create a new terminal
    const handleCreateTerminal = useCallback(async (profileId?: string) => {
        const result = await window.electronAPI.terminal.create({
            projectPath,
            profileId,
            cols: 80,
            rows: 24,
        })

        if (result.success && result.terminalId) {
            const profile = profiles.find((p) => p.id === profileId) || profiles[0]
            const label = profile?.name || 'Terminal'
            addTerminal({
                id: result.terminalId,
                profileId: profile?.id || 'default',
                profileName: label,
                label,
                kind: 'shell',
                nameSource: 'auto',
                title: label,
                status: 'starting',
                hasOutput: false,
            })
            // Switch to terminal view when creating a new terminal
            onViewChange("terminal")
        }
    }, [projectPath, profiles, addTerminal, onViewChange])

    // Kill the active terminal
    const handleKillTerminal = useCallback(async () => {
        if (!activeTerminal) return

        await window.electronAPI.terminal.kill({ terminalId: activeTerminal.id })
        removeTerminal(activeTerminal.id)
    }, [activeTerminal, removeTerminal])

    // Close the panel
    const handleClose = useCallback(() => {
        setPanelOpen(false)
        onClose?.()
    }, [setPanelOpen, onClose])

    // Handle terminal tab click
    const handleTerminalClick = useCallback((terminalId: string) => {
        setActiveTerminal(terminalId)
        onViewChange("terminal")
    }, [setActiveTerminal, onViewChange])

    // Get terminals in active group
    const groupTerminals = activeGroup
        ? activeGroup.terminalIds.map((id) => terminals[id]).filter(Boolean)
        : []

    const buttonClass = "p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"

    return (
        <div className="flex items-center justify-between bg-sidebar w-full h-9">
            {/* Left: Terminal tabs + Problems tab */}
            <div className="app-scrollbar flex items-center h-full flex-1 min-w-0 overflow-x-auto gap-1 px-2">
                {/* Terminal tabs */}
                {groupTerminals.map((term) => {
                    const isActive = activeView === "terminal" && activeTerminal?.id === term.id
                    const display = getTerminalTabDisplay(term)
                    const portLabel = typeof display.port === 'number' ? `localhost:${display.port}` : null
                    return (
                        <button
                            key={term.id}
                            onClick={() => handleTerminalClick(term.id)}
                            className={cn(
                                "group flex h-6 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] transition-colors",
                                isActive
                                    ? "bg-secondary text-foreground"
                                    : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                            )}
                        >
                            {/* Status indicator */}
                            <Circle
                                className={cn(
                                    "h-2 w-2 shrink-0",
                                    term.status === 'running' && "fill-green-500 text-green-500",
                                    term.status === 'starting' && "fill-yellow-500 text-yellow-500 animate-pulse",
                                    term.status === 'exited' && "fill-muted-foreground text-muted-foreground",
                                    term.status === 'error' && "fill-destructive text-destructive"
                                )}
                            />
                            <span className="truncate max-w-[140px]">{display.label}</span>
                            {portLabel && (
                                <span className="shrink-0 rounded-full bg-muted/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                    {portLabel}
                                </span>
                            )}
                            {/* Close button for individual tab */}
                            <span
                                role="button"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    window.electronAPI.terminal.kill({ terminalId: term.id })
                                    removeTerminal(term.id)
                                }}
                                className="rounded-full p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                            >
                                <X className="h-3 w-3" />
                            </span>
                        </button>
                    )
                })}

                {/* Problems tab - always at the end */}
                <button
                    onClick={() => onViewChange("problems")}
                    className={cn(
                        "flex h-6 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] transition-colors",
                        activeView === "problems"
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                    )}
                >
                    <AlertTriangle className="h-3 w-3" />
                    <span>PROBLEMS</span>
                    {problemCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-destructive/10 text-destructive">
                            {problemCount}
                        </span>
                    )}
                </button>
            </div>

            {/* Right: Controls */}
            <div className="flex items-center gap-1 pr-2 shrink-0">
                {activeView === "problems" && (
                    <>
                        <div className="relative w-52 hidden sm:block">
                            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={problemsSearchQuery}
                                onChange={(event) => onProblemsSearchChange(event.target.value)}
                                placeholder="Filter (text or file)"
                                className="h-7 pl-7 pr-2 text-[11px] bg-background/50 border-input/50 focus-visible:bg-background"
                            />
                        </div>

                        <button
                            onClick={onRefreshProblems}
                            className={buttonClass}
                            title="Refresh diagnostics"
                        >
                            <RefreshCw className="h-4 w-4" />
                        </button>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className={buttonClass} title="Problem controls">
                                    <SlidersHorizontal className="h-4 w-4" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel>Visibility</DropdownMenuLabel>
                                <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                                        <span>Errors</span>
                                        <span className="text-muted-foreground">({problemSeverityCounts.error})</span>
                                    </div>
                                    <Switch checked={showProblemErrors} onCheckedChange={onShowProblemErrorsChange} />
                                </div>
                                <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                                        <span>Warnings</span>
                                        <span className="text-muted-foreground">({problemSeverityCounts.warning})</span>
                                    </div>
                                    <Switch checked={showProblemWarnings} onCheckedChange={onShowProblemWarningsChange} />
                                </div>
                                <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                                    <div className="flex items-center gap-2">
                                        <Info className="h-3.5 w-3.5 text-blue-400" />
                                        <span>Info</span>
                                        <span className="text-muted-foreground">({problemSeverityCounts.info})</span>
                                    </div>
                                    <Switch checked={showProblemInfos} onCheckedChange={onShowProblemInfosChange} />
                                </div>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel>View</DropdownMenuLabel>
                                <DropdownMenuItem onSelect={() => onProblemsViewModeChange("tree")}>
                                    <ListTree className="h-4 w-4 mr-2" />
                                    Tree
                                    {problemsViewMode === "tree" && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => onProblemsViewModeChange("table")}>
                                    <List className="h-4 w-4 mr-2" />
                                    List
                                    {problemsViewMode === "table" && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onSelect={onClearProblems}
                                    className="text-destructive focus:text-destructive"
                                >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Clear problems
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                    </>
                )}

                {/* New terminal dropdown */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className={cn(buttonClass, "flex items-center gap-0.5")} title="New Terminal">
                            <Plus className="h-4 w-4" />
                            <ChevronDown className="h-3 w-3" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                        {profiles.map((profile) => (
                            <DropdownMenuItem
                                key={profile.id}
                                onClick={() => handleCreateTerminal(profile.id)}
                            >
                                <Terminal className="h-4 w-4 mr-2" />
                                {profile.name}
                            </DropdownMenuItem>
                        ))}
                        {profiles.length === 0 && (
                            <DropdownMenuItem onClick={() => handleCreateTerminal()}>
                                <Terminal className="h-4 w-4 mr-2" />
                                Default Terminal
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Kill terminal (only when terminal view is active) */}
                {activeView === "terminal" && (
                    <button
                        onClick={handleKillTerminal}
                        className={buttonClass}
                        title="Kill Terminal"
                        disabled={!activeTerminal}
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                )}

                {/* Separator */}
                <div className="w-px h-4 bg-border mx-1" />

                {/* Maximize/Restore */}
                <button
                    onClick={toggleMaximized}
                    className={buttonClass}
                    title={isMaximized ? "Restore Panel" : "Maximize Panel"}
                >
                    {isMaximized ? (
                        <Minimize2 className="h-4 w-4" />
                    ) : (
                        <Maximize2 className="h-4 w-4" />
                    )}
                </button>

                {/* Close */}
                <button onClick={handleClose} className={buttonClass} title="Close Panel">
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    )
}

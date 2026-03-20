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

function isWindowsClient(): boolean {
    if (typeof navigator === 'undefined') return false
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    const platformHint = nav.userAgentData?.platform || navigator.platform || navigator.userAgent
    return /win/i.test(platformHint)
}

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
        const resolvedProfileId = profileId ?? (isWindowsClient() ? 'cmd' : undefined)
        const result = await window.electronAPI.terminal.create({
            projectPath,
            profileId: resolvedProfileId,
            cols: 80,
            rows: 24,
        })

        if (result.success && result.terminalId) {
            const profile = profiles.find((p) => p.id === resolvedProfileId) || profiles[0]
            const label = profile?.name || 'Terminal'
            addTerminal({
                id: result.terminalId,
                profileId: profile?.id || 'default',
                profileName: label,
                projectPath,
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

    const buttonClass = "p-1 rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-sidebar-foreground"

    return (
        <div
            className="flex items-center justify-between w-full h-9 bg-content-surface"
        >
            {/* Left: Terminal tabs + Problems tab */}
            <div className="app-scrollbar flex items-center h-full flex-1 min-w-0 overflow-x-auto gap-1 px-2">
                {/* Terminal tabs */}
                {groupTerminals.map((term) => {
                    const isActive = activeView === "terminal" && activeTerminal?.id === term.id
                    const display = getTerminalTabDisplay(term)
                    return (
                        <button
                            key={term.id}
                            onClick={() => handleTerminalClick(term.id)}
                            className={cn(
                                "group flex h-6 shrink-0 items-center rounded-full pl-2.5 pr-1.5 text-xs font-medium transition-[background-color,color,box-shadow]",
                                isActive
                                    ? "bg-sidebar/90 dark:bg-secondary/80 text-sidebar-foreground dark:text-secondary-foreground"
                                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                            )}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                {/* Status indicator */}
                                <div className={cn(
                                    "h-1.5 w-1.5 rounded-full shrink-0",
                                    term.status === 'running' && "bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.4)]",
                                    term.status === 'starting' && "bg-yellow-500",
                                    term.status === 'exited' && "bg-muted-foreground/50",
                                    term.status === 'error' && "bg-destructive"
                                )} />
                                <span className="truncate max-w-[140px] tracking-tight">{display.label}</span>
                            </span>
                            {/* Close button for individual tab */}
                            <span
                                role="button"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    window.electronAPI.terminal.kill({ terminalId: term.id })
                                    removeTerminal(term.id)
                                }}
                                className="pointer-events-none ml-0 grid h-4 w-0 shrink-0 place-items-center overflow-hidden rounded opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:ml-1.5 group-hover:w-4 group-hover:opacity-100 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-3 w-3 shrink-0" />
                            </span>
                        </button>
                    )
                })}

                {/* Problems tab - always at the end */}
                <button
                    onClick={() => onViewChange("problems")}
                    className={cn(
                        "flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-[background-color,color,box-shadow]",
                        activeView === "problems"
                            ? "bg-sidebar/90 dark:bg-secondary/80 text-sidebar-foreground dark:text-secondary-foreground"
                            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    )}
                >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="tracking-tight">PROBLEMS</span>
                    {problemCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-destructive/10 text-destructive">
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

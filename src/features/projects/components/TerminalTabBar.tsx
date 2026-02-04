import { useCallback, useEffect, useMemo } from "react"
import {
    Terminal,
    Plus,
    ChevronDown,
    SplitSquareHorizontal,
    Trash2,
    Maximize2,
    Minimize2,
    X,
    Circle,
    AlertTriangle,
    Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
    useTerminalStore,
    useTerminalActions,
} from "@/stores/useTerminalStore"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"

interface TerminalTabBarProps {
    activeView: "terminal" | "problems"
    onViewChange: (view: "terminal" | "problems") => void
    problemCount?: number
    projectPath: string
    onClose?: () => void
    problemsSearchQuery?: string
    onProblemsSearchChange?: (query: string) => void
}

export function TerminalTabBar({
    activeView,
    onViewChange,
    problemCount = 0,
    projectPath,
    onClose,
    problemsSearchQuery = "",
    onProblemsSearchChange,
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
        splitTerminal,
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
            addTerminal({
                id: result.terminalId,
                profileId: profile?.id || 'default',
                profileName: profile?.name || 'Terminal',
                title: profile?.name || 'Terminal',
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

    // Split the active terminal
    const handleSplitTerminal = useCallback(() => {
        if (!activeTerminal) return
        splitTerminal(activeTerminal.id, 'horizontal')
        // Create a new terminal in the same group
        handleCreateTerminal()
    }, [activeTerminal, splitTerminal, handleCreateTerminal])

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
            <div className="flex items-center h-full flex-1 min-w-0 overflow-x-auto gap-1 px-2">
                {/* Terminal tabs */}
                {groupTerminals.map((term) => {
                    const isActive = activeView === "terminal" && activeTerminal?.id === term.id
                    return (
                        <button
                            key={term.id}
                            onClick={() => handleTerminalClick(term.id)}
                            className={cn(
                                "group flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors shrink-0",
                                isActive
                                    ? "bg-muted text-foreground"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
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
                            <span className="truncate max-w-[120px]">{term.title}</span>
                            {/* Close button for individual tab */}
                            <span
                                role="button"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    window.electronAPI.terminal.kill({ terminalId: term.id })
                                    removeTerminal(term.id)
                                }}
                                className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
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
                        "flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors shrink-0",
                        activeView === "problems"
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
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

            {/* Search Bar (only for problems view) */}
            {activeView === "problems" && (
                <div className="relative w-48 mr-2 hidden sm:block">
                    <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                    <Input
                        value={problemsSearchQuery}
                        onChange={(event) => onProblemsSearchChange?.(event.target.value)}
                        placeholder="Filter (text or file)"
                        className="h-6 pl-7 text-[11px] bg-background/50 border-input/50 focus-visible:bg-background"
                    />
                </div>
            )}

            {/* Right: Controls */}
            <div className="flex items-center gap-0.5 pr-2 shrink-0">
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

                {/* Split terminal (only when terminal view is active) */}
                {activeView === "terminal" && (
                    <button
                        onClick={handleSplitTerminal}
                        className={buttonClass}
                        title="Split Terminal"
                        disabled={!activeTerminal}
                    >
                        <SplitSquareHorizontal className="h-4 w-4" />
                    </button>
                )}

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

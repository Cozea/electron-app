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

type TabType = "console" | "problems"

interface TerminalTabBarProps {
    activeTab: TabType
    onTabChange: (tab: TabType) => void
    problemCount?: number
    projectPath: string
    onClose?: () => void
}

export function TerminalTabBar({
    activeTab,
    onTabChange,
    problemCount = 0,
    projectPath,
    onClose,
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
        }
    }, [projectPath, profiles, addTerminal])

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

    // Get terminals in active group
    const groupTerminals = activeGroup
        ? activeGroup.terminalIds.map((id) => terminals[id]).filter(Boolean)
        : []

    const tabs: { id: TabType; label: string; count?: number }[] = [
        { id: "console", label: "CONSOLE" },
        { id: "problems", label: "PROBLEMS", count: problemCount },
    ]

    const buttonClass = "p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"

    return (
        <div className="flex items-center justify-between bg-sidebar w-full h-9">
            {/* Left: Tab switcher */}
            <div className="flex items-center h-full">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => onTabChange(tab.id)}
                        className={cn(
                            "relative flex items-center gap-1.5 px-3 h-full text-[11px] tracking-wide transition-colors",
                            activeTab === tab.id
                                ? "text-sidebar-foreground"
                                : "text-muted-foreground hover:text-sidebar-foreground"
                        )}
                    >
                        <span>{tab.label}</span>
                        {tab.count !== undefined && tab.count > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-destructive/10 text-destructive">
                                {tab.count}
                            </span>
                        )}
                        {activeTab === tab.id && (
                            <span className="absolute bottom-0 left-3 right-3 h-px bg-primary" />
                        )}
                    </button>
                ))}
            </div>

            {/* Center: Terminal tabs (only show when console tab is active) */}
            {activeTab === "console" && groupTerminals.length > 0 && (
                <div className="flex items-center gap-0.5 flex-1 px-2 overflow-x-auto">
                    {groupTerminals.map((term) => (
                        <div
                            key={term.id}
                            onClick={() => setActiveTerminal(term.id)}
                            className={cn(
                                "group flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors min-w-0 cursor-pointer",
                                activeTerminal?.id === term.id
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
                            <span className="truncate max-w-[100px]">{term.title}</span>
                            {/* Close button for individual tab */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    window.electronAPI.terminal.kill({ terminalId: term.id })
                                    removeTerminal(term.id)
                                }}
                                className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Right: Controls */}
            <div className="flex items-center gap-0.5 pr-2">
                {/* Process indicator (only when console is active) */}
                {activeTab === "console" && activeTerminal && (
                    <div className="flex items-center gap-1 px-2 text-[11px] text-muted-foreground">
                        <Terminal className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{activeTerminal.profileName}</span>
                        {activeTerminal.status === 'running' && (
                            <span className="text-green-500">●</span>
                        )}
                    </div>
                )}

                {activeTab === "console" && (
                    <>
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

                        {/* Split terminal */}
                        <button
                            onClick={handleSplitTerminal}
                            className={buttonClass}
                            title="Split Terminal"
                            disabled={!activeTerminal}
                        >
                            <SplitSquareHorizontal className="h-4 w-4" />
                        </button>

                        {/* Kill terminal */}
                        <button
                            onClick={handleKillTerminal}
                            className={buttonClass}
                            title="Kill Terminal"
                            disabled={!activeTerminal}
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>

                        {/* Separator */}
                        <div className="w-px h-4 bg-border mx-1" />
                    </>
                )}

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

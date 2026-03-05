import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronUp, ChevronDown, X, Search } from "lucide-react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { SearchAddon } from "@xterm/addon-search"
import "@xterm/xterm/css/xterm.css"
import { cn } from "@/lib/utils"
import { useProjectPagesStore } from "@/stores/useProjectPagesStore"
import { useProblemsStore, selectProjectProblems, selectUnreadCount } from "@/stores/useProblemsStore"
import { useTerminalStore } from "@/stores/useTerminalStore"
import { ScrollArea } from "@/components/ui/scroll-area"

type TabType = "console" | "problems"

interface DevServerPanelProps {
    className?: string
    defaultCollapsed?: boolean
    projectPath?: string | null
}

export function DevServerPanel({ className, defaultCollapsed = false, projectPath }: DevServerPanelProps) {
    const { serverStatus, serverOutput, consolePanelHeight, actions } = useProjectPagesStore()
    const devServerTerminalId = useTerminalStore((state) => {
        if (!projectPath) return null

        const matchingTerminals = Object.values(state.terminals).filter((terminal) =>
            terminal.projectPath === projectPath &&
            terminal.kind === 'dev-server' &&
            (terminal.status === 'starting' || terminal.status === 'running')
        )

        if (matchingTerminals.length === 0) return null

        const activeGroup = state.activeGroupId ? state.groups[state.activeGroupId] : null
        const activeTerminalId = activeGroup?.activeTerminalId
        if (activeTerminalId && matchingTerminals.some((terminal) => terminal.id === activeTerminalId)) {
            return activeTerminalId
        }

        return matchingTerminals[0].id
    })
    const errors = useProblemsStore(selectProjectProblems(projectPath))
    const unreadErrorCount = useProblemsStore(selectUnreadCount(projectPath))
    const [activeTab, setActiveTab] = useState<TabType>("console")
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
    const [isDragging, setIsDragging] = useState(false)
    const [hasOutput, setHasOutput] = useState(false)
    const [showSearch, setShowSearch] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [terminalInitRetry, setTerminalInitRetry] = useState(0)
    const dragStartY = useRef(0)
    const dragStartHeight = useRef(0)
    const searchInputRef = useRef<HTMLInputElement>(null)

    // xterm refs
    const terminalContainerRef = useRef<HTMLDivElement>(null)
    const xtermRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const searchAddonRef = useRef<SearchAddon | null>(null)
    const devServerTerminalIdRef = useRef<string | null>(null)
    const serverOutputRef = useRef(serverOutput)
    // Track previous output length to detect new lines
    const prevOutputLengthRef = useRef(serverOutput.length)

    useEffect(() => {
        devServerTerminalIdRef.current = devServerTerminalId
    }, [devServerTerminalId])

    useEffect(() => {
        serverOutputRef.current = serverOutput
    }, [serverOutput])

    // Initialize xterm
    useEffect(() => {
        if (serverStatus === 'stopped') return
        if (isCollapsed) return

        const container = terminalContainerRef.current
        if (!container || xtermRef.current) return

        // Verify container has dimensions before opening terminal
        const rect = container.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) {
            // Container not ready yet - retry after a short delay
            const timeoutId = setTimeout(() => {
                setTerminalInitRetry(prev => prev + 1)
            }, 50)
            return () => clearTimeout(timeoutId)
        }

        // Calculate initial dimensions based on container size
        const fontSize = 12
        const charWidth = fontSize * 0.6 // Approximate monospace char width
        const charHeight = fontSize * 1.0 // lineHeight = 1
        const cols = Math.max(80, Math.floor((rect.width - 16) / charWidth))
        const rows = Math.max(10, Math.floor((rect.height - 8) / charHeight))

        // Convert CSS color (including oklch) to hex using canvas
        const colorToHex = (cssColor: string): string => {
            const canvas = document.createElement('canvas')
            canvas.width = 1
            canvas.height = 1
            const ctx = canvas.getContext('2d')
            if (!ctx) return '#000000'

            ctx.fillStyle = cssColor
            ctx.fillRect(0, 0, 1, 1)
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
        }

        // Get CSS variable value and convert to hex
        const getThemeColor = (cssVar: string, fallback: string): string => {
            // Use the terminal container's parent to get correct theme context
            const themeRoot = container.closest('.dark, .navy, .wine, .clay, .forest') || document.documentElement
            const computed = getComputedStyle(themeRoot).getPropertyValue(cssVar).trim()

            if (!computed) {
                return fallback
            }

            // Create temp element within the theme context to resolve the color
            const tempDiv = document.createElement('div')
            tempDiv.style.position = 'absolute'
            tempDiv.style.visibility = 'hidden'
            tempDiv.style.backgroundColor = computed
            document.body.appendChild(tempDiv)
            const resolvedColor = getComputedStyle(tempDiv).backgroundColor
            document.body.removeChild(tempDiv)

            if (!resolvedColor || resolvedColor === 'rgba(0, 0, 0, 0)' || resolvedColor === 'transparent') {
                return fallback
            }
            return colorToHex(resolvedColor)
        }

        const relativeLuminance = (hex: string): number => {
            const normalized = hex.replace('#', '')
            if (normalized.length !== 6) return 0
            const r = parseInt(normalized.slice(0, 2), 16) / 255
            const g = parseInt(normalized.slice(2, 4), 16) / 255
            const b = parseInt(normalized.slice(4, 6), 16) / 255
            const channel = (value: number) =>
                value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
            return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
        }

        const buildAnsiPalette = (useDarkPalette: boolean) => {
            if (useDarkPalette) {
                return {
                    black: '#09090b',
                    red: '#f87171',
                    green: '#4ade80',
                    yellow: '#facc15',
                    blue: '#60a5fa',
                    magenta: '#c084fc',
                    cyan: '#22d3ee',
                    white: '#d4d4d8',
                    brightBlack: '#52525b',
                    brightRed: '#fca5a5',
                    brightGreen: '#86efac',
                    brightYellow: '#fde047',
                    brightBlue: '#93c5fd',
                    brightMagenta: '#d8b4fe',
                    brightCyan: '#67e8f9',
                    brightWhite: '#f4f4f5',
                }
            }

            return {
                black: '#2f333d',
                red: '#d73a49',
                green: '#22863a',
                yellow: '#9a6700',
                blue: '#005cc5',
                magenta: '#6f42c1',
                cyan: '#0a7ea4',
                white: '#57606a',
                brightBlack: '#6e7781',
                brightRed: '#cf222e',
                brightGreen: '#1a7f37',
                brightYellow: '#8a4600',
                brightBlue: '#0969da',
                brightMagenta: '#8250df',
                brightCyan: '#1b7c83',
                brightWhite: '#24292f',
            }
        }

        // Map theme colors - resolved from CSS variables to hex
        // Use --sidebar to match the app's sidebar color
        const background = getThemeColor('--sidebar', '#1a1a1a')
        const foreground = getThemeColor('--foreground', '#fafafa')
        const muted = getThemeColor('--muted', '#27272a')
        const useDarkPalette = relativeLuminance(background) < 0.45
        const ansi = buildAnsiPalette(useDarkPalette)

        console.log('[Terminal] Theme colors - bg:', background, 'fg:', foreground, 'muted:', muted)

        const term = new Terminal({
            cols,
            rows,
            theme: {
                background,
                foreground,
                cursor: foreground,
                cursorAccent: background,
                selectionBackground: muted,
                ...ansi,
            },
            // Font settings (matching VS Code defaults)
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontWeight: '400',
            fontWeightBold: '700',
            letterSpacing: 0,
            lineHeight: 1,
            // Cursor settings
            cursorBlink: false,
            cursorStyle: 'block',
            // Other settings
            scrollback: 10000,
            allowProposedApi: true,
            drawBoldTextInBrightColors: true,
            minimumContrastRatio: 4.5,
        })

        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.loadAddon(new WebLinksAddon())

        // Load search addon
        const searchAddon = new SearchAddon()
        term.loadAddon(searchAddon)
        searchAddonRef.current = searchAddon

        term.open(container)

        // Forward keyboard input to the active dev-server terminal.
        term.onData((data) => {
            const terminalId = devServerTerminalIdRef.current
            if (!terminalId) return
            void window.electronAPI.terminal.input({ terminalId, data }).catch((error) => {
                console.error('[DevServerPanel] Failed to forward input to terminal:', error)
            })
        })

        xtermRef.current = term
        fitAddonRef.current = fitAddon

        // Fit after opening and notify PTY of dimensions
        setTimeout(() => {
            try {
                fitAddon.fit()
                term.focus()

                // Notify PTY of the terminal dimensions.
                const { cols, rows } = term
                const terminalId = devServerTerminalIdRef.current
                if (terminalId) {
                    console.log(`[Terminal] Initial terminal resize: ${cols}x${rows}`)
                    void window.electronAPI.terminal.resize({ terminalId, cols, rows })
                } else if (projectPath) {
                    console.log(`[Terminal] Initial legacy PTY resize: ${cols}x${rows}`)
                    void window.electronAPI.devServer.resize({ projectPath, cols, rows })
                }
            } catch (e) {
                console.error('Terminal fit failed:', e)
            }
        }, 50)

        // Restore history from store
        const history = serverOutputRef.current
        if (history.length > 0) {
            term.write(history.join(''))
            setHasOutput(true)
        }
        prevOutputLengthRef.current = history.length

        // Register custom link provider for file paths (e.g., src/App.tsx:42:10)
        term.registerLinkProvider({
            provideLinks: (bufferLineNumber, callback) => {
                const line = term.buffer.active.getLine(bufferLineNumber)?.translateToString()
                if (!line) return callback(undefined)

                // Match file:line:col patterns for common source files
                const regex = /([.\w/\\-]+\.[jt]sx?):(\d+)(?::(\d+))?/g
                const links: Array<{
                    range: { start: { x: number; y: number }; end: { x: number; y: number } }
                    text: string
                    activate: () => void
                }> = []
                let match
                while ((match = regex.exec(line)) !== null) {
                    const filePath = match[1]
                    const lineNum = match[2]
                    const colNum = match[3]
                    links.push({
                        range: {
                            start: { x: match.index + 1, y: bufferLineNumber },
                            end: { x: match.index + match[0].length + 1, y: bufferLineNumber }
                        },
                        text: match[0],
                        activate: () => {
                            console.log('[Terminal] Open file:', filePath, 'line:', lineNum, colNum ? `col: ${colNum}` : '')
                        }
                    })
                }
                callback(links.length > 0 ? links : undefined)
            }
        })

        return () => {
            term.dispose()
            xtermRef.current = null
            fitAddonRef.current = null
            searchAddonRef.current = null
        }
    }, [serverStatus, isCollapsed, terminalInitRetry, projectPath])

    // Listen for new output and write to terminal
    useEffect(() => {
        if (!xtermRef.current) return

        const currentLength = serverOutput.length
        const prevLength = prevOutputLengthRef.current

        if (currentLength > prevLength) {
            // Write new lines
            const newLines = serverOutput.slice(prevLength)
            newLines.forEach(line => {
                xtermRef.current?.write(line)
            })
            setHasOutput(true)
        } else if (currentLength === 0 && prevLength > 0) {
            // Output was cleared
            xtermRef.current?.clear()
            setHasOutput(false)
        }

        prevOutputLengthRef.current = currentLength
    }, [serverOutput])

    // Notify PTY of terminal resize
    const notifyPtyResize = useCallback(() => {
        if (!xtermRef.current) return

        const { cols, rows } = xtermRef.current
        const terminalId = devServerTerminalIdRef.current
        if (terminalId) {
            console.log(`[Terminal] Notifying terminal resize: ${cols}x${rows}`)
            void window.electronAPI.terminal.resize({ terminalId, cols, rows })
            return
        }

        if (projectPath) {
            console.log(`[Terminal] Notifying legacy PTY resize: ${cols}x${rows}`)
            void window.electronAPI.devServer.resize({ projectPath, cols, rows })
        }
    }, [projectPath])

    // Handle resize when panel height changes
    useEffect(() => {
        if (!fitAddonRef.current || !xtermRef.current || isCollapsed) return

        const timeoutId = setTimeout(() => {
            fitAddonRef.current?.fit()
            // Notify PTY of the new dimensions
            notifyPtyResize()
        }, 50)

        return () => clearTimeout(timeoutId)
    }, [consolePanelHeight, isCollapsed, notifyPtyResize])

    // Auto-expand when server starts
    useEffect(() => {
        if (serverStatus === 'starting' || serverStatus === 'running') {
            setIsCollapsed(false)
        }
        if (serverStatus === 'stopped') {
            setHasOutput(false)
        }
    }, [serverStatus])

    // Clear terminal when server starts
    useEffect(() => {
        if (serverStatus === 'starting' && xtermRef.current) {
            xtermRef.current.clear()
            setHasOutput(false)
        }
    }, [serverStatus])

    // Resize handlers
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        setIsDragging(true)
        dragStartY.current = e.clientY
        dragStartHeight.current = consolePanelHeight
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
    }, [consolePanelHeight])

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return
        const delta = dragStartY.current - e.clientY
        const newHeight = dragStartHeight.current + delta
        actions.setConsolePanelHeight(newHeight)
    }, [isDragging, actions])

    const handlePointerUp = useCallback(() => {
        setIsDragging(false)
    }, [])

    const handleDoubleClick = useCallback(() => {
        actions.resetConsolePanelHeight()
    }, [actions])

    const handleClear = useCallback(() => {
        xtermRef.current?.clear()
        actions.clearServerOutput()
        setHasOutput(false)
    }, [actions])

    // Search functions
    const handleSearchNext = useCallback(() => {
        if (searchAddonRef.current && searchQuery) {
            searchAddonRef.current.findNext(searchQuery, { caseSensitive: false })
        }
    }, [searchQuery])

    const handleSearchPrev = useCallback(() => {
        if (searchAddonRef.current && searchQuery) {
            searchAddonRef.current.findPrevious(searchQuery, { caseSensitive: false })
        }
    }, [searchQuery])

    const handleCloseSearch = useCallback(() => {
        setShowSearch(false)
        setSearchQuery('')
        searchAddonRef.current?.clearDecorations()
    }, [])

    // Keyboard handler for Ctrl+F search
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f' && activeTab === 'console') {
                e.preventDefault()
                setShowSearch(true)
                setTimeout(() => searchInputRef.current?.focus(), 0)
            }
            if (e.key === 'Escape' && showSearch) {
                handleCloseSearch()
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [showSearch, handleCloseSearch, activeTab])

    const tabs: { id: TabType; label: string; count?: number }[] = [
        { id: "console", label: "CONSOLE" },
        { id: "problems", label: "PROBLEMS", count: unreadErrorCount },
    ]

    // Don't show panel when server is stopped
    if (serverStatus === 'stopped') {
        return null
    }

    return (
        <div className={cn(
            "flex flex-col border-t border-border bg-background w-full mt-auto relative",
            className
        )}>
            {/* Resize Handle */}
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

            {/* Tab Bar - VS Code style */}
            <div className="flex items-center justify-between bg-sidebar w-full h-9">
                <div className="flex items-center h-full">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveTab(tab.id)
                                if (isCollapsed) setIsCollapsed(false)
                            }}
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

                {/* Panel Controls */}
                <div className="flex items-center gap-1 pr-2">
                    {activeTab === "console" && (
                        <button
                            onClick={() => {
                                setShowSearch(true)
                                setTimeout(() => searchInputRef.current?.focus(), 0)
                            }}
                            className={cn(
                                "p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors",
                                showSearch && "bg-muted text-foreground"
                            )}
                            title="Search (Ctrl+F)"
                        >
                            <Search className="h-4 w-4" />
                        </button>
                    )}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title={isCollapsed ? "Expand panel" : "Collapse panel"}
                    >
                        {isCollapsed ? (
                            <ChevronUp className="h-4 w-4" />
                        ) : (
                            <ChevronDown className="h-4 w-4" />
                        )}
                    </button>
                    <button
                        onClick={handleClear}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Clear console"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Panel Content */}
            {!isCollapsed && (
                <div className="flex-1 min-h-0">
                    {/* Console tab with xterm */}
                    <div
                        className={cn(
                            "relative bg-sidebar overflow-hidden",
                            activeTab !== "console" && "hidden"
                        )}
                        style={{ height: `${consolePanelHeight}px` }}
                    >
                        {/* xterm container */}
                        <div
                            ref={terminalContainerRef}
                            onMouseDown={() => xtermRef.current?.focus()}
                            className="absolute inset-0 p-1 overflow-hidden"
                        />

                        {/* Search overlay */}
                        {showSearch && (
                            <div className="absolute top-1 right-1 z-20 flex items-center gap-1 bg-muted border border-border rounded px-2 py-1 shadow-lg">
                                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value)
                                        if (e.target.value && searchAddonRef.current) {
                                            searchAddonRef.current.findNext(e.target.value, { caseSensitive: false })
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            if (e.shiftKey) {
                                                handleSearchPrev()
                                            } else {
                                                handleSearchNext()
                                            }
                                        }
                                        if (e.key === 'Escape') {
                                            handleCloseSearch()
                                        }
                                    }}
                                    placeholder="Search..."
                                    className="bg-transparent border-none outline-none text-xs text-foreground w-32 placeholder:text-muted-foreground"
                                />
                                <button
                                    onClick={handleSearchPrev}
                                    className="p-0.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
                                    title="Previous match (Shift+Enter)"
                                >
                                    <ChevronUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    onClick={handleSearchNext}
                                    className="p-0.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
                                    title="Next match (Enter)"
                                >
                                    <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    onClick={handleCloseSearch}
                                    className="p-0.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
                                    title="Close (Escape)"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        )}

                        {/* Loading state overlay */}
                        {!hasOutput && serverStatus === 'starting' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-sidebar/80 text-muted-foreground z-10">
                                <span className="flex items-center gap-2">
                                    <span className="inline-flex gap-0.5">
                                        <span className="animate-pulse">●</span>
                                        <span className="animate-pulse" style={{ animationDelay: '150ms' }}>●</span>
                                        <span className="animate-pulse" style={{ animationDelay: '300ms' }}>●</span>
                                    </span>
                                    Starting server...
                                </span>
                            </div>
                        )}
                    </div>

                    {activeTab === "problems" && (
                        <div style={{ height: `${consolePanelHeight}px` }}>
                            <ScrollArea className="h-full">
                                <div className="p-2 space-y-1">
                                    {errors.length === 0 ? (
                                        <div className="flex items-center justify-center h-24 text-zinc-500 text-sm">
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
            )}
        </div>
    )
}

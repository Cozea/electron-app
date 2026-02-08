import { useCallback, useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { SearchAddon } from "@xterm/addon-search"
import { Sparkles } from "lucide-react"
import "@xterm/xterm/css/xterm.css"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTerminalActions, useTerminalStore } from "@/stores/useTerminalStore"
import { useAssistantPanelStore } from "@/stores/useAssistantPanelStore"

interface TerminalInstanceProps {
    terminalId: string
    className?: string
    onFocus?: () => void
    shouldAutoFocus?: boolean
}

export function TerminalInstance({ terminalId, className, onFocus, shouldAutoFocus = true }: TerminalInstanceProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const xtermRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const searchAddonRef = useRef<SearchAddon | null>(null)
    const hasInitializedRef = useRef(false)
    const hasInputErrorRef = useRef(false)
    const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const renderedOutputCountRef = useRef(0)
    const [initRetry, setInitRetry] = useState(0)
    const [selectedText, setSelectedText] = useState("")
    const outputChunks = useTerminalStore((state) => state.outputBuffers[terminalId] ?? [])
    const { updateTerminalStatus, setTerminalHasOutput, appendTerminalOutput } = useTerminalActions()
    const openWithPrompt = useAssistantPanelStore((state) => state.openWithPrompt)

    const getTrimmedSelection = useCallback(() => {
        const term = xtermRef.current
        if (!term) return ""
        return term.getSelection().trim()
    }, [])

    // Handle right-click context menu
    const handleContextMenu = useCallback(async (e: React.MouseEvent) => {
        const trimmedSelection = getTrimmedSelection()
        if (!trimmedSelection) {
            // No selection - let default context menu handle it
            return
        }

        e.preventDefault()

        const result = await window.electronAPI.contextMenu.showTerminalSelection({
            selectedText: trimmedSelection,
            x: e.clientX,
            y: e.clientY,
        })

        if (result.action === 'askAI') {
            openWithPrompt(`Help me understand this terminal output:\n\n\`\`\`\n${trimmedSelection}\n\`\`\``)
        } else if (result.action === 'explainError') {
            openWithPrompt(`Explain this error and suggest how to fix it:\n\n\`\`\`\n${trimmedSelection}\n\`\`\``)
        }
        // Other actions (copy, search) are handled in main process
    }, [getTrimmedSelection, openWithPrompt])

    const handleAskAIFromSelection = useCallback(() => {
        const trimmedSelection = getTrimmedSelection() || selectedText.trim()
        if (!trimmedSelection) return

        openWithPrompt(`Help me understand this terminal output:\n\n\`\`\`\n${trimmedSelection}\n\`\`\``)
        xtermRef.current?.clearSelection()
        setSelectedText("")
    }, [getTrimmedSelection, openWithPrompt, selectedText])

    // Initialize xterm and connect to IPC
    useEffect(() => {
        const container = containerRef.current
        if (!container || xtermRef.current) return

        // Verify container has dimensions before opening terminal
        const rect = container.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) {
            // Container not ready yet - retry after a short delay
            const timeoutId = setTimeout(() => {
                setInitRetry(prev => prev + 1)
            }, 50)
            return () => clearTimeout(timeoutId)
        }

        // Calculate initial dimensions based on container size
        const fontSize = 12
        const charWidth = fontSize * 0.6
        const charHeight = fontSize * 1.0
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
            const themeRoot = container.closest('.dark, .navy, .wine, .sunny, .forest') || document.documentElement
            const computed = getComputedStyle(themeRoot).getPropertyValue(cssVar).trim()

            if (!computed) {
                return fallback
            }

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

        // Map theme colors
        const background = getThemeColor('--sidebar', '#1a1a1a')
        const foreground = getThemeColor('--sidebar-foreground', '#fafafa')
        const muted = getThemeColor('--muted', '#27272a')

        const term = new Terminal({
            cols,
            rows,
            theme: {
                background,
                foreground,
                cursor: foreground,
                cursorAccent: background,
                selectionBackground: muted,
                // ANSI colors
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
            },
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontWeight: '400',
            fontWeightBold: '700',
            letterSpacing: 0,
            lineHeight: 1,
            cursorBlink: true,
            cursorStyle: 'block',
            scrollback: 10000,
            allowProposedApi: true,
            drawBoldTextInBrightColors: true,
            minimumContrastRatio: 1,
        })

        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.loadAddon(new WebLinksAddon())

        const searchAddon = new SearchAddon()
        term.loadAddon(searchAddon)
        searchAddonRef.current = searchAddon

        term.open(container)
        xtermRef.current = term
        fitAddonRef.current = fitAddon

        // CRITICAL: Forward keyboard input to the PTY process
        term.onData((data) => {
            void window.electronAPI.terminal.input({ terminalId, data }).catch((error) => {
                if (hasInputErrorRef.current) return
                hasInputErrorRef.current = true
                console.error('[Terminal] Failed to forward input to PTY:', error)
                updateTerminalStatus(terminalId, 'error')
            })
        })

        const unsubSelectionChange = term.onSelectionChange(() => {
            setSelectedText(term.getSelection())
        })

        // Handle focus - use textarea element since xterm doesn't have onFocus
        const textarea = container.querySelector('textarea')
        const handleFocusEvent = () => onFocus?.()
        const textareaElement = textarea // Capture for cleanup
        if (textareaElement) {
            textareaElement.addEventListener('focus', handleFocusEvent)
        }

        // Fit after opening and notify PTY of dimensions
        setTimeout(() => {
            try {
                fitAddon.fit()
                const { cols, rows } = term
                window.electronAPI.terminal.resize({ terminalId, cols, rows })
                if (shouldAutoFocus) {
                    term.focus()
                }
            } catch (e) {
                console.error('[Terminal] Fit failed:', e)
            }
        }, 50)

        // Listen for output from the PTY
        const unsubOutput = window.electronAPI.terminal.onOutput((event) => {
            if (event.terminalId === terminalId) {
                appendTerminalOutput(terminalId, event.data)
                setTerminalHasOutput(terminalId, true)
            }
        })

        // Listen for terminal exit
        const unsubExit = window.electronAPI.terminal.onExit((event) => {
            if (event.terminalId === terminalId) {
                updateTerminalStatus(terminalId, 'exited', event.exitCode)
                appendTerminalOutput(terminalId, `\r\n\x1b[90m[Process exited with code ${event.exitCode ?? 'unknown'}]\x1b[0m\r\n`)
            }
        })

        // Mark as running (only once)
        if (!hasInitializedRef.current) {
            hasInitializedRef.current = true
            updateTerminalStatus(terminalId, 'running')
        }

        return () => {
            unsubOutput()
            unsubExit()
            unsubSelectionChange.dispose()
            if (textareaElement) {
                textareaElement.removeEventListener('focus', handleFocusEvent)
            }
            term.dispose()
            xtermRef.current = null
            fitAddonRef.current = null
            searchAddonRef.current = null
            hasInitializedRef.current = false
            hasInputErrorRef.current = false
            renderedOutputCountRef.current = 0
            setSelectedText("")
        }
    }, [appendTerminalOutput, terminalId, initRetry, onFocus, shouldAutoFocus, updateTerminalStatus, setTerminalHasOutput])

    useEffect(() => {
        if (!shouldAutoFocus) return
        xtermRef.current?.focus()
    }, [shouldAutoFocus])

    useEffect(() => {
        const term = xtermRef.current
        if (!term) return

        const renderedCount = renderedOutputCountRef.current
        if (outputChunks.length < renderedCount) {
            term.clear()
            renderedOutputCountRef.current = 0
        }

        const nextStart = renderedOutputCountRef.current
        if (outputChunks.length > nextStart) {
            term.write(outputChunks.slice(nextStart).join(''))
            renderedOutputCountRef.current = outputChunks.length
        }

        if (outputChunks.length > 0) {
            setTerminalHasOutput(terminalId, true)
        }
    }, [outputChunks, setTerminalHasOutput, terminalId])

    // Handle resize when container size changes
    const handleResize = useCallback(() => {
        if (!fitAddonRef.current || !xtermRef.current) return

        try {
            fitAddonRef.current.fit()
            const { cols, rows } = xtermRef.current
            window.electronAPI.terminal.resize({ terminalId, cols, rows })
        } catch (e) {
            console.error('[Terminal] Resize failed:', e)
        }
    }, [terminalId])

    // Observe container size changes
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const resizeObserver = new ResizeObserver(() => {
            if (resizeTimeoutRef.current) {
                clearTimeout(resizeTimeoutRef.current)
            }
            resizeTimeoutRef.current = setTimeout(handleResize, 50)
        })

        resizeObserver.observe(container)
        return () => {
            resizeObserver.disconnect()
            if (resizeTimeoutRef.current) {
                clearTimeout(resizeTimeoutRef.current)
                resizeTimeoutRef.current = null
            }
        }
    }, [handleResize])

    // Focus terminal
    const focus = useCallback(() => {
        xtermRef.current?.focus()
    }, [])

    return (
        <div
            className={cn("relative w-full h-full bg-sidebar overflow-hidden", className)}
            onContextMenu={handleContextMenu}
        >
            {selectedText.trim().length > 0 && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={handleAskAIFromSelection}
                            className="absolute right-3 top-2 z-20 inline-flex h-6 items-center gap-1.5 rounded-full bg-secondary/95 px-2.5 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
                        >
                            <Sparkles className="h-3 w-3" />
                            Ask AI
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="left">Send selection to AI</TooltipContent>
                </Tooltip>
            )}
            <div
                ref={containerRef}
                className="w-full h-full pl-3 pt-1"
                onClick={focus}
                onMouseDown={focus}
            />
        </div>
    )
}

// Export functions for external control
export type TerminalInstanceRef = {
    focus: () => void
    clear: () => void
    findNext: (query: string) => void
    findPrevious: (query: string) => void
    clearSearch: () => void
}

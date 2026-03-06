import { useEffect, useRef, memo, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { cn } from '@/lib/utils'
import { TerminalIcon, CopyIcon, CheckIcon, Square, Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getThemeColorHex, syncTerminalTheme } from '@/lib/xtermTheme'

const buildBuilderTerminalTheme = (container: HTMLElement) => {
  const background = getThemeColorHex(container, '--tool-surface', '#1a1a1a')
  const foreground = getThemeColorHex(container, '--tool-surface-foreground', '#fafafa')
  const muted = getThemeColorHex(container, '--muted', '#27272a')

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: muted,
    black: muted,
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: foreground,
    brightBlack: '#52525b',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde047',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: foreground,
  }
}

export interface BuilderTerminalProps {
  terminalId: string
  command?: string
  projectPath: string
  isStreaming?: boolean
  onComplete?: (output: string, exitCode: number | null) => void
  onError?: (error: string) => void
  className?: string
}

/**
 * An interactive terminal component for the builder that uses PTY.
 * Commands run in a real terminal with proper ANSI support and user interaction.
 */
export const BuilderTerminal = memo(function BuilderTerminal({
  terminalId,
  command,
  projectPath: _projectPath,
  isStreaming = true,
  onComplete,
  onError: _onError,
  className,
}: BuilderTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const outputRef = useRef<string>('')
  const hasInitializedRef = useRef(false)
  const [isCopied, setIsCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isRunning, setIsRunning] = useState(isStreaming)

  // Initialize xterm and connect to PTY
  useEffect(() => {
    const container = containerRef.current
    if (!container || hasInitializedRef.current) return

    // Wait for container to have dimensions
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return
    }

    hasInitializedRef.current = true

    // Calculate dimensions
    const fontSize = 12
    const charWidth = fontSize * 0.6
    const charHeight = fontSize * 1.2
    const cols = Math.max(80, Math.floor((rect.width - 16) / charWidth))
    const rows = Math.max(10, Math.floor((rect.height - 8) / charHeight))

    // Match chat tool surface tokens so builder terminal visualizations stay in parity.
    const term = new Terminal({
      theme: buildBuilderTerminalTheme(container),
      cols,
      rows,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(container)
    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Fit terminal
    setTimeout(() => {
      try {
        fitAddon.fit()
      } catch {
        // Ignore fit errors
      }
    }, 10)

    // Forward keyboard input to the PTY
    term.onData((data) => {
      window.electronAPI.terminal.input({ terminalId, data })
    })

    // Listen for output from PTY
    const unsubOutput = window.electronAPI.terminal.onOutput((event) => {
      if (event.terminalId === terminalId) {
        term.write(event.data)
        outputRef.current += event.data
      }
    })

    // Listen for terminal exit
    const unsubExit = window.electronAPI.terminal.onExit((event) => {
      if (event.terminalId === terminalId) {
        setIsRunning(false)
        term.write(`\r\n\x1b[90m[Process exited with code ${event.exitCode ?? 'unknown'}]\x1b[0m\r\n`)
        onComplete?.(outputRef.current, event.exitCode ?? null)
      }
    })

    // Write command header if provided
    if (command) {
      term.writeln(`\x1b[90m$ ${command}\x1b[0m`)
      term.writeln('')
    }

    return () => {
      unsubOutput()
      unsubExit()
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      hasInitializedRef.current = false
    }
  }, [terminalId, command, onComplete])

  useEffect(() => {
    const container = containerRef.current
    const term = terminalRef.current
    if (!container || !term) return

    return syncTerminalTheme(term, () => buildBuilderTerminalTheme(container))
  }, [terminalId])

  // Handle resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver(() => {
      setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current) {
          try {
            fitAddonRef.current.fit()
            const { cols, rows } = terminalRef.current
            window.electronAPI.terminal.resize({ terminalId, cols, rows })
          } catch {
            // Ignore resize errors
          }
        }
      }, 10)
    })

    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [terminalId])

  const handleCopy = useCallback(async () => {
    const textToCopy = command ? `$ ${command}\n\n${outputRef.current}` : outputRef.current
    try {
      await navigator.clipboard.writeText(textToCopy)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      // Ignore copy errors
    }
  }, [command])

  const handleStop = useCallback(async () => {
    try {
      await window.electronAPI.terminal.kill({ terminalId })
      setIsRunning(false)
    } catch {
      // Ignore kill errors
    }
  }, [terminalId])

  return (
    <div
      className={cn(
        'w-full rounded-2xl bg-[var(--tool-surface)] text-[var(--tool-surface-foreground)] overflow-hidden transition-all',
        isExpanded ? 'h-96' : 'h-48',
        className
      )}
    >
      {/* Header */}
      <div className="flex min-h-8 items-center justify-between px-3 py-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TerminalIcon className="h-3.5 w-3.5" />
          <span>Terminal</span>
          {isRunning && (
            <span className="ml-1.5 flex items-center gap-1 text-[11px] text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Running
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isRunning && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:bg-muted hover:text-red-500"
              onClick={handleStop}
              title="Stop process"
            >
              <Square className="h-3 w-3" />
            </Button>
          )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <Minimize2 className="h-3 w-3" />
              ) : (
                <Maximize2 className="h-3 w-3" />
              )}
            </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={handleCopy}
            title="Copy output"
          >
            {isCopied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Terminal content */}
      <div
        className="relative h-[calc(100%-32px)] overflow-hidden"
        onClick={() => terminalRef.current?.focus()}
      >
        <div
          ref={containerRef}
          className="h-full overflow-hidden"
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-5"
          style={{ background: 'linear-gradient(to bottom, var(--tool-surface), transparent)' }}
        />
      </div>
    </div>
  )
})

/**
 * Hook to create and manage a builder terminal session
 */
export function useBuilderTerminal(projectPath: string) {
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createTerminal = useCallback(async (command?: string) => {
    if (isCreating) return null

    setIsCreating(true)
    setError(null)

    try {
      const result = await window.electronAPI.terminal.create({
        projectPath,
        cwd: projectPath,
        cols: 120,
        rows: 30,
      })

      if (result.terminalId) {
        const newTerminalId = result.terminalId
        setTerminalId(newTerminalId)

        // If a command is provided, send it to the terminal
        if (command) {
          // Small delay to ensure terminal is ready
          setTimeout(() => {
            window.electronAPI.terminal.input({
              terminalId: newTerminalId,
              data: command + '\r',
            })
          }, 100)
        }

        return newTerminalId
      } else {
        throw new Error('Failed to create terminal')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create terminal'
      setError(message)
      return null
    } finally {
      setIsCreating(false)
    }
  }, [projectPath, isCreating])

  const killTerminal = useCallback(async () => {
    if (!terminalId) return

    try {
      await window.electronAPI.terminal.kill({ terminalId })
      setTerminalId(null)
    } catch {
      // Ignore kill errors
    }
  }, [terminalId])

  return {
    terminalId,
    isCreating,
    error,
    createTerminal,
    killTerminal,
  }
}

import { useEffect, useRef, memo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { cn } from '@/lib/utils'
import { CopyIcon, CheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState, useCallback } from 'react'
import { getThemeColorHex, syncTerminalTheme } from '@/lib/xtermTheme'

const buildTerminalOutputTheme = (container: HTMLElement) => {
  const background = getThemeColorHex(container, '--tool-surface', '#1a1a1a')
  const foreground = getThemeColorHex(container, '--tool-surface-foreground', '#fafafa')
  const muted = getThemeColorHex(container, '--muted', '#27272a')

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: muted,
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

interface BuilderTerminalOutputProps {
  command?: string
  output: string
  className?: string
}

/**
 * A read-only terminal display component using xterm for proper ANSI rendering.
 * Used for displaying command output in the builder chat.
 */
export const BuilderTerminalOutput = memo(function BuilderTerminalOutput({
  command,
  output,
  className,
}: BuilderTerminalOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastOutputRef = useRef<string>('')
  const [isCopied, setIsCopied] = useState(false)

  // Initialize xterm
  useEffect(() => {
    const container = containerRef.current
    if (!container || terminalRef.current) return

    // Wait for container to have dimensions
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return
    }

    const term = new Terminal({
      theme: buildTerminalOutputTheme(container),
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      lineHeight: 1.2,
      cursorBlink: false,
      cursorStyle: 'block',
      disableStdin: true, // Read-only
      scrollback: 1000,
      convertEol: true,
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(container)
    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Fit terminal to container
    setTimeout(() => {
      try {
        fitAddon.fit()
      } catch {
        // Ignore fit errors
      }
    }, 10)

    // Write initial content
    if (command) {
      term.writeln(`\x1b[90m$ ${command}\x1b[0m`)
      term.writeln('')
    }
    lastOutputRef.current = ''

    return () => {
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [command])

  useEffect(() => {
    const container = containerRef.current
    const term = terminalRef.current
    if (!container || !term) return

    return syncTerminalTheme(term, () => buildTerminalOutputTheme(container))
  }, [command])

  // Update output when it changes
  useEffect(() => {
    const term = terminalRef.current
    if (!term) return

    // Only write new content
    if (output !== lastOutputRef.current) {
      const newContent = output.slice(lastOutputRef.current.length)
      if (newContent) {
        term.write(newContent)
      }
      lastOutputRef.current = output
    }
  }, [output])

  // Handle resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver(() => {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit()
        } catch {
          // Ignore fit errors
        }
      }, 10)
    })

    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])

  const handleCopy = useCallback(async () => {
    const textToCopy = command ? `$ ${command}\n\n${output}` : output
    try {
      await navigator.clipboard.writeText(textToCopy)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      // Ignore copy errors
    }
  }, [command, output])

  return (
    <div
      className={cn(
        'group relative w-full overflow-hidden rounded-2xl bg-[var(--tool-surface)] text-[var(--tool-surface-foreground)]',
        className
      )}
    >
      <div className="flex min-h-8 items-center justify-between gap-2 px-3 py-1">
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {command ? `$ ${command}` : 'Terminal output'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          onClick={handleCopy}
          title="Copy output"
        >
          {isCopied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
        </Button>
      </div>
      <div className="relative h-48 w-full overflow-hidden px-3 py-2">
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden"
        />
        <div
          className="pointer-events-none absolute inset-x-3 top-2 h-5"
          style={{ background: 'linear-gradient(to bottom, var(--tool-surface), transparent)' }}
        />
      </div>
    </div>
  )
})

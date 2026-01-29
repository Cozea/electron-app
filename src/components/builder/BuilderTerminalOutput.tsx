import { useEffect, useRef, memo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { cn } from '@/lib/utils'
import { CopyIcon, CheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState, useCallback } from 'react'

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
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#fafafa',
        cursorAccent: '#09090b',
        selectionBackground: '#27272a',
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
      lineHeight: 1.2,
      cursorBlink: false,
      cursorStyle: 'underline',
      disableStdin: true, // Read-only
      scrollback: 1000,
      convertEol: true,
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
    if (output) {
      term.write(output)
      lastOutputRef.current = output
    }

    return () => {
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
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
    <div className={cn('bg-zinc-950 overflow-hidden relative group px-3 py-2', className)}>
      {/* Copy button - appears on hover */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onClick={handleCopy}
      >
        {isCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
      </Button>

      {/* Terminal content */}
      <div
        ref={containerRef}
        className="h-48 overflow-hidden"
      />
    </div>
  )
})

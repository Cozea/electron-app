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
      const themeRoot = container.closest('.dark, .navy, .wine, .sunny, .forest') || document.documentElement
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

    const background = getThemeColor('--sidebar', '#1a1a1a')
    const foreground = getThemeColor('--sidebar-foreground', '#fafafa')
    const muted = getThemeColor('--muted', '#27272a')

    const term = new Terminal({
      theme: {
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
      },
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
    <div className={cn('bg-sidebar text-foreground border border-border/50 overflow-hidden relative group px-3 py-2 rounded-md', className)}>
      {/* Copy button - appears on hover */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:bg-muted hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity z-10"
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

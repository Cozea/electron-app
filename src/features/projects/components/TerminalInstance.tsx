import { useCallback, useEffect, useRef, useState } from 'react'
import type { GpuAccelerationDiagnostics } from '@shared/electronApiTypes'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { extractTerminalLinks, isTerminalLinkActivation, resolvePathLinkTarget } from '@/lib/terminalLinks'

import { SearchAddon } from '@xterm/addon-search'
import { cn } from '@/lib/utils'

import { useTerminalActions, useTerminalStore } from '@/stores/useTerminalStore'
import {
  buildAnsiPalette,
  compositeColorToHex,
  getThemeColorHex,
  loadXtermWebglAddon,
  relativeLuminance,
  resolveThemeColor,
  syncTerminalTheme,
  XTERM_FONT_FAMILY,
  XTERM_LINE_HEIGHT,
} from '@/lib/xtermTheme'

interface TerminalInstanceProps {
  terminalId: string
  className?: string
  onFocus?: () => void
  shouldAutoFocus?: boolean
  readOnly?: boolean
  gpuActive?: boolean
}

function canUseGpuTerminalRenderer(diagnostics: GpuAccelerationDiagnostics | null): boolean {
  if (!diagnostics) {
    return true
  }

  if (!diagnostics.hardwareAccelerationEnabled) {
    return false
  }

  const gpuCompositingReady =
    !diagnostics.gpuCompositing || diagnostics.gpuCompositing.startsWith('enabled')
  const webglReady = !diagnostics.webgl || diagnostics.webgl.startsWith('enabled')

  return gpuCompositingReady && webglReady
}



function getTerminalSelectionRect(mountElement: HTMLElement): DOMRect | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)
  const commonAncestor = range.commonAncestorContainer
  const selectionRoot =
    commonAncestor instanceof Element ? commonAncestor : commonAncestor.parentElement
  if (!(selectionRoot instanceof Element) || !mountElement.contains(selectionRoot)) {
    return null
  }

  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  )
  if (rects.length > 0) {
    return rects[rects.length - 1] ?? null
  }

  const boundingRect = range.getBoundingClientRect()
  return boundingRect.width > 0 || boundingRect.height > 0 ? boundingRect : null
}

const buildProjectTerminalTheme = (container: HTMLElement) => {
  const secondaryFallback = getThemeColorHex(container, '--secondary', '#1a1a1a')
  const panelBackground = resolveThemeColor(container, '--terminal-panel-bg', secondaryFallback)
  const appBackground = resolveThemeColor(container, '--background', '#ffffff')
  const background = compositeColorToHex(panelBackground, appBackground)
  const foreground = getThemeColorHex(container, '--foreground', '#fafafa')
  const muted = getThemeColorHex(container, '--muted', '#27272a')
  const useDarkPalette = relativeLuminance(background) < 0.45

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: muted,
    ...buildAnsiPalette(useDarkPalette),
  }
}

export function TerminalInstance({
  terminalId,
  className,
  onFocus,
  shouldAutoFocus = true,
  readOnly = false,
  gpuActive = true,
}: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const webglAddonRef = useRef<ReturnType<typeof loadXtermWebglAddon>>(null)
  const webglLoadFailedRef = useRef(false)
  const webglRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncWebglRendererRef = useRef<() => void>(() => {})
  const wantsGpuRendererRef = useRef(gpuActive)
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renderedOutputCountRef = useRef(0)
  const hasInputErrorRef = useRef(false)
  const [initRetry, setInitRetry] = useState(0)
  const [gpuDiagnostics, setGpuDiagnostics] = useState<GpuAccelerationDiagnostics | null>(null)
  const eventClientPosRef = useRef({ x: 0, y: 0 })
  

  // Bypass React renders for output streaming
  const { appendTerminalOutput, updateTerminalStatus } = useTerminalActions()
  const shouldUseGpuRenderer = gpuActive && canUseGpuTerminalRenderer(gpuDiagnostics)

  const disposeWebglRenderer = useCallback(() => {
    if (webglRetryTimeoutRef.current) {
      clearTimeout(webglRetryTimeoutRef.current)
      webglRetryTimeoutRef.current = null
    }

    const addon = webglAddonRef.current
    if (!addon) return
    webglAddonRef.current = null
    addon.dispose()
  }, [])

  
  const handleSelectionAction = useCallback(async () => {
    const term = xtermRef.current
    const container = containerRef.current
    if (!term || !container) return

    const selectionText = term.getSelection()
    const selectionPosition = term.getSelectionPosition()
    const normalizedText = selectionText.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')

    if (!selectionPosition || normalizedText.length === 0) {
      return
    }

    const lineStart = selectionPosition.start.y + 1
    const lineCount = normalizedText.split('\n').length
    const lineEnd = Math.max(lineStart, lineStart + lineCount - 1)

    const selectionRect = getTerminalSelectionRect(container)
    let x = eventClientPosRef.current.x
    let y = eventClientPosRef.current.y
    if (selectionRect) {
      x = Math.round(selectionRect.right)
      y = Math.round(selectionRect.bottom + 4)
    }

    const result = await window.electronAPI.contextMenu.showTerminalSelection({
      selectedText: normalizedText,
      x,
      y,
    })

    if (result.action === 'askAI') {
      // TODO: rich context
      console.log('Sending to AI:', { terminalId, lineStart, lineEnd, text: normalizedText })
      term.clearSelection()
      term.focus()
    } else if (result.action === 'explainError') {
      console.log('prompt ignored')
      term.clearSelection()
      term.focus()
    }
  }, [terminalId])

  useEffect(() => {
    wantsGpuRendererRef.current = shouldUseGpuRenderer
  }, [shouldUseGpuRenderer])

  useEffect(() => {
    let cancelled = false

    void window.electronAPI.app
      .getGpuDiagnostics()
      .then((nextDiagnostics) => {
        if (cancelled) return
        setGpuDiagnostics(nextDiagnostics)
      })
      .catch(() => {
        if (cancelled) return
        setGpuDiagnostics(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const syncWebglRenderer = useCallback(() => {
    if (!wantsGpuRendererRef.current) {
      disposeWebglRenderer()
      return
    }

    const terminal = xtermRef.current
    if (!terminal || webglAddonRef.current || webglLoadFailedRef.current) {
      return
    }

    const addon = loadXtermWebglAddon(terminal)
    if (!addon) {
      webglLoadFailedRef.current = true
      return
    }

    webglAddonRef.current = addon
    addon.onContextLoss(() => {
      if (webglAddonRef.current === addon) {
        webglAddonRef.current = null
      }
      addon.dispose()

      if (!wantsGpuRendererRef.current) {
        return
      }

      webglLoadFailedRef.current = false
      if (webglRetryTimeoutRef.current) {
        clearTimeout(webglRetryTimeoutRef.current)
      }
      webglRetryTimeoutRef.current = setTimeout(() => {
        webglRetryTimeoutRef.current = null
        syncWebglRendererRef.current()
      }, 250)
    })
  }, [disposeWebglRenderer])

  useEffect(() => {
    syncWebglRendererRef.current = syncWebglRenderer
  }, [syncWebglRenderer])



  

    
  useEffect(() => {
    const container = containerRef.current
    if (!container || xtermRef.current) return

    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      const timeoutId = setTimeout(() => {
        setInitRetry((current) => current + 1)
      }, 50)
      return () => clearTimeout(timeoutId)
    }

    const fontSize = 12
    const charWidth = fontSize * 0.6
    const charHeight = fontSize * XTERM_LINE_HEIGHT
    const cols = Math.max(80, Math.floor((rect.width - 16) / charWidth))
    const rows = Math.max(10, Math.floor((rect.height - 8) / charHeight))

    const term = new Terminal({
      cols,
      rows,
      theme: buildProjectTerminalTheme(container),
      fontSize,
      fontFamily: XTERM_FONT_FAMILY,
      fontWeight: '400',
      fontWeightBold: '700',
      letterSpacing: 0,
      lineHeight: XTERM_LINE_HEIGHT,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 4.5,
      disableStdin: readOnly,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    const projectPath = useTerminalStore.getState().terminals[terminalId]?.projectPath || ''
    
    const terminalLinksDisposable = term.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const activeTerminal = xtermRef.current
        if (!activeTerminal) {
          callback(undefined)
          return
        }

        const line = activeTerminal.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) {
          callback(undefined)
          return
        }

        const lineText = line.translateToString(true)
        const matches = extractTerminalLinks(lineText)
        if (matches.length === 0) {
          callback(undefined)
          return
        }

        callback(
          matches.map((match) => ({
            text: match.text,
            range: {
              start: { x: match.start + 1, y: bufferLineNumber },
              end: { x: match.end, y: bufferLineNumber },
            },
            activate: (event: MouseEvent, _text: string) => {
              if (!isTerminalLinkActivation(event)) return

              if (match.kind === 'url') {
                void window.electronAPI.shell.openExternal(match.text)
                return
              }

              const target = resolvePathLinkTarget(match.text, projectPath)
              const [filePath, lineStr] = target.split(':')
              const line = lineStr ? parseInt(lineStr, 10) : undefined

              void window.electronAPI.editor.listAvailableEditors().then((editors) => {
                 const editor = editors[0]
                 if (editor) {
                    void window.electronAPI.editor.openInEditor({
                       editorId: editor.id,
                       filePath,
                       line
                    })
                 } else {
                    void window.electronAPI.shell.openExternal(`file://${filePath}`)
                 }
              })
            },
          })),
        )
      },
    })

    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)

    
    term.attachCustomKeyEventHandler((event) => {
      // Cmd+K / Ctrl+K to clear terminal natively
      if (event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        if (event.type === 'keydown') {
          void window.electronAPI.terminal.input({ terminalId, data: '\u000c' })
        }
        return false
      }

      // Forward Alt/Option+Left/Right as proper escape sequences for word jumping
      if (event.type === 'keydown' && event.altKey && !event.metaKey && !event.ctrlKey) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          void window.electronAPI.terminal.input({ terminalId, data: '\x1bb' })
          return false
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          void window.electronAPI.terminal.input({ terminalId, data: '\x1bf' })
          return false
        }
      }

      // Forward Cmd+Left/Right as proper escape sequences for line start/end
      if (event.type === 'keydown' && event.metaKey && !event.altKey && !event.ctrlKey) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          void window.electronAPI.terminal.input({ terminalId, data: '\x1bOH' })
          return false
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          void window.electronAPI.terminal.input({ terminalId, data: '\x1bOF' })
          return false
        }
      }

      return true
    })
    term.open(container)
    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Initialize with existing history from Zustand without subscribing to changes
    const existingHistory = useTerminalStore.getState().outputBuffers[terminalId] ?? []
    if (existingHistory.length > 0) {
      term.write(existingHistory.join(''))
    }

    // Stream new data directly from backend, bypassing React renders
    const unsubscribeOutput = window.electronAPI.terminal.onOutputForTerminal(terminalId, ({ data }) => {
      term.write(data)
    })

    const inputDisposable = term.onData((data) => {
      if (readOnly) return

      void window.electronAPI.terminal
        .input({ terminalId, data })
        .then((accepted) => {
          if (accepted || hasInputErrorRef.current) return

          hasInputErrorRef.current = true
          appendTerminalOutput(terminalId, '\r\n\x1b[90m[Session is no longer active]\x1b[0m\r\n')
          updateTerminalStatus(terminalId, 'exited')
        })
        .catch((error) => {
          if (hasInputErrorRef.current) return
          hasInputErrorRef.current = true
          console.error('[Terminal] Failed to forward input to PTY:', error)
          updateTerminalStatus(terminalId, 'error')
        })
    })

    
    const textareaElement = container.querySelector('textarea')
    const handleFocusEvent = () => onFocus?.()
    textareaElement?.addEventListener('focus', handleFocusEvent)

    const fitTimeout = setTimeout(() => {
      try {
        const wasAtBottom = term.buffer.active.viewportY >= term.buffer.active.baseY
        fitAddon.fit()
        if (wasAtBottom) {
          term.scrollToBottom()
        }
        const { cols: nextCols, rows: nextRows } = term
        void window.electronAPI.terminal.resize({ terminalId, cols: nextCols, rows: nextRows })
        if (shouldAutoFocus && !readOnly) {
          term.focus()
        }
      } catch (error) {
        console.error('[Terminal] Fit failed:', error)
      }
    }, 50)

    return () => {
      clearTimeout(fitTimeout)
      unsubscribeOutput()
      inputDisposable.dispose()
      terminalLinksDisposable.dispose()
      textareaElement?.removeEventListener('focus', handleFocusEvent)
      term.dispose()
      disposeWebglRenderer()
      xtermRef.current = null
      fitAddonRef.current = null
      hasInputErrorRef.current = false
      renderedOutputCountRef.current = 0
      
    }
  }, [appendTerminalOutput, disposeWebglRenderer, initRetry, onFocus, readOnly, shouldAutoFocus, terminalId, updateTerminalStatus])

  useEffect(() => {
    const term = xtermRef.current
    if (!term) return
    term.options.disableStdin = readOnly
  }, [readOnly])

  useEffect(() => {
    const container = containerRef.current
    const term = xtermRef.current
    if (!container || !term) return

    return syncTerminalTheme(term, () => buildProjectTerminalTheme(container))
  }, [terminalId, initRetry])

  useEffect(() => {
    if (!shouldAutoFocus || readOnly) return
    xtermRef.current?.focus()
  }, [readOnly, shouldAutoFocus])

  useEffect(() => {
    if (!xtermRef.current) return

    if (!shouldUseGpuRenderer) {
      disposeWebglRenderer()
      return
    }

    const enableGpuTimeout = window.setTimeout(() => {
      syncWebglRendererRef.current()
    }, 96)

    return () => {
      window.clearTimeout(enableGpuTimeout)
    }
  }, [disposeWebglRenderer, shouldUseGpuRenderer])



  const handleResize = useCallback(() => {
    if (!fitAddonRef.current || !xtermRef.current) return

    try {
      const term = xtermRef.current
      const wasAtBottom = term.buffer.active.viewportY >= term.buffer.active.baseY
      fitAddonRef.current.fit()
      if (wasAtBottom) {
        term.scrollToBottom()
      }
      const { cols, rows } = term
      void window.electronAPI.terminal.resize({ terminalId, cols, rows })
    } catch (error) {
      console.error('[Terminal] Resize failed:', error)
    }
  }, [terminalId])

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

  const focus = useCallback(() => {
    xtermRef.current?.focus()
  }, [])

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden rounded-[4px]',
        className,
      )}
      style={{ backgroundColor: 'var(--terminal-panel-bg, var(--content-surface))' }}
      onMouseUp={(e) => {
        eventClientPosRef.current = { x: e.clientX, y: e.clientY }
        void handleSelectionAction()
      }}
      onContextMenu={(e) => {
        eventClientPosRef.current = { x: e.clientX, y: e.clientY }
        void handleSelectionAction()
      }}
    >
      <div
        ref={containerRef}
        className="h-full min-h-0 w-full"
        onClick={focus}
        onMouseDown={focus}
      />
    </div>
  )
}

export type TerminalInstanceRef = {
  focus: () => void
  clear: () => void
  findNext: (query: string) => void
  findPrevious: (query: string) => void
  clearSearch: () => void
}

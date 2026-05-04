import { useCallback, useEffect, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'
import type {
  GpuAccelerationDiagnostics,
  TerminalInfo,
  TerminalOutputEvent,
  TerminalSnapshot,
} from '@shared/electronApiTypes'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { extractTerminalLinks, isTerminalLinkActivation, resolvePathLinkTarget } from '@/lib/terminalLinks'

import { cn } from '@/lib/utils'

import { useTerminalActions } from '@/stores/useTerminalStore'
import { useTheme } from '@/contexts/ThemeContext'
import {
  buildAnsiPalette,
  compositeColorToHex,
  getThemeColorHex,
  loadXtermWebglAddon,
  relativeLuminance,
  resolveThemeColor,
  XTERM_CUSTOM_GLYPHS,
  XTERM_FONT_FAMILY,
  XTERM_LINE_HEIGHT,
  XTERM_RESCALE_OVERLAPPING_GLYPHS,
  XTERM_UNICODE_VERSION,
} from '@/lib/xtermTheme'

export interface TerminalAttachSize {
  cols: number
  rows: number
}

export interface TerminalAttachResolution {
  terminalId: string
  snapshot?: TerminalSnapshot | null
  info?: TerminalInfo | null
}

interface TerminalInstanceProps {
  terminalId?: string | null
  resolveTerminal?: (size: TerminalAttachSize) => Promise<TerminalAttachResolution>
  onTerminalResolved?: (resolution: TerminalAttachResolution) => void
  onTerminalError?: (message: string) => void
  workspaceId?: string | null
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
  resolveTerminal,
  onTerminalResolved,
  onTerminalError,
  workspaceId,
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
  const lastMeasuredContainerSizeRef = useRef<{ width: number; height: number } | null>(null)
  const hasInputErrorRef = useRef(false)
  const activeTerminalIdRef = useRef<string | null>(terminalId ?? null)
  const onFocusRef = useRef(onFocus)
  const readOnlyRef = useRef(readOnly)
  const shouldAutoFocusRef = useRef(shouldAutoFocus)
  const onTerminalResolvedRef = useRef(onTerminalResolved)
  const onTerminalErrorRef = useRef(onTerminalError)
  const workspaceIdRef = useRef(workspaceId ?? '')
  const resolveTerminalRef = useRef(resolveTerminal)
  const [initRetry, setInitRetry] = useState(0)
  const [gpuDiagnostics, setGpuDiagnostics] = useState<GpuAccelerationDiagnostics | null>(null)
  const eventClientPosRef = useRef({ x: 0, y: 0 })
  const { theme } = useTheme()

  onFocusRef.current = onFocus
  readOnlyRef.current = readOnly
  shouldAutoFocusRef.current = shouldAutoFocus
  onTerminalResolvedRef.current = onTerminalResolved
  onTerminalErrorRef.current = onTerminalError
  workspaceIdRef.current = workspaceId ?? ''
  resolveTerminalRef.current = resolveTerminal

  // Keep the terminal output path imperative; React state only tracks metadata.
  const { updateTerminalStatus } = useTerminalActions()
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
      console.log('Sending to AI:', {
        terminalId: activeTerminalIdRef.current,
        lineStart,
        lineEnd,
        text: normalizedText,
      })
      term.clearSelection()
      term.focus()
    } else if (result.action === 'explainError') {
      console.log('prompt ignored')
      term.clearSelection()
      term.focus()
    }
  }, [])

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

    requestAnimationFrame(() => {
      const fitAddon = fitAddonRef.current
      const activeTerminal = xtermRef.current
      if (!fitAddon || !activeTerminal || activeTerminal !== terminal) {
        return
      }

      try {
        const wasAtBottom =
          activeTerminal.buffer.active.viewportY >= activeTerminal.buffer.active.baseY
        fitAddon.fit()
        if (wasAtBottom) {
          activeTerminal.scrollToBottom()
        }
        const activeTerminalId = activeTerminalIdRef.current
        if (activeTerminalId) {
          void window.electronAPI.terminal.resize({
            terminalId: activeTerminalId,
            cols: activeTerminal.cols,
            rows: activeTerminal.rows,
          })
        }
      } catch (error) {
        console.error('[Terminal] WebGL post-load fit failed:', error)
      }
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

    const fontSize = 13
    lastMeasuredContainerSizeRef.current = {
      width: rect.width,
      height: rect.height,
    }

    const term = new Terminal({
      theme: buildProjectTerminalTheme(container),
      fontSize,
      fontFamily: XTERM_FONT_FAMILY,
      fontWeight: '400',
      fontWeightBold: '700',
      letterSpacing: 0,
      lineHeight: XTERM_LINE_HEIGHT,
      customGlyphs: XTERM_CUSTOM_GLYPHS,
      rescaleOverlappingGlyphs: XTERM_RESCALE_OVERLAPPING_GLYPHS,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      scrollSensitivity: 1,
      fastScrollSensitivity: 5,
      smoothScrollDuration: 0,
      scrollOnEraseInDisplay: true,
      windowOptions: {
        getWinSizePixels: true,
        getCellSizePixels: true,
        getWinSizeChars: true,
      },
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
      disableStdin: readOnlyRef.current,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    const unicode11Addon = new Unicode11Addon()
    term.loadAddon(unicode11Addon)
    if (term.unicode.activeVersion !== XTERM_UNICODE_VERSION) {
      term.unicode.activeVersion = XTERM_UNICODE_VERSION
    }
    
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

              const target = resolvePathLinkTarget(match.text, workspaceIdRef.current)
              const [filePath, lineStr] = target.split(':')
              const line = lineStr ? parseInt(lineStr, 10) : undefined

              void window.electronAPI.editor.listAvailableEditors().then((editors) => {
                 const editor = editors[0]
                 if (editor) {
                    void window.electronAPI.editor.openInEditor({
                       editorId: editor.id,
                       workspaceId: workspaceIdRef.current,
                       path: filePath,
                       line
                    })
                 } else {
                    void window.electronAPI.shell.openExternal(`file://${target}`)
                 }
              })
            },
          })),
        )
      },
    })

    const sendTerminalInput = (data: string) => {
      const activeTerminalId = activeTerminalIdRef.current
      if (!activeTerminalId) return
      void window.electronAPI.terminal.input({ terminalId: activeTerminalId, data })
    }
    
    term.attachCustomKeyEventHandler((event) => {
      // Cmd+K / Ctrl+K to clear terminal natively
      if (event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        if (event.type === 'keydown') {
          sendTerminalInput('\u000c')
        }
        return false
      }

      // Forward Alt/Option+Left/Right as proper escape sequences for word jumping
      if (event.type === 'keydown' && event.altKey && !event.metaKey && !event.ctrlKey) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          sendTerminalInput('\x1bb')
          return false
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          sendTerminalInput('\x1bf')
          return false
        }
      }

      // Forward Cmd+Left/Right as proper escape sequences for line start/end
      if (event.type === 'keydown' && event.metaKey && !event.altKey && !event.ctrlKey) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          sendTerminalInput('\x1bOH')
          return false
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          sendTerminalInput('\x1bOF')
          return false
        }
      }

      return true
    })
    term.open(container)
    fitAddon.fit()
    xtermRef.current = term
    fitAddonRef.current = fitAddon

    let disposed = false
    let hydrated = false
    let lastAppliedOutputSequence = 0
    let queuedOutputEvents: TerminalOutputEvent[] = []
    let exitMessageWritten = false
    let unsubscribeOutput: (() => void) | null = null
    let unsubscribeExit: (() => void) | null = null

    const writeExitMessage = (exitCode: number | null) => {
      if (exitMessageWritten) return
      exitMessageWritten = true
      term.write(`\r\n\x1b[90m[Process exited with code ${exitCode ?? 'unknown'}]\x1b[0m\r\n`)
    }

    const applyOutputEvent = (event: TerminalOutputEvent) => {
      if (event.sequence <= lastAppliedOutputSequence) {
        return
      }
      term.write(event.data)
      lastAppliedOutputSequence = event.sequence
    }

    const applySnapshot = (snapshot: TerminalSnapshot | null) => {
      term.reset()
      if (snapshot?.stdout) {
        term.write(snapshot.stdout)
      }
      lastAppliedOutputSequence = snapshot?.outputSequence ?? 0
      if (snapshot?.running === false) {
        writeExitMessage(snapshot.exitCode)
      }
    }

    const attachToTerminal = async () => {
      const attachSize = { cols: term.cols, rows: term.rows }
      const resolver = resolveTerminalRef.current
      const resolution =
        terminalId
          ? { terminalId }
          : resolver
            ? await resolver(attachSize)
            : null

      if (disposed) return
      if (!resolution?.terminalId) {
        throw new Error('Terminal could not be attached because no terminal id was provided.')
      }

      const nextTerminalId = resolution.terminalId
      activeTerminalIdRef.current = nextTerminalId
      onTerminalResolvedRef.current?.(resolution)

      unsubscribeOutput = window.electronAPI.terminal.onOutputForTerminal(nextTerminalId, (event) => {
        if (disposed) return
        if (!hydrated) {
          queuedOutputEvents.push(event)
          return
        }
        applyOutputEvent(event)
      })

      unsubscribeExit = window.electronAPI.terminal.onExit((event) => {
        if (disposed || event.terminalId !== activeTerminalIdRef.current) return
        writeExitMessage(event.exitCode)
        updateTerminalStatus(event.terminalId, 'exited', event.exitCode)
      })

      const attachResult = await window.electronAPI.terminal.attachView({
        terminalId: nextTerminalId,
        cols: attachSize.cols,
        rows: attachSize.rows,
      })

      if (disposed || activeTerminalIdRef.current !== nextTerminalId) return

      const snapshot = attachResult.snapshot ?? resolution.snapshot ?? null
      if (!attachResult.success && snapshot?.running !== false) {
        throw new Error('Terminal session is no longer available.')
      }

      applySnapshot(snapshot)

      for (const event of attachResult.replayEvents) {
        applyOutputEvent(event)
      }

      const pendingEvents = queuedOutputEvents
      queuedOutputEvents = []
      for (const event of pendingEvents) {
        applyOutputEvent(event)
      }

      hydrated = true
      term.scrollToBottom()

      if (shouldAutoFocusRef.current && !readOnlyRef.current) {
        term.focus()
      }
    }

    void attachToTerminal().catch((error) => {
      if (disposed) return
      const message = error instanceof Error ? error.message : 'Failed to attach terminal'
      console.error('[Terminal] Failed to attach terminal:', error)
      onTerminalErrorRef.current?.(message)
      term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`)
    })

    const inputDisposable = term.onData((data) => {
      if (readOnlyRef.current) return
      const activeTerminalId = activeTerminalIdRef.current
      if (!activeTerminalId) return

      void window.electronAPI.terminal
        .input({ terminalId: activeTerminalId, data })
        .then((accepted) => {
          if (accepted || hasInputErrorRef.current) return

          hasInputErrorRef.current = true
          term.write('\r\n\x1b[90m[Session is no longer active]\x1b[0m\r\n')
          updateTerminalStatus(activeTerminalId, 'exited')
        })
        .catch((error) => {
          if (hasInputErrorRef.current) return
          hasInputErrorRef.current = true
          console.error('[Terminal] Failed to forward input to PTY:', error)
          term.write('\r\n\x1b[31m[Failed to send input to terminal]\x1b[0m\r\n')
          updateTerminalStatus(activeTerminalId, 'error')
        })
    })

    
    const textareaElement = container.querySelector('textarea')
    const handleFocusEvent = () => onFocusRef.current?.()
    textareaElement?.addEventListener('focus', handleFocusEvent)

    return () => {
      disposed = true
      unsubscribeOutput?.()
      unsubscribeExit?.()
      const activeTerminalId = activeTerminalIdRef.current
      if (activeTerminalId) {
        void window.electronAPI.terminal.detachView({ terminalId: activeTerminalId }).catch(() => {})
      }
      inputDisposable.dispose()
      terminalLinksDisposable.dispose()
      textareaElement?.removeEventListener('focus', handleFocusEvent)
      term.dispose()
      disposeWebglRenderer()
      xtermRef.current = null
      fitAddonRef.current = null
      hasInputErrorRef.current = false
      activeTerminalIdRef.current = null
      
    }
    // Focus/read-only changes are handled through refs/effects; they must not recreate xterm.
  }, [disposeWebglRenderer, initRetry, terminalId, updateTerminalStatus])

  useEffect(() => {
    const term = xtermRef.current
    if (!term) return
    term.options.disableStdin = readOnly
  }, [readOnly])

  useEffect(() => {
    const container = containerRef.current
    const term = xtermRef.current
    if (!container || !term) return

    const nextTheme = buildProjectTerminalTheme(container)
    const nextThemeStr = JSON.stringify(nextTheme)
    const currentThemeStr = JSON.stringify(term.options.theme || {})

    if (currentThemeStr === nextThemeStr) {
      return
    }

    term.options.theme = nextTheme
    try {
      term.refresh(0, Math.max(term.rows - 1, 0))
    } catch {
      // Ignore refresh errors after disposal or while dimensions settle
    }
  }, [terminalId, initRetry, theme])

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
    if (!fitAddonRef.current || !xtermRef.current || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const lastMeasuredSize = lastMeasuredContainerSizeRef.current
    if (
      lastMeasuredSize &&
      Math.abs(lastMeasuredSize.width - rect.width) < 0.5 &&
      Math.abs(lastMeasuredSize.height - rect.height) < 0.5
    ) {
      return
    }

    window.requestAnimationFrame(() => {
      if (!fitAddonRef.current || !xtermRef.current) return

      try {
        const term = xtermRef.current
        const wasAtBottom = term.buffer.active.viewportY >= term.buffer.active.baseY
        fitAddonRef.current.fit()
        if (wasAtBottom) {
          term.scrollToBottom()
        }
        lastMeasuredContainerSizeRef.current = {
          width: rect.width,
          height: rect.height,
        }
        const { cols, rows } = term
        const activeTerminalId = activeTerminalIdRef.current
        if (activeTerminalId) {
          void window.electronAPI.terminal.resize({ terminalId: activeTerminalId, cols, rows })
        }
      } catch (error) {
        console.error('[Terminal] Resize failed:', error)
      }
    })
  }, [])

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

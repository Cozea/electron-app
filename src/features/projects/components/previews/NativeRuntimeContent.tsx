import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  buildAnsiPalette,
  compositeColorToHex,
  getThemeColorHex,
  relativeLuminance,
  resolveThemeColor,
  syncTerminalTheme,
} from '@/lib/xtermTheme'
import type { ProjectRuntimeStateSnapshot } from '@/stores/useProjectRuntimeStore'
import type { NativePreviewSession } from '@shared/electronApiTypes'
import type { TerminalPanelView } from '../TerminalTabBar'

interface NavigationItem {
  id: string
  label: string
}

interface NativeRuntimeContentProps {
  activeTab: TerminalPanelView
  session: NativePreviewSession
  runtimeState: ProjectRuntimeStateSnapshot
  inspectMode?: boolean
  onInspectModeChange?: (next: boolean) => void
  onOpenNavigation?: (route: string) => void
}

function formatTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return '—'
  }
  return new Date(timestamp).toLocaleTimeString()
}

function summarizePayload(payload: unknown): string {
  if (payload == null) {
    return ''
  }
  if (typeof payload === 'string') {
    return payload
  }
  if (typeof payload === 'number' || typeof payload === 'boolean') {
    return String(payload)
  }
  try {
    return JSON.stringify(payload)
  } catch {
    return '[unserializable payload]'
  }
}

function extractNavigationItems(items: unknown[]): NavigationItem[] {
  return items.flatMap((item): NavigationItem[] => {
    if (typeof item === 'string') {
      return [{ id: item, label: item }]
    }

    if (!item || typeof item !== 'object') {
      return []
    }

    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string'
      ? record.id
      : typeof record.pathname === 'string'
        ? record.pathname
        : typeof record.path === 'string'
          ? record.path
          : null
    if (!id) {
      return []
    }

    const label = typeof record.displayName === 'string'
      ? record.displayName
      : typeof record.name === 'string'
        ? record.name
        : typeof record.title === 'string'
          ? record.title
          : id

    return [{ id, label }]
  })
}

function formatFrame(frame: unknown): string {
  if (!frame || typeof frame !== 'object') {
    return 'No frame data yet.'
  }

  const record = frame as Record<string, unknown>
  const x = typeof record.x === 'number' ? `${(record.x * 100).toFixed(1)}%` : '?'
  const y = typeof record.y === 'number' ? `${(record.y * 100).toFixed(1)}%` : '?'
  const width = typeof record.width === 'number' ? `${(record.width * 100).toFixed(1)}%` : '?'
  const height = typeof record.height === 'number' ? `${(record.height * 100).toFixed(1)}%` : '?'
  return `x ${x} • y ${y} • w ${width} • h ${height}`
}

// ── ANSI color helpers ─────────────────────────────────────────────────
const ANSI_RESET = '\x1b[0m'
const ANSI_DIM = '\x1b[2m'
const ANSI_CYAN = '\x1b[36m'
const ANSI_YELLOW = '\x1b[33m'
const ANSI_RED = '\x1b[31m'

function levelColor(level: string): string {
  switch (level) {
    case 'warn': return ANSI_YELLOW
    case 'error': return ANSI_RED
    default: return ANSI_DIM
  }
}

function formatLogLine(event: { timestamp: number; source: string; level: string; message: string }): string {
  const ts = formatTimestamp(event.timestamp)
  return `${ANSI_DIM}${ts}${ANSI_RESET}  ${ANSI_CYAN}${event.source}${ANSI_RESET}  ${levelColor(event.level)}${event.level}${ANSI_RESET}  ${event.message}\r\n`
}

const buildLogsTerminalTheme = (container: HTMLElement) => {
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

// ── Read-only xterm for native logs ────────────────────────────────────
interface NativeLogsTerminalProps {
  logEvents: ProjectRuntimeStateSnapshot['logEvents']
}

const NativeLogsTerminal = memo(function NativeLogsTerminal({ logEvents }: NativeLogsTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const renderedCountRef = useRef(0)
  const [initRetry, setInitRetry] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container || xtermRef.current) return

    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      const timeoutId = setTimeout(() => setInitRetry((n) => n + 1), 50)
      return () => clearTimeout(timeoutId)
    }

    const fontSize = 12
    const charWidth = fontSize * 0.6
    const charHeight = fontSize * 1.0
    const cols = Math.max(80, Math.floor((rect.width - 16) / charWidth))
    const rows = Math.max(10, Math.floor((rect.height - 8) / charHeight))

    const term = new Terminal({
      cols,
      rows,
      theme: buildLogsTerminalTheme(container),
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontWeight: '400',
      fontWeightBold: '700',
      letterSpacing: 0,
      lineHeight: 1,
      cursorBlink: false,
      cursorStyle: 'block',
      cursorInactiveStyle: 'none',
      scrollback: 10000,
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 4.5,
      disableStdin: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)

    term.open(container)
    xtermRef.current = term
    fitAddonRef.current = fitAddon

    setTimeout(() => {
      try { fitAddon.fit() } catch { /* noop */ }
    }, 50)

    return () => {
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      renderedCountRef.current = 0
    }
  }, [initRetry])

  useEffect(() => {
    const container = containerRef.current
    const term = xtermRef.current
    if (!container || !term) return
    return syncTerminalTheme(term, () => buildLogsTerminalTheme(container))
  }, [initRetry])

  useEffect(() => {
    const term = xtermRef.current
    if (!term) return

    const prev = renderedCountRef.current
    if (logEvents.length < prev) {
      term.clear()
      renderedCountRef.current = 0
    }

    const start = renderedCountRef.current
    if (logEvents.length > start) {
      const newEvents = logEvents.slice(start)
      for (const event of newEvents) {
        term.write(formatLogLine(event))
      }
      renderedCountRef.current = logEvents.length
    }
  }, [logEvents])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let timeout: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => {
        try { fitAddonRef.current?.fit() } catch { /* noop */ }
      }, 50)
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      if (timeout) clearTimeout(timeout)
    }
  }, [])

  return (
    <div
      className="h-full w-full overflow-hidden"
      style={{ backgroundColor: 'var(--terminal-panel-bg, var(--content-surface))' }}
    >
      <div
        ref={containerRef}
        className="h-full w-full pl-3 pt-1"
        onClick={() => xtermRef.current?.focus()}
      />
    </div>
  )
})

// ── Main export ────────────────────────────────────────────────────────
export const NativeRuntimeContent = memo(function NativeRuntimeContent({
  activeTab,
  session,
  runtimeState,
  inspectMode = false,
  onInspectModeChange,
  onOpenNavigation,
}: NativeRuntimeContentProps) {
  const tools = session ? (runtimeState.toolsBySession[session.id] ?? []) : []
  const navigationItems = useMemo(
    () => extractNavigationItems(runtimeState.navigationRouteList),
    [runtimeState.navigationRouteList],
  )
  const inspectPayload = (runtimeState.lastInspectResult ?? null) as Record<string, unknown> | null
  const inspectStack = Array.isArray(inspectPayload?.stack)
    ? (inspectPayload?.stack as Array<Record<string, unknown>>)
    : []

  if (activeTab === 'native-events') {
    return (
      <div className="h-full overflow-hidden px-4 py-3">
        <div className="grid grid-cols-2 gap-2 pb-3 text-xs text-muted-foreground lg:grid-cols-4">
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <div className="font-medium text-foreground">Transport</div>
            <div>{'transport' in session ? String(session.transport) : 'mjpeg'}</div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <div className="font-medium text-foreground">Entry Mode</div>
            <div>{'entryMode' in session ? String(session.entryMode) : 'app'}</div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <div className="font-medium text-foreground">Runtime Plugins</div>
            <div>{runtimeState.runtimePlugins.length}</div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <div className="font-medium text-foreground">Known Tools</div>
            <div>{tools.length}</div>
          </div>
        </div>

        <ScrollArea className="h-[calc(100%-5rem)] rounded-md border border-border/60 bg-muted/20">
          <div className="space-y-2 p-3">
            {runtimeState.runtimeEvents.length === 0 ? (
              <div className="text-sm text-muted-foreground">No runtime events yet.</div>
            ) : (
              runtimeState.runtimeEvents.slice(0, 30).map((event) => (
                <div key={`${event.type}-${event.receivedAt}`} className="rounded-md border border-border/50 bg-background/70 p-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-foreground">{event.type}</div>
                    <div className="shrink-0 text-[11px] text-muted-foreground">
                      {formatTimestamp(event.receivedAt)}
                    </div>
                  </div>
                  {event.payload !== undefined ? (
                    <div className="mt-1 line-clamp-3 font-mono text-[11px] text-muted-foreground">
                      {summarizePayload(event.payload)}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    )
  }

  if (activeTab === 'native-logs') {
    return <NativeLogsTerminal logEvents={runtimeState.logEvents} />
  }

  if (activeTab === 'native-inspect') {
    return (
      <div className="h-full overflow-auto px-4 py-3">
        <div className="mb-3 flex items-center gap-3">
          <Button
            variant={inspectMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => onInspectModeChange?.(!inspectMode)}
            disabled={!session || !runtimeState.appReady}
          >
            {inspectMode ? 'Exit Inspect Mode' : 'Inspect In Device'}
          </Button>
          <div className="text-sm text-muted-foreground">
            {inspectMode
              ? 'Click inside the embedded device to inspect the selected element.'
              : 'Inspect mode requests Radon element data from the running app.'}
          </div>
        </div>

        <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Selected Frame</div>
            <div className="mt-1 text-sm text-foreground">{formatFrame(inspectPayload?.frame)}</div>
          </div>

          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Component Stack</div>
            <div className="mt-2 space-y-2">
              {inspectStack.length === 0 ? (
                <div className="text-sm text-muted-foreground">No inspected component stack yet.</div>
              ) : (
                inspectStack.map((entry, index) => {
                  const source = (entry.source ?? null) as Record<string, unknown> | null
                  const fileName = typeof source?.fileName === 'string' ? source.fileName : null
                  const line = typeof source?.line0Based === 'number' ? source.line0Based + 1 : null
                  return (
                    <div key={`${String(entry.componentName)}-${index}`} className="rounded-md border border-border/50 bg-background/70 p-2">
                      <div className="text-sm font-medium text-foreground">
                        {typeof entry.componentName === 'string' ? entry.componentName : `Component ${index + 1}`}
                      </div>
                      {fileName ? (
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {fileName}{line ? `:${line}` : ''}
                        </div>
                      ) : null}
                      {entry.frame ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {formatFrame(entry.frame)}
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (activeTab === 'native-navigation') {
    return (
      <div className="h-full overflow-auto px-4 py-3">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-border/60 bg-muted/20">
            <div className="border-b border-border/60 px-3 py-2 text-sm font-medium text-foreground">
              History
            </div>
            <ScrollArea className="h-56">
              <div className="space-y-1 p-2">
                {runtimeState.navigationHistory.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-muted-foreground">No navigation history yet.</div>
                ) : (
                  runtimeState.navigationHistory.map((entry) => (
                    <Button
                      key={`history-${entry.id}`}
                      variant="ghost"
                      className="h-auto w-full justify-start px-2 py-2 text-left"
                      onClick={() => onOpenNavigation?.(entry.id)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-foreground">{entry.displayName ?? entry.id}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{entry.id}</div>
                      </div>
                    </Button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="rounded-md border border-border/60 bg-muted/20">
            <div className="border-b border-border/60 px-3 py-2 text-sm font-medium text-foreground">
              Route List
            </div>
            <ScrollArea className="h-56">
              <div className="space-y-1 p-2">
                {navigationItems.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-muted-foreground">No runtime route list yet.</div>
                ) : (
                  navigationItems.map((item) => (
                    <Button
                      key={`route-${item.id}`}
                      variant="ghost"
                      className="h-auto w-full justify-start px-2 py-2 text-left"
                      onClick={() => onOpenNavigation?.(item.id)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-foreground">{item.label}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{item.id}</div>
                      </div>
                    </Button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    )
  }

  if (activeTab === 'native-tools') {
    return (
      <div className="h-full overflow-auto px-4 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {runtimeState.runtimePlugins.length === 0 ? (
            <span className="text-sm text-muted-foreground">No runtime plugins reported yet.</span>
          ) : (
            runtimeState.runtimePlugins.map((plugin) => (
              <Badge key={plugin} variant="outline">{plugin}</Badge>
            ))
          )}
        </div>

        <div className="grid gap-2 lg:grid-cols-2">
          {tools.length === 0 ? (
            <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
              No tool metadata for this session yet.
            </div>
          ) : (
            tools.map((tool) => (
              <div key={tool.id} className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-foreground">{tool.title}</div>
                  <Badge variant={tool.status === 'available' ? 'default' : tool.status === 'disabled' ? 'secondary' : 'outline'}>
                    {tool.status}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Runtime id: {tool.id}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  return null
})

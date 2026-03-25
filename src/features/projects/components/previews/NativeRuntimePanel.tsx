import { memo, useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ProjectRuntimeStateSnapshot } from '@/stores/useProjectRuntimeStore'
import type { NativePreviewSession } from '@shared/electronApiTypes'

interface NavigationItem {
  id: string
  label: string
}

interface NativeRuntimePanelProps {
  session: NativePreviewSession | null
  runtimeState: ProjectRuntimeStateSnapshot
  inspectMode: boolean
  onInspectModeChange: (next: boolean) => void
  onOpenNavigation: (route: string) => void
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

export const NativeRuntimePanel = memo(function NativeRuntimePanel({
  session,
  runtimeState,
  inspectMode,
  onInspectModeChange,
  onOpenNavigation,
}: NativeRuntimePanelProps) {
  const tools = session ? (runtimeState.toolsBySession[session.id] ?? []) : []
  const navigationItems = useMemo(
    () => extractNavigationItems(runtimeState.navigationRouteList),
    [runtimeState.navigationRouteList],
  )
  const inspectPayload = (runtimeState.lastInspectResult ?? null) as Record<string, unknown> | null
  const inspectStack = Array.isArray(inspectPayload?.stack)
    ? (inspectPayload?.stack as Array<Record<string, unknown>>)
    : []

  return (
    <div className="border-t border-border/60 bg-background/95">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium text-foreground">Native Runtime</span>
          <Badge variant={runtimeState.appReady ? 'default' : 'secondary'}>
            {runtimeState.appReady ? 'App Ready' : 'Waiting'}
          </Badge>
          {session?.state ? (
            <Badge variant="outline">{session.state}</Badge>
          ) : null}
          {session?.device?.name ? (
            <span className="truncate text-xs text-muted-foreground">{session.device.name}</span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          Last event {formatTimestamp(runtimeState.lastRuntimeEventAt)}
        </div>
      </div>

      <Tabs defaultValue="events" className="flex min-h-0 flex-col px-4 pb-3">
        <TabsList className="w-fit">
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
          <TabsTrigger value="navigation">Navigation</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="min-h-0">
          <div className="grid grid-cols-2 gap-2 pb-3 pt-1 text-xs text-muted-foreground lg:grid-cols-4">
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <div className="font-medium text-foreground">Transport</div>
              <div>{session?.transport ?? 'mjpeg'}</div>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <div className="font-medium text-foreground">Entry Mode</div>
              <div>{session?.entryMode ?? 'app'}</div>
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

          <ScrollArea className="h-56 rounded-md border border-border/60 bg-muted/20">
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
        </TabsContent>

        <TabsContent value="logs" className="min-h-0">
          <ScrollArea className="h-64 rounded-md border border-border/60 bg-black/90">
            <div className="space-y-1 p-3 font-mono text-[11px]">
              {runtimeState.logEvents.length === 0 ? (
                <div className="text-neutral-400">No Radon runtime logs yet.</div>
              ) : (
                runtimeState.logEvents.slice(0, 80).map((event) => (
                  <div key={`${event.timestamp}-${event.source}-${event.message}`} className="text-neutral-200">
                    <span className="mr-2 text-neutral-500">{formatTimestamp(event.timestamp)}</span>
                    <span className="mr-2 text-sky-300">{event.source}</span>
                    <span className="mr-2 text-neutral-500">{event.level}</span>
                    <span>{event.message}</span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="inspect" className="min-h-0">
          <div className="mb-3 flex items-center gap-3">
            <Button
              variant={inspectMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => onInspectModeChange(!inspectMode)}
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
        </TabsContent>

        <TabsContent value="navigation" className="min-h-0">
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
                        onClick={() => onOpenNavigation(entry.id)}
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
                        onClick={() => onOpenNavigation(item.id)}
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
        </TabsContent>

        <TabsContent value="tools" className="min-h-0">
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
        </TabsContent>
      </Tabs>
    </div>
  )
})

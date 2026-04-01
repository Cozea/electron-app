import { useEffect, useRef, useState } from "react"
import type { AddPanelOptions, DockviewApi, DockviewReadyEvent, IDockviewPanel } from "dockview"
import { DockviewReact } from "dockview"
import {
  Activity,
  AppWindow,
  LayoutGrid,
  MonitorCog,
  RefreshCcw,
  SquareTerminal,
} from "lucide-react"

import "dockview/dist/styles/dockview.css"

import "@/features/projects/components/workbench/workbench.css"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useProjectHeader } from "@/hooks/useProjectHeader"
import { useAccessibleProject } from "@/features/projects/hooks/useAccessibleProject"
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext"
import {
  type WorkbenchProjectState,
  type WorkbenchTile,
  type WorkbenchTileType,
  isWorkbenchSingletonTile,
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"
import { TaskFocusOverlay } from "@/features/projects/components/TaskFocusOverlay"
import {
  WORKBENCH_DOCK_COMPONENTS,
  WorkbenchDockRuntimeProvider,
  type WorkbenchDockPanelParams,
} from "@/features/projects/components/workbench/WorkbenchDockPanels"
import {
  type TaskOverlayLocationState,
  type TaskOverlayPayload,
} from "@/features/projects/lib/taskFocusOverlay"
import { useLocation, useSearchParams } from "@/lib/router"
import { cn } from "@/lib/utils"
import { useTheme } from "@/contexts/ThemeContext"
import { ChangesPage } from "@/features/projects/pages/ChangesPage"

const TILE_TYPE_META: Record<
  WorkbenchTileType,
  {
    label: string
    icon: typeof LayoutGrid
  }
> = {
  browser: { label: "Browser", icon: AppWindow },
  terminal: { label: "Terminal", icon: SquareTerminal },
  devServer: { label: "Dev Server", icon: MonitorCog },
  changes: { label: "Changes", icon: Activity },
  assistantChat: { label: "AI Chat", icon: LayoutGrid },
  tasks: { label: "Tasks", icon: LayoutGrid },
}

function normalizeOpenTargetParam(
  value: string | null,
): "changes" | Extract<WorkbenchTileType, "devServer" | "assistantChat"> | null {
  if (value === "changes" || value === "devServer" || value === "assistantChat") {
    return value
  }
  return null
}

function getTaskOverlayKey(task: TaskOverlayPayload): string {
  return `${task.projectId}:${task.source}:${task.storageId}`
}

function getDockComponentName(type: WorkbenchTileType): keyof typeof WORKBENCH_DOCK_COMPONENTS {
  switch (type) {
    case "browser":
    case "terminal":
    case "devServer":
    case "assistantChat":
      return type
    default:
      return "assistantChat"
  }
}

function getPanelParams(projectId: string, tileId: string): WorkbenchDockPanelParams {
  return { projectId, tileId }
}

function isObsoleteWorkbenchTile(tile: WorkbenchTile | undefined | null): boolean {
  return !tile || tile.type === "changes" || tile.type === "tasks"
}

function findPanelByType(
  api: DockviewApi,
  project: WorkbenchProjectState,
  type: WorkbenchTileType,
  excludeTileId?: string,
): IDockviewPanel | undefined {
  for (const tileId of project.order) {
    if (tileId === excludeTileId) continue
    const tile = project.tiles[tileId]
    if (!tile || tile.type !== type) continue
    const panel = api.getPanel(tileId)
    if (panel) return panel
  }
  return undefined
}

function buildAddPanelOptions(
  api: DockviewApi,
  project: WorkbenchProjectState,
  tile: WorkbenchTile,
  projectId: string,
): AddPanelOptions<WorkbenchDockPanelParams> {
  const base: AddPanelOptions<WorkbenchDockPanelParams> = {
    id: tile.id,
    title: tile.title,
    component: getDockComponentName(tile.type),
    params: getPanelParams(projectId, tile.id),
  }

  if (api.totalPanels === 0) {
    return base
  }

  const activePanel = api.activePanel
  const browserPanel = findPanelByType(api, project, "browser", tile.id)

  switch (tile.type) {
    case "browser":
      if (browserPanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: browserPanel.id,
            direction: "within",
          },
        }
      }
      if (activePanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: activePanel.id,
            direction: "right",
          },
        }
      }
      return base
    case "terminal":
      if (browserPanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: browserPanel.id,
            direction: "below",
          },
        }
      }
      break
    case "devServer":
      if (browserPanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: browserPanel.id,
            direction: "below",
          },
        }
      }
      break
    case "assistantChat":
      if (activePanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: activePanel.id,
            direction: "right",
          },
        }
      }
      break
    default:
      break
  }

  if (activePanel) {
    return {
      ...base,
      floating: false,
      position: {
        referencePanel: activePanel.id,
        direction: "right",
      },
    }
  }

  return base
}

function buildDefaultDockview(
  api: DockviewApi,
  project: WorkbenchProjectState,
  projectId: string,
) {
  api.clear()

  for (const tileId of project.order) {
    const tile = project.tiles[tileId]
    if (isObsoleteWorkbenchTile(tile)) continue
    api.addPanel(buildAddPanelOptions(api, project, tile, projectId))
  }
}

function syncPanelTitles(api: DockviewApi, project: WorkbenchProjectState) {
  for (const tileId of project.order) {
    const tile = project.tiles[tileId]
    const panel = api.getPanel(tileId)
    if (isObsoleteWorkbenchTile(tile) || !panel) continue
    if (panel.api.title !== tile.title) {
      panel.api.setTitle(tile.title)
    }
  }
}

function reconcilePanels(
  api: DockviewApi,
  project: WorkbenchProjectState,
  projectId: string,
) {
  const nextTileIds = new Set(project.order)

  for (const panel of [...api.panels]) {
    if (!nextTileIds.has(panel.id)) {
      api.removePanel(panel)
    }
  }

  for (const tileId of project.order) {
    const tile = project.tiles[tileId]
    if (isObsoleteWorkbenchTile(tile)) continue
    const existingPanel = api.getPanel(tileId)
    if (existingPanel) {
      if (existingPanel.api.title !== tile.title) {
        existingPanel.api.setTitle(tile.title)
      }
      continue
    }
    api.addPanel(buildAddPanelOptions(api, project, tile, projectId))
  }

  syncPanelTitles(api, project)
}

export function ProjectWorkbenchPage() {
  const { project } = useAccessibleProject()
  const syncContext = useOptionalProjectSyncContext()
  const projectPath = syncContext?.projectPath ?? null
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const projectId = project?._id ? String(project._id) : null
  const locationState = (location.state as TaskOverlayLocationState | null) ?? null
  const projectWorkbench = useProjectWorkbenchStore(selectProjectWorkbench(projectId))
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions)
  const { theme } = useTheme()
  const dockviewApiRef = useRef<DockviewApi | null>(null)
  const hydratedProjectKeyRef = useRef<string | null>(null)
  const layoutSaveFrameRef = useRef<number | null>(null)
  const [taskCards, setTaskCards] = useState<TaskOverlayPayload[]>(() =>
    locationState?.taskOverlay ? [locationState.taskOverlay] : [],
  )
  const [isChangesOpen, setIsChangesOpen] = useState(false)

  useEffect(() => {
    if (!projectId) return
    workbenchActions.ensureProject(projectId)
  }, [projectId, workbenchActions])

  useEffect(() => {
    if (!projectId) return
    const requestedOpenTarget = normalizeOpenTargetParam(searchParams.get("openTile"))
    if (!requestedOpenTarget) return
    if (requestedOpenTarget === "changes") {
      setIsChangesOpen(true)
    } else {
      workbenchActions.openSingletonTile(projectId, requestedOpenTarget)
    }
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete("openTile")
    setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true })
  }, [projectId, searchParams, setSearchParams, workbenchActions])

  useEffect(() => {
    const nextTask = locationState?.taskOverlay
    if (!nextTask) return

    setTaskCards((current) => {
      const nextKey = getTaskOverlayKey(nextTask)
      const remaining = current.filter((task) => getTaskOverlayKey(task) !== nextKey)
      return [nextTask, ...remaining].slice(0, 3)
    })
  }, [locationState?.taskOverlay])

  useEffect(() => {
    if (!projectId) {
      setTaskCards([])
      setIsChangesOpen(false)
      return
    }
    setTaskCards((current) => current.filter((task) => task.projectId === projectId))
  }, [projectId])

  useEffect(() => {
    if (!isChangesOpen) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setIsChangesOpen(false)
    }

    window.addEventListener("keydown", handleEscape)
    return () => {
      window.removeEventListener("keydown", handleEscape)
    }
  }, [isChangesOpen])

  const resolvedDockviewThemeClass =
    theme === "dark" || (theme === "system" && document.documentElement.classList.contains("dark"))
      ? "dockview-theme-dark"
      : "dockview-theme-light"

  const handleOpenBrowser = (sourceTileId: string, url: string) => {
    if (!projectId || !projectWorkbench) return
    const sourceTile = projectWorkbench.tiles[sourceTileId]
    if (sourceTile?.type !== "devServer") return
    const linkedBrowserTileId = sourceTile.linkedBrowserTileId
    if (linkedBrowserTileId && projectWorkbench.tiles[linkedBrowserTileId]?.type === "browser") {
      workbenchActions.updateBrowserTile(projectId, linkedBrowserTileId, {
        url,
        linkedDevServerTileId: sourceTileId,
      })
      workbenchActions.setActiveTile(projectId, linkedBrowserTileId)
      return
    }

    const nextBrowserTileId = workbenchActions.addTile(projectId, "browser", {
      url,
      linkedDevServerTileId: sourceTileId,
    })
    workbenchActions.updateDevServerTile(projectId, sourceTileId, {
      linkedBrowserTileId: nextBrowserTileId,
    })
    workbenchActions.setActiveTile(projectId, nextBrowserTileId)
  }

  useEffect(() => {
    const api = dockviewApiRef.current
    if (!api || !projectId || !projectWorkbench) return

    const hydrationKey = `${projectId}:${projectWorkbench.layoutResetKey}`
    if (hydratedProjectKeyRef.current === hydrationKey) return

    hydratedProjectKeyRef.current = hydrationKey

    if (projectWorkbench.layout) {
      api.clear()
      api.fromJSON(projectWorkbench.layout, { reuseExistingPanels: false })
      syncPanelTitles(api, projectWorkbench)
    } else {
      buildDefaultDockview(api, projectWorkbench, projectId)
    }

    if (projectWorkbench.activeTileId) {
      api.getPanel(projectWorkbench.activeTileId)?.api.setActive()
    }
  }, [projectId, projectWorkbench])

  useEffect(() => {
    const api = dockviewApiRef.current
    if (!api || !projectId || !projectWorkbench) return
    if (hydratedProjectKeyRef.current !== `${projectId}:${projectWorkbench.layoutResetKey}`) return

    reconcilePanels(api, projectWorkbench, projectId)

    if (projectWorkbench.activeTileId) {
      api.getPanel(projectWorkbench.activeTileId)?.api.setActive()
    }
  }, [projectId, projectWorkbench])

  useEffect(() => {
    return () => {
      if (layoutSaveFrameRef.current !== null) {
        cancelAnimationFrame(layoutSaveFrameRef.current)
      }
    }
  }, [])

  const headerAddon = (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="secondary" className="h-7 px-2.5 text-xs">
            <LayoutGrid className="mr-1 h-3.5 w-3.5" />
            Add Tile
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Workbench Panels</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(["browser", "terminal", "devServer"] as WorkbenchTileType[]).map((type) => {
            const meta = TILE_TYPE_META[type]
            const Icon = meta.icon
            return (
              <DropdownMenuItem
                key={type}
                onSelect={() => {
                  if (!projectId) return
                  if (isWorkbenchSingletonTile(type)) {
                    workbenchActions.openSingletonTile(
                      projectId,
                      type as Extract<WorkbenchTileType, "devServer" | "assistantChat">,
                    )
                    return
                  }
                  workbenchActions.addTile(projectId, type)
                }}
              >
                <Icon className="mr-2 h-4 w-4" />
                {meta.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2.5 text-xs"
        disabled={!projectId}
        onClick={() => {
          if (!projectId) return
          workbenchActions.resetProject(projectId)
        }}
      >
        <RefreshCcw className="mr-1 h-3.5 w-3.5" />
        Reset Layout
      </Button>
    </div>
  )

  useProjectHeader(
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <LayoutGrid className="h-4 w-4" />
      <span>{project?.name ? `${project.name} workbench` : "Workbench"}</span>
      {projectPath ? (
        <span className="truncate text-xs text-muted-foreground/80">{projectPath}</span>
      ) : null}
    </div>,
    headerAddon,
    null,
    false,
  )

  if (!projectId || !projectWorkbench) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading workbench…
      </div>
    )
  }

  return (
    <WorkbenchDockRuntimeProvider
      projectId={projectId}
      projectPath={projectPath}
      onOpenBrowserFromDevServer={handleOpenBrowser}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="relative flex h-full min-h-0">
            <div className="min-w-0 flex-1 overflow-hidden bg-content-surface">
              <DockviewReact
                className={cn("cozea-workbench-dockview h-full", resolvedDockviewThemeClass)}
                components={WORKBENCH_DOCK_COMPONENTS}
                disableFloatingGroups
                tabAnimation="smooth"
                singleTabMode="default"
                onReady={(event: DockviewReadyEvent) => {
                  dockviewApiRef.current = event.api

                  const saveLayout = () => {
                    if (!projectId) return
                    if (layoutSaveFrameRef.current !== null) {
                      cancelAnimationFrame(layoutSaveFrameRef.current)
                    }
                    layoutSaveFrameRef.current = requestAnimationFrame(() => {
                      workbenchActions.setLayoutSnapshot(projectId, event.api.toJSON())
                    })
                  }

                  event.api.onDidLayoutChange(() => {
                    saveLayout()
                  })

                  event.api.onDidActivePanelChange((activePanel) => {
                    workbenchActions.setActiveTile(projectId, activePanel?.id ?? null)
                  })

                  event.api.onDidRemovePanel((panel) => {
                    workbenchActions.removeTile(projectId, panel.id)
                  })
                }}
              />
            </div>

            {isChangesOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Close changes"
                  className="absolute inset-0 z-20 bg-background/30 transition-colors hover:bg-background/35"
                  onClick={() => setIsChangesOpen(false)}
                />

                <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(44rem,calc(100%-2rem))] max-w-full flex-col border-l border-border/60 bg-background shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
                  <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <span>Changes</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => setIsChangesOpen(false)}
                    >
                      Close
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <ChangesPage presentation="embedded" />
                  </div>
                </aside>
              </>
            ) : null}

            {taskCards.length > 0 ? (
              <aside className="flex w-[320px] shrink-0 flex-col border-l border-border/60">
                <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Selected Tasks</p>
                    <p className="text-xs text-muted-foreground">Context cards stay beside the workbench.</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{taskCards.length}</span>
                </div>

                <div className="app-scrollbar flex-1 space-y-3 overflow-auto px-4 py-3">
                  {taskCards.map((task) => (
                    <TaskFocusOverlay
                      key={getTaskOverlayKey(task)}
                      task={task}
                      presentation="docked"
                      onDismiss={() => {
                        const taskKey = getTaskOverlayKey(task)
                        setTaskCards((current) => current.filter((card) => getTaskOverlayKey(card) !== taskKey))
                      }}
                    />
                  ))}
                </div>
              </aside>
            ) : null}
          </div>
        </div>

      </div>
    </WorkbenchDockRuntimeProvider>
  )
}

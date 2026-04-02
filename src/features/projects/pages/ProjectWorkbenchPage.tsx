import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import type { AddPanelOptions, DockviewApi, DockviewReadyEvent, IDockviewPanel } from "dockview"
import { DockviewReact } from "dockview"

import "dockview/dist/styles/dockview.css"

import "@/features/projects/components/workbench/workbench.css"
import { useAccessibleProject } from "@/features/projects/hooks/useAccessibleProject"
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext"
import { useProjectLaneState } from "@/features/projects/hooks/useProjectLaneState"
import { useAuth } from "@/contexts/AuthContext"
import { useProjectHeader } from "@/hooks/useProjectHeader"
import {
  type WorkbenchProjectState,
  type WorkbenchSelectionTile,
  type WorkbenchSelectionTileEdge,
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
import {
  WorkbenchEdgeInsertion,
  type WorkbenchInsertionEdge,
} from "@/features/projects/components/workbench/WorkbenchEdgeInsertion"
import { WorkbenchHeaderEditorControl } from "@/features/projects/components/workbench/WorkbenchHeaderEditorControl"
import { WorkbenchHeaderBranchControl } from "@/features/projects/components/workbench/WorkbenchHeaderBranchControl"

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
    case "selection":
    case "browser":
    case "terminal":
    case "devServer":
    case "assistantChat":
      return type
    default:
      return "assistantChat"
  }
}

const EDGE_TO_DOCK_DIRECTION: Record<WorkbenchSelectionTileEdge, "left" | "right" | "above" | "below"> = {
  left: "left",
  right: "right",
  top: "above",
  bottom: "below",
}

const EDGE_INSERTION_ARM_INSET = 28
const WORKBENCH_INSERTION_ANIMATION_MS = 180
type WorkbenchInsertionMotionDirection = "left" | "right" | "top" | "bottom" | "center"

function getInsertionMotionDirection(
  options: AddPanelOptions<WorkbenchDockPanelParams>,
): WorkbenchInsertionMotionDirection {
  const direction = options.position?.direction

  switch (direction) {
    case "left":
      return "left"
    case "right":
      return "right"
    case "above":
      return "top"
    case "below":
      return "bottom"
    default:
      return "center"
  }
}

function getPanelParams(projectId: string, tileId: string): WorkbenchDockPanelParams {
  return { projectId, tileId }
}

function isObsoleteWorkbenchTile(tile: WorkbenchTile | undefined | null): boolean {
  return !tile || tile.type === "changes" || tile.type === "tasks"
}

function isSelectionTile(tile: WorkbenchTile | undefined | null): tile is WorkbenchSelectionTile {
  return Boolean(tile && tile.type === "selection")
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
  addPanel: (options: AddPanelOptions<WorkbenchDockPanelParams>) => IDockviewPanel | undefined = (
    options,
  ) => api.addPanel(options),
) {
  const nextTileIds = new Set(project.order)

  for (const panel of api.panels) {
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
    addPanel(buildAddPanelOptions(api, project, tile, projectId))
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
  const { convexUserId } = useAuth()
  const dockviewApiRef = useRef<DockviewApi | null>(null)
  const dockviewHostRef = useRef<HTMLDivElement | null>(null)
  const hydratedProjectKeyRef = useRef<string | null>(null)
  const layoutSaveFrameRef = useRef<number | null>(null)
  const insertionAnimationFrameRef = useRef<number | null>(null)
  const insertionAnimationTimeoutRef = useRef<number | null>(null)
  const transientSelectionTileIdRef = useRef<string | null>(null)
  const edgeInsertionArmedRef = useRef(false)
  const [taskCards, setTaskCards] = useState<TaskOverlayPayload[]>(() =>
    locationState?.taskOverlay ? [locationState.taskOverlay] : [],
  )
  const [isChangesOpen, setIsChangesOpen] = useState(false)
  const [edgeInsertionArmed, setEdgeInsertionArmed] = useState(false)
  const collabBranch =
    project?.sourceControl?.activeCollabBranch ??
    project?.sourceControl?.defaultBranch ??
    project?.gitRepository?.defaultBranch ??
    "main"
  const { laneState, activeLane, refreshLaneState } = useProjectLaneState({
    projectId,
    projectPath,
    collabBranch,
  })
  const activeWorkbenchPath = activeLane?.projectPath ?? projectPath
  const headerCenter = useMemo(
    () => (
      <div className="flex min-w-0 max-w-[52vw] items-center justify-center">
        <div className="flex h-7 min-w-0 max-w-full items-center overflow-hidden rounded-full border border-border/60 bg-secondary/70 shadow-none">
          <div
            className="flex h-7 min-w-0 max-w-[320px] items-center px-3 text-xs font-medium text-foreground"
            title={project?.name ?? "Project"}
          >
            <span className="block truncate">{project?.name ?? "Project"}</span>
          </div>
          <WorkbenchHeaderBranchControl
            project={project ?? null}
            projectId={projectId}
            projectPath={projectPath}
            collabBranch={collabBranch}
            laneState={laneState}
            activeLane={activeLane}
            userId={convexUserId}
            onLaneStateChange={() => {
              void refreshLaneState()
            }}
            triggerClassName="h-7 rounded-none border-0 border-l border-border/60 bg-transparent px-2 hover:bg-background/30"
          />
        </div>
      </div>
    ),
    [
      activeLane,
      collabBranch,
      convexUserId,
      laneState,
      project,
      project?.name,
      projectId,
      projectPath,
      refreshLaneState,
    ],
  )
  const headerControls = useMemo(
    () => (
      <div className="flex min-w-0 items-center gap-2">
        <WorkbenchHeaderEditorControl projectPath={activeWorkbenchPath} />
      </div>
    ),
    [activeWorkbenchPath],
  )

  useProjectHeader(null, headerControls, headerCenter, true)

  const closeChangesOverlay = () => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete("changes")
    nextParams.delete("openTile")
    nextParams.delete("userId")
    setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true })
  }

  const clearInsertionAnimation = () => {
    if (insertionAnimationFrameRef.current !== null) {
      cancelAnimationFrame(insertionAnimationFrameRef.current)
      insertionAnimationFrameRef.current = null
    }
    if (insertionAnimationTimeoutRef.current !== null) {
      window.clearTimeout(insertionAnimationTimeoutRef.current)
      insertionAnimationTimeoutRef.current = null
    }

    const dockRoot = dockviewHostRef.current?.querySelector<HTMLElement>(".cozea-workbench-dockview")
    if (!dockRoot) return

    dockRoot.classList.remove("cozea-workbench-dockview--inserting")
    dockRoot
      .querySelectorAll<HTMLElement>(".cozea-workbench-group-enter")
      .forEach((element) => {
        element.classList.remove(
          "cozea-workbench-group-enter",
          "cozea-workbench-group-enter-from-left",
          "cozea-workbench-group-enter-from-right",
          "cozea-workbench-group-enter-from-top",
          "cozea-workbench-group-enter-from-bottom",
          "cozea-workbench-group-enter-from-center",
        )
      })
  }

  const addPanelWithInsertionAnimation = (options: AddPanelOptions<WorkbenchDockPanelParams>) => {
    const api = dockviewApiRef.current
    if (!api) return undefined

    const dockRoot = dockviewHostRef.current?.querySelector<HTMLElement>(".cozea-workbench-dockview")
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const existingGroupIds = new Set(
      api.groups
        .map((group) => group.api.id)
        .filter((groupId): groupId is string => Boolean(groupId)),
    )

    if (dockRoot && !prefersReducedMotion) {
      clearInsertionAnimation()
      dockRoot.classList.add("cozea-workbench-dockview--inserting")
    }

    const panel = api.addPanel(options)

    if (!dockRoot || prefersReducedMotion) {
      return panel
    }

    const motionDirection = getInsertionMotionDirection(options)
    const nextGroup =
      api.groups.find((group) => !existingGroupIds.has(group.api.id)) ?? panel.group ?? null
    const nextGroupElement =
      nextGroup && "element" in nextGroup && nextGroup.element instanceof HTMLElement
        ? nextGroup.element
        : null

    if (nextGroupElement) {
      insertionAnimationFrameRef.current = requestAnimationFrame(() => {
        nextGroupElement.classList.remove(
          "cozea-workbench-group-enter",
          "cozea-workbench-group-enter-from-left",
          "cozea-workbench-group-enter-from-right",
          "cozea-workbench-group-enter-from-top",
          "cozea-workbench-group-enter-from-bottom",
          "cozea-workbench-group-enter-from-center",
        )
        void nextGroupElement.getBoundingClientRect()
        nextGroupElement.classList.add("cozea-workbench-group-enter")
        nextGroupElement.classList.add(`cozea-workbench-group-enter-from-${motionDirection}`)
      })
    }

    insertionAnimationTimeoutRef.current = window.setTimeout(() => {
      clearInsertionAnimation()
    }, WORKBENCH_INSERTION_ANIMATION_MS)

    return panel
  }

  useEffect(() => {
    if (!projectId) return
      workbenchActions.ensureProject(projectId)
  }, [projectId, workbenchActions])

  useEffect(() => {
    if (!projectId) return
    const requestedOpenTarget = normalizeOpenTargetParam(searchParams.get("openTile"))
    if (!requestedOpenTarget) return
    if (requestedOpenTarget === "changes") {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete("openTile")
      nextParams.set("changes", "1")
      setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true })
    } else {
      if (requestedOpenTarget === "assistantChat") {
        workbenchActions.addTile(projectId, "assistantChat")
      } else {
        workbenchActions.openSingletonTile(projectId, requestedOpenTarget)
      }
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete("openTile")
      setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true })
    }
  }, [projectId, searchParams, setSearchParams, workbenchActions])

  const handleWorkbenchPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null

    if (target?.closest("[data-workbench-chrome='true']")) {
      edgeInsertionArmedRef.current = false
      setEdgeInsertionArmed(false)
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    const withinInterior =
      localX > EDGE_INSERTION_ARM_INSET &&
      localX < rect.width - EDGE_INSERTION_ARM_INSET &&
      localY > EDGE_INSERTION_ARM_INSET &&
      localY < rect.height - EDGE_INSERTION_ARM_INSET

    if (withinInterior) {
      edgeInsertionArmedRef.current = true
      setEdgeInsertionArmed(true)
    }
  }

  useEffect(() => {
    setIsChangesOpen(searchParams.get("changes") === "1")
  }, [searchParams])

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

    reconcilePanels(api, projectWorkbench, projectId, addPanelWithInsertionAnimation)

    if (projectWorkbench.activeTileId) {
      api.getPanel(projectWorkbench.activeTileId)?.api.setActive()
    }
  }, [projectId, projectWorkbench])

  useEffect(() => {
    return () => {
      if (layoutSaveFrameRef.current !== null) {
        cancelAnimationFrame(layoutSaveFrameRef.current)
      }
      clearInsertionAnimation()
    }
  }, [])

  const retractSelectionTile = (selectionTileId: string) => {
    if (!projectId) return
    const liveProject = useProjectWorkbenchStore.getState().projects[projectId]
    const selectionTile = liveProject?.tiles[selectionTileId]

    if (!isSelectionTile(selectionTile) || selectionTile.mode !== "edgePreview") return

    const survivingTileIds = (liveProject?.order ?? []).filter((tileId) => {
      const tile = liveProject?.tiles[tileId]
      return !isObsoleteWorkbenchTile(tile)
    })

    if (survivingTileIds.length <= 1) return

    transientSelectionTileIdRef.current = null

    const panel = dockviewApiRef.current?.getPanel(selectionTileId)
    if (panel) {
      panel.api.close()
      return
    }

    workbenchActions.removeTile(projectId, selectionTileId)
  }

  if (!projectId || !projectWorkbench) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading workbench…
      </div>
    )
  }

  const handleResolveSelectionTile = (
    selectionTileId: string,
    type: Extract<WorkbenchTileType, "assistantChat" | "browser" | "terminal" | "devServer">,
  ) => {
    if (!projectId) return

    const api = dockviewApiRef.current
    const liveProject = useProjectWorkbenchStore.getState().projects[projectId]
    const selectionTile = liveProject?.tiles[selectionTileId]
    if (!api || !isSelectionTile(selectionTile)) return

    if (isWorkbenchSingletonTile(type)) {
      const existingSingletonId = liveProject.order.find(
        (tileId) => liveProject.tiles[tileId]?.type === type,
      )
      if (existingSingletonId) {
        workbenchActions.setActiveTile(projectId, existingSingletonId)
        api.getPanel(existingSingletonId)?.api.setActive()
        api.getPanel(selectionTileId)?.api.close()
        transientSelectionTileIdRef.current = null
        return
      }
    }

    const tileId = workbenchActions.addTile(projectId, type)
    const nextTile = useProjectWorkbenchStore.getState().projects[projectId]?.tiles[tileId]
    if (!nextTile) return

    addPanelWithInsertionAnimation({
      id: nextTile.id,
      title: nextTile.title,
      component: getDockComponentName(nextTile.type),
      params: getPanelParams(projectId, nextTile.id),
      position: {
        referencePanel: selectionTileId,
        direction: "within",
      },
    })

    workbenchActions.setActiveTile(projectId, nextTile.id)
    api.getPanel(nextTile.id)?.api.setActive()
    api.getPanel(selectionTileId)?.api.close()
    transientSelectionTileIdRef.current = null
  }

  const handleDuplicateAssistantTile = (sourceTileId: string) => {
    if (!projectId) return

    const api = dockviewApiRef.current
    const liveProject = useProjectWorkbenchStore.getState().projects[projectId]
    const sourceTile = liveProject?.tiles[sourceTileId]
    if (!liveProject || !sourceTile || sourceTile.type !== "assistantChat") return

    const nextTileId = workbenchActions.addTile(projectId, "assistantChat", {
      title: `${sourceTile.title} Copy`,
      assistantProjectId: sourceTile.assistantProjectId,
      provider: sourceTile.provider,
      model: sourceTile.model,
      runtimeMode: sourceTile.runtimeMode,
      interactionMode: sourceTile.interactionMode,
      agentLabel: sourceTile.agentLabel,
      laneBinding: sourceTile.laneBinding,
    })
    const nextTile = useProjectWorkbenchStore.getState().projects[projectId]?.tiles[nextTileId]
    if (!nextTile || !api) return

    addPanelWithInsertionAnimation({
      id: nextTile.id,
      title: nextTile.title,
      component: getDockComponentName(nextTile.type),
      params: getPanelParams(projectId, nextTile.id),
      position: {
        referencePanel: sourceTileId,
        direction: "right",
      },
    })

    workbenchActions.setActiveTile(projectId, nextTile.id)
    api.getPanel(nextTile.id)?.api.setActive()
  }

  const handleEdgeActivate = (edge: WorkbenchInsertionEdge) => {
    if (!projectId) return
    if (!edgeInsertionArmedRef.current) return

    const liveProject = useProjectWorkbenchStore.getState().projects[projectId]
    if (!liveProject) return

    const nonObsoleteTiles = liveProject.order.filter((tileId) => {
      const tile = liveProject.tiles[tileId]
      return !isObsoleteWorkbenchTile(tile)
    })
    const loneVisibleTile =
      nonObsoleteTiles.length === 1 ? liveProject.tiles[nonObsoleteTiles[0]] : null

    if (
      nonObsoleteTiles.length === 1 &&
      isSelectionTile(loneVisibleTile) &&
      loneVisibleTile.mode === "emptyState"
    ) {
      return
    }

    const existingSelectionId = transientSelectionTileIdRef.current
    const existingSelectionTile = existingSelectionId
      ? liveProject.tiles[existingSelectionId]
      : null

    if (
      isSelectionTile(existingSelectionTile) &&
      existingSelectionTile.mode === "edgePreview" &&
      existingSelectionTile.edge === edge
    ) {
      retractSelectionTile(existingSelectionTile.id)
      return
    }

    if (isSelectionTile(existingSelectionTile) && existingSelectionTile.mode === "edgePreview") {
      retractSelectionTile(existingSelectionTile.id)
    }

    const api = dockviewApiRef.current
    const selectionTileId = workbenchActions.addTile(projectId, "selection", {
      selectionMode: "edgePreview",
      selectionEdge: edge,
    })
    const nextTile = useProjectWorkbenchStore.getState().projects[projectId]?.tiles[selectionTileId]

    if (!api || !nextTile) return

    addPanelWithInsertionAnimation({
      id: nextTile.id,
      title: nextTile.title,
      component: getDockComponentName(nextTile.type),
      params: getPanelParams(projectId, nextTile.id),
      position: api.totalPanels > 0 ? { direction: EDGE_TO_DOCK_DIRECTION[edge] } : undefined,
    })

    transientSelectionTileIdRef.current = selectionTileId
    workbenchActions.setActiveTile(projectId, selectionTileId)
    api.getPanel(selectionTileId)?.api.setActive()
  }

  return (
        <WorkbenchDockRuntimeProvider
          projectId={projectId}
          projectPath={activeWorkbenchPath}
          onOpenBrowserFromDevServer={handleOpenBrowser}
          onDuplicateAssistantTile={handleDuplicateAssistantTile}
          onResolveSelectionTile={handleResolveSelectionTile}
        >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="relative flex h-full min-h-0">
            <div
              className="relative min-w-0 flex-1 overflow-hidden bg-content-surface"
              onPointerMove={handleWorkbenchPointerMove}
              onPointerLeave={() => {
                edgeInsertionArmedRef.current = false
                setEdgeInsertionArmed(false)
              }}
            >
              <WorkbenchEdgeInsertion
                armed={edgeInsertionArmed}
                disabledEdges={isChangesOpen ? ["top", "right"] : ["top"]}
                onEdgeActivate={handleEdgeActivate}
              />
              <div ref={dockviewHostRef} className="h-full">
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
                      if (transientSelectionTileIdRef.current === panel.id) {
                        transientSelectionTileIdRef.current = null
                      }
                      workbenchActions.removeTile(projectId, panel.id)
                    })
                  }}
                />
              </div>
            </div>

            {isChangesOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Close changes"
                  className="absolute inset-0 z-20 bg-background/30 transition-colors hover:bg-background/35"
                  onClick={closeChangesOverlay}
                />

                <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(52rem,calc(100%-2rem))] max-w-full flex-col border-l border-border/60 bg-background shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
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

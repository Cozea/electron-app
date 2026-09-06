import * as React from "react"
import type { ContextMenuItem } from "@cozea/assistant-contracts"

import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { LiveShimmerText } from "@/components/ui/live-shimmer-text"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons"
import { cn } from "@/lib/utils"
import { featureFlags } from "@/lib/featureFlags"
import { useAuth } from "@/contexts/AuthContext"
import { useConvex } from "convex/react"
import { prefetchProjectSwitch } from "@/features/projects/lib/projectSwitchPrefetch"
import { usePretextOverflowTitleFor } from "@/hooks/usePretextOverflowTitle"
import { useWorkspaceSnapshotEntry } from "@/features/workspace/useWorkspaceCatalogSnapshot"
import { useProjectLaneState } from "@/features/workbench/hooks/useProjectLaneState"
import { ProjectPixelInvaderIcon } from "@/components/ProjectPixelInvaderIcon"
import { SidebarLaneTiles } from "./SidebarLaneTiles"
import {
  buildDevServerRunKey,
  isDevServerRunActive,
  useDevServerRunStore,
} from "@/features/dev-server/devServerRunStore"
import {
  resolveProjectCollabBranch,
  resolveSidebarDevAppMenuAction,
  areSidebarProjectItemsEqual,
  hasProjectSidebarChildren,
  SIDEBAR_PILL_ACTIVE_CLASS,
  SIDEBAR_PILL_HOVER_CLASS,
  type SidebarProjectTreeItemProps,
} from "@/features/projects/ui/sidebar/projectSidebarShared"
import {
  buildWorkbenchLaneSidebarSummary,
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/lib/workbenchStore"
import {
  isSidebarActivityLive,
  resolveProjectRowActivity,
} from "@/lib/sidebarActivity"
import { useProjectSidebarActivity } from "./useProjectSidebarActivity"

import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon as __ChevronDownHugeIcon,
  ArrowRight01Icon as __ChevronRightHugeIcon,
  MoreVerticalIcon as __EllipsisVerticalHugeIcon,
} from '@hugeicons/core-free-icons'

const SIDEBAR_PROJECT_LABEL_FONT = "13px Inter"

async function showNativeSidebarMenu<T extends string>(
  event: React.MouseEvent<HTMLElement>,
  items: readonly ContextMenuItem<T>[],
): Promise<T | null> {
  event.preventDefault()
  event.stopPropagation()

  if (items.length === 0) {
    return null
  }

  const isContextMenu = event.type === "contextmenu" || event.button === 2
  const position = isContextMenu
    ? {
        x: Math.round(event.clientX),
        y: Math.round(event.clientY),
      }
    : {
        x: Math.round(event.currentTarget.getBoundingClientRect().left + event.currentTarget.getBoundingClientRect().width / 2),
        y: Math.round(event.currentTarget.getBoundingClientRect().bottom),
      }

  return showDesktopContextMenu(items, position)
}

export const ProjectSidebarTreeItem = React.memo(
  function ProjectSidebarTreeItem({
    project,
    projectIndex,
    projectCount,
    selection,
    context,
    actions,
  }: SidebarProjectTreeItemProps) {
    const shouldLoadLanes = selection.isExpanded || context.isCurrentProject
    const collabBranch = React.useMemo(() => resolveProjectCollabBranch(project), [project])
    const { principalId } = useAuth()
    const convex = useConvex()
    // Pushed catalog snapshot: no per-row resolveProject IPC. The layout still
    // does a fresh, candidate-scanning resolution when a project is opened.
    const snapshotEntry = useWorkspaceSnapshotEntry(project.id)
    const workspaceId = snapshotEntry?.status === "ready" ? snapshotEntry.workspace.workspaceId : null

    const fetchedLaneState = useProjectLaneState({
      projectId: context.prefetchedLaneState ? null : shouldLoadLanes ? project.id : null,
      workspaceId: context.prefetchedLaneState ? null : shouldLoadLanes ? workspaceId : null,
      collabBranch,
    })
    const activeLane = context.prefetchedActiveLane ?? fetchedLaneState.activeLane
    const activeLaneWorkbench = useProjectWorkbenchStore((state) => {
      if (!activeLane) return null
      return selectProjectWorkbench(
        project.id,
        activeLane.id,
        activeLane.workspaceId ?? workspaceId,
      )(state)
    })
    const activeLaneSummary = React.useMemo(
      () => (activeLaneWorkbench ? buildWorkbenchLaneSidebarSummary(activeLaneWorkbench) : null),
      [activeLaneWorkbench],
    )
    const activeDevServerRunKey = React.useMemo(() => {
      const runtimeWorkspaceId = activeLane?.workspaceId ?? workspaceId
      return activeLane && runtimeWorkspaceId
        ? buildDevServerRunKey(runtimeWorkspaceId, activeLane.id)
        : null
    }, [activeLane, workspaceId])
    const activeDevServerStatus = useDevServerRunStore(
      React.useCallback(
        (state) =>
          activeDevServerRunKey
            ? (state.runs[activeDevServerRunKey]?.status ?? "idle")
            : "idle",
        [activeDevServerRunKey],
      ),
    )
    const hasBuiltInDevServerSurface = Boolean(
      activeLaneSummary?.surfaces.some(
        (surface) => surface.type === "devServer" && !surface.devAppId,
      ),
    )
    const hasHeadlessDevServer =
      isDevServerRunActive(activeDevServerStatus) && !hasBuiltInDevServerSurface

    const hasSidebarChildren = hasProjectSidebarChildren(
      activeLaneSummary,
      hasHeadlessDevServer,
    )
    const isLanesOpen = selection.isExpanded && hasSidebarChildren
    const canToggleLanes = hasSidebarChildren || !shouldLoadLanes

    // Keyed off the project, not the active lane: lane state only loads for the
    // focused or expanded row, so a lane-scoped lookup would stop reporting the
    // moment another project is focused.
    const { projectActivity, visibleActivity } = useProjectSidebarActivity({
      projectId: project.id,
      workspaceId,
      activeLaneSummary,
      activeDevServerStatus,
    })

    const projectRowActivity = resolveProjectRowActivity({
      isExpanded: isLanesOpen,
      projectActivity,
      visibleActivity,
    })
    const isProjectRowActive = isSidebarActivityLive(projectRowActivity)

    const { containerRef: projectRowRef, getOverflowTitle } = usePretextOverflowTitleFor<HTMLDivElement>({
      font: SIDEBAR_PROJECT_LABEL_FONT,
    })
    const projectNameTitle = React.useMemo(() => {
      const reservedWidth = 18 + 8 + 24 + 8 + 8
      return getOverflowTitle(project.name, reservedWidth)
    }, [getOverflowTitle, project.name])

    const handleProjectOpenClick = React.useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      void actions.openProject(project, workspaceId);
    }, [actions, project, workspaceId]);

    const handlePrefetchProject = React.useCallback(() => {
      if (context.isCurrentProject) return
      prefetchProjectSwitch({
        projectId: project.id,
        projectSlug: project.slug,
        workspaceId,
        collabBranch,
        convex,
        userId: principalId ?? null,
      })
    }, [
      collabBranch,
      context.isCurrentProject,
      convex,
      principalId,
      project.id,
      project.slug,
      workspaceId,
    ]);

    const handleProjectToggleClick = React.useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      actions.toggleExpanded(project.id);
    }, [actions, project.id]);

    const handleProjectMenuClick = React.useCallback(
      async (event: React.MouseEvent<HTMLElement>) => {
        const devAppAction = resolveSidebarDevAppMenuAction(context)
        const items: ContextMenuItem<
          | "open-project"
          | "relink-project"
          | "close-workspace"
          | "open-folder"
          | "settings"
          | "publish-dev-app"
          | "rename"
          | "archive"
          | "restore"
          | "delete"
          | "move-up"
          | "move-down"
          | "sync"
          | "divider-primary"
          | "divider-secondary"
        >[] = [
          { id: "open-project", label: "Open Project", icon: getNativeMenuIcon("open-project") },
          { id: "relink-project", label: "Relink Local Folder", icon: getNativeMenuIcon("relink") },
          { id: "open-folder", label: "Open Folder", icon: getNativeMenuIcon("open-folder") },
          { id: "settings", label: "Settings", icon: getNativeMenuIcon("settings") },
        ]

        if (featureFlags.projectDevApps) {
          items.push({
            id: "publish-dev-app",
            label: devAppAction.label,
            enabled: devAppAction.enabled,
            icon: getNativeMenuIcon("package"),
          })
        }

        items.push(
          { id: "divider-primary", label: "", type: "separator" },
          { id: "rename", label: "Rename", icon: getNativeMenuIcon("rename") },
          {
            id: project.status === "archived" ? "restore" : "archive",
            label: project.status === "archived" ? "Restore" : "Archive",
            icon: project.status === "archived" ? getNativeMenuIcon("restore") : getNativeMenuIcon("archive"),
          },
          { id: "delete", label: "Delete", destructive: true, icon: getNativeMenuIcon("delete") },
        )

        const hasSidebarActions =
          projectIndex > 0 ||
          projectIndex < projectCount - 1 ||
          (context.isCurrentProject && context.currentWorkspaceId && !context.isSyncingProject)

        if (hasSidebarActions) {
          items.push({ id: "divider-secondary", label: "", type: "separator" })
        }

        if (projectIndex > 0) {
          items.push({ id: "move-up", label: "Move up", icon: getNativeMenuIcon("move-up") })
        }

        if (projectIndex < projectCount - 1) {
          items.push({ id: "move-down", label: "Move down", icon: getNativeMenuIcon("move-down") })
        }

        if (context.isCurrentProject && context.currentWorkspaceId && !context.isSyncingProject) {
          items.push({ id: "close-workspace", label: "Close Workspace", icon: getNativeMenuIcon("close") })
          items.push({ id: "sync", label: "Sync", icon: getNativeMenuIcon("sync") })
        }

        const action = await showNativeSidebarMenu(event, items)
        if (!action) return

        switch (action) {
          case "open-project":
            void actions.openProject(project, workspaceId)
            break
          case "relink-project":
            void actions.relinkProjectWorkspace(project, workspaceId)
            break
          case "close-workspace":
            void actions.closeProjectWorkspace(project, context.currentWorkspaceId)
            break
          case "open-folder":
            void actions.openProjectFolder(project, workspaceId)
            break
          case "settings":
            actions.openProjectSettings(project)
            break
          case "publish-dev-app":
            if (devAppAction.enabled) {
              void actions.publishDevApp(project, workspaceId, devAppAction.mode)
            }
            break
          case "rename":
            actions.renameProject(project)
            break
          case "archive":
            void actions.archiveProject(project)
            break
          case "restore":
            void actions.restoreProject(project)
            break
          case "delete":
            actions.deleteProject(project)
            break
          case "move-up":
            actions.moveProject(project.id, "up")
            break
          case "move-down":
            actions.moveProject(project.id, "down")
            break
          case "sync":
            void actions.syncProject(project)
            break
        }
      },
      [
        actions,
        context.currentWorkspaceId,
        context.canPublishDevApp,
        context.devAppPublicationState,
        context.devAppPublishingMode,
        context.isCurrentProject,
        context.isSyncingProject,
        workspaceId,
        project,
        project.id,
        project.status,
        projectCount,
        projectIndex,
      ],
    )

    const [isDragging, setIsDragging] = React.useState(false)
    const [dropPosition, setDropPosition] = React.useState<"before" | "after" | null>(null)

    const handleDragStart = React.useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData("application/x-cozea-project-id", project.id)
        e.dataTransfer.effectAllowed = "move"
        setIsDragging(true)
      },
      [project.id],
    )

    const handleDragEnd = React.useCallback(() => {
      setIsDragging(false)
      setDropPosition(null)
    }, [])

    const handleDragOver = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes("application/x-cozea-project-id")) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"

      if (!projectRowRef.current) return
      const rect = projectRowRef.current.getBoundingClientRect()
      const midpoint = rect.top + rect.height / 2
      setDropPosition(e.clientY < midpoint ? "before" : "after")
    }, [])

    const handleDragLeave = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
      if (projectRowRef.current?.contains(e.relatedTarget as Node)) return
      setDropPosition(null)
    }, [])

    const handleDrop = React.useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        const sourceId = e.dataTransfer.getData("application/x-cozea-project-id")
        if (sourceId && sourceId !== project.id && dropPosition) {
          e.preventDefault()
          e.stopPropagation()
          actions.reorderProject?.(sourceId, project.id, dropPosition)
        }
        setDropPosition(null)
        setIsDragging(false)
      },
      [actions, dropPosition, project.id],
    )

    return (
      <Collapsible open={isLanesOpen}>
        <div
          ref={projectRowRef}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onContextMenu={handleProjectMenuClick}
          className={cn(
            "group/project-item relative flex min-h-7 items-center gap-1 rounded-md pl-1.5 pr-1 text-sidebar-foreground/70 select-none",
            SIDEBAR_PILL_HOVER_CLASS,
            (selection.activeSelectionLevel === "project" ||
              (!isLanesOpen && context.isCurrentProject)) &&
              SIDEBAR_PILL_ACTIVE_CLASS,
            isDragging && "opacity-40",
            dropPosition === "before" && "before:pointer-events-none before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:rounded-full before:bg-primary before:z-20",
            dropPosition === "after" && "after:pointer-events-none after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary after:z-20",
          )}
          onPointerEnter={handlePrefetchProject}
          onFocus={handlePrefetchProject}
        >
          <div className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              className="group flex min-h-7 min-w-0 max-w-full shrink cursor-pointer items-center gap-2 text-left text-xs font-normal text-muted-foreground focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring hover:text-foreground"
              onClick={handleProjectOpenClick}
              aria-label={`Open ${project.name}`}
            >
              <ProjectPixelInvaderIcon
                name={project.name || project.id}
                className="size-4.5 shrink-0"
                isActive={isProjectRowActive}
              />
              {isProjectRowActive ? (
                <LiveShimmerText
                  className="font-normal"
                  title={projectNameTitle}
                  baseClassName="text-sidebar-foreground/45"
                  sweepClassName="text-sidebar-foreground"
                >
                  {project.name}
                </LiveShimmerText>
              ) : (
                <span className="truncate font-normal" title={projectNameTitle}>
                  {project.name}
                </span>
              )}
            </button>
            {canToggleLanes ? (
              <button
                type="button"
                className="flex size-4 shrink-0 cursor-pointer items-center justify-center p-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover/project-item:opacity-100 group-focus-within/project-item:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none"
                onClick={handleProjectToggleClick}
                aria-label={isLanesOpen ? "Collapse" : "Expand"}
              >
                <HugeiconsIcon
                  icon={isLanesOpen ? __ChevronDownHugeIcon : __ChevronRightHugeIcon}
                  className="size-3"
                />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="flex size-4.5 shrink-0 cursor-pointer items-center justify-center p-0 text-muted-foreground/60 opacity-0 transition-colors group-hover/project-item:opacity-100 group-focus-within/project-item:opacity-100 hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
            onClick={handleProjectMenuClick}
            aria-label={`${project.name} options`}
          >
            <HugeiconsIcon icon={__EllipsisVerticalHugeIcon} className="size-3.5" />
          </button>
        </div>

        <CollapsibleContent>
          {hasSidebarChildren ? (
            <SidebarLaneTiles
              activeLaneSummary={activeLaneSummary}
              activeSelectionLevel={selection.activeSelectionLevel}
              activeTileId={selection.activeTileId}
              hasHeadlessDevServer={hasHeadlessDevServer}
              activeDevServerStatus={activeDevServerStatus}
              onOpenLaneWorkbench={(options) => {
                if (!activeLane) return
                void actions.openLaneWorkbench(project, activeLane.id, {
                  ...options,
                  workspaceId: activeLane.workspaceId ?? workspaceId,
                })
              }}
            />
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    )
  },
  (prev, next) => {
    return (
      areSidebarProjectItemsEqual(prev.project, next.project) &&
      prev.projectIndex === next.projectIndex &&
      prev.projectCount === next.projectCount &&
      prev.selection.isExpanded === next.selection.isExpanded &&
      prev.selection.activeSelectionLevel === next.selection.activeSelectionLevel &&
      prev.selection.activeTileId === next.selection.activeTileId &&
      prev.context.isCurrentProject === next.context.isCurrentProject &&
      prev.context.currentWorkspaceId === next.context.currentWorkspaceId &&
      prev.context.isSyncingProject === next.context.isSyncingProject &&
      prev.context.devAppPublicationState === next.context.devAppPublicationState &&
      prev.context.devAppPublishingMode === next.context.devAppPublishingMode &&
      prev.context.canPublishDevApp === next.context.canPublishDevApp &&
      prev.context.prefetchedLaneState === next.context.prefetchedLaneState &&
      prev.context.prefetchedActiveLane === next.context.prefetchedActiveLane &&
      prev.actions === next.actions
    )
  },
)

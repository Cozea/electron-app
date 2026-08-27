import * as React from "react"
import type { ContextMenuItem } from "@cozea/assistant-contracts"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { cn } from "@/lib/utils"
import { featureFlags } from "@/lib/featureFlags"
import { useAuth } from "@/contexts/AuthContext"
import { useConvex } from "convex/react"
import { prefetchProjectSwitch } from "@/features/projects/lib/projectSwitchPrefetch"
import { usePretextOverflowTitleFor } from "@/hooks/usePretextOverflowTitle"
import { useWorkspaceSnapshotEntry } from "@/features/projects/workspaces/useWorkspaceCatalogSnapshot"
import { useProjectLaneState } from "@/features/projects/hooks/useProjectLaneState"
import { NativeProjectFolderIcon } from "@/features/projects/components/NativeProjectFolderIcon"
import { SidebarLaneTiles } from "@/features/projects/components/sidebar/SidebarLaneTiles"
import {
  resolveProjectCollabBranch,
  resolveSidebarDevAppMenuAction,
  areSidebarProjectItemsEqual,
  SIDEBAR_PILL_ACTIVE_CLASS,
  SIDEBAR_PILL_HOVER_CLASS,
  type SidebarProjectTreeItemProps,
} from "@/features/projects/components/sidebar/projectSidebarShared"
import {
  buildWorkbenchLaneSidebarSummary,
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"

import { HugeiconsIcon } from '@hugeicons/react'
import { MoreVerticalIcon as __EllipsisVerticalHugeIcon } from '@hugeicons/core-free-icons'

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

  const rect = event.currentTarget.getBoundingClientRect()
  const position = {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.bottom),
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
    const { convexUserId } = useAuth()
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

    const isLanesOpen = selection.isExpanded
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
        userId: convexUserId ?? null,
      })
    }, [
      collabBranch,
      context.isCurrentProject,
      convex,
      convexUserId,
      project.id,
      project.slug,
      workspaceId,
    ]);

    const handleProjectToggleClick = React.useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      actions.toggleExpanded(project.id);
    }, [actions, project.id]);

    const handleProjectMenuClick = React.useCallback(
      async (event: React.MouseEvent<HTMLButtonElement>) => {
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
          { id: "open-project", label: "Open Project" },
          { id: "relink-project", label: "Relink Local Folder" },
          { id: "open-folder", label: "Open Folder" },
          { id: "settings", label: "Settings" },
        ]

        if (featureFlags.projectDevApps) {
          items.push({
            id: "publish-dev-app",
            label: devAppAction.label,
            enabled: devAppAction.enabled,
          })
        }

        items.push(
          { id: "divider-primary", label: "", type: "separator" },
          { id: "rename", label: "Rename" },
          {
            id: project.status === "archived" ? "restore" : "archive",
            label: project.status === "archived" ? "Restore" : "Archive",
          },
          { id: "delete", label: "Delete" },
        )

        const hasSidebarActions =
          projectIndex > 0 ||
          projectIndex < projectCount - 1 ||
          (context.isCurrentProject && context.currentWorkspaceId && !context.isSyncingProject)

        if (hasSidebarActions) {
          items.push({ id: "divider-secondary", label: "", type: "separator" })
        }

        if (projectIndex > 0) {
          items.push({ id: "move-up", label: "Move up" })
        }

        if (projectIndex < projectCount - 1) {
          items.push({ id: "move-down", label: "Move down" })
        }

        if (context.isCurrentProject && context.currentWorkspaceId && !context.isSyncingProject) {
          items.push({ id: "close-workspace", label: "Close Workspace" })
          items.push({ id: "sync", label: "Sync" })
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

    return (
      <Collapsible open={isLanesOpen}>
        <div
          ref={projectRowRef}
          className={cn(
            "group/project-item flex min-h-7 items-center gap-1 rounded-md pl-1.5 pr-1 text-sidebar-foreground/70",
            SIDEBAR_PILL_HOVER_CLASS,
            (selection.activeSelectionLevel === "project" ||
              (!selection.isExpanded && context.isCurrentProject)) &&
              SIDEBAR_PILL_ACTIVE_CLASS,
          )}
          onPointerEnter={handlePrefetchProject}
          onFocus={handlePrefetchProject}
        >
          <div className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              className="flex shrink-0 cursor-pointer items-center justify-center rounded-sm p-[2px] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={handleProjectToggleClick}
              aria-label={isLanesOpen ? "Collapse" : "Expand"}
            >
              <NativeProjectFolderIcon
                folderPath={snapshotEntry?.status === "ready" ? snapshotEntry.workspace.projectRootPath : null}
                isOpen={isLanesOpen}
              />
            </button>
            <button
              type="button"
              className="group flex min-h-7 min-w-0 flex-1 cursor-pointer items-center text-left text-xs font-normal text-muted-foreground focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring hover:text-foreground"
              onClick={handleProjectOpenClick}
              aria-label={`Open ${project.name}`}
            >
              <span className="min-w-0 flex-1 truncate font-normal" title={projectNameTitle}>
                {project.name}
              </span>
            </button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-0.5 size-6 shrink-0 rounded-md p-0 text-muted-foreground/70 opacity-0 transition-opacity group-hover/project-item:opacity-100 group-focus-within/project-item:opacity-100 hover:bg-transparent hover:text-foreground"
            onClick={handleProjectMenuClick}
            aria-label={`${project.name} options`}
          >
            <HugeiconsIcon icon={__EllipsisVerticalHugeIcon} className="size-3.5" />
          </Button>
        </div>

        <CollapsibleContent>
          <SidebarLaneTiles
            activeLaneSummary={activeLaneSummary}
            activeSelectionLevel={selection.activeSelectionLevel}
            activeTileId={selection.activeTileId}
            onOpenLaneWorkbench={(options) => {
              if (!activeLane) return
              void actions.openLaneWorkbench(project, activeLane.id, {
                ...options,
                workspaceId: activeLane.workspaceId ?? workspaceId,
              })
            }}
          />
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

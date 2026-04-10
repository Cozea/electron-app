import * as React from "react"
import type { ContextMenuItem } from "@cozea/assistant-contracts"
import { ChevronRightIcon as ChevronRight, EllipsisVerticalIcon as EllipsisVertical } from "@heroicons/react/24/outline"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { cn } from "@/lib/utils"
import { useLocalProjectPath } from "@/features/projects/hooks/useLocalProjectPath"
import { useProjectLaneState } from "@/features/projects/hooks/useProjectLaneState"
import { ProjectFavicon } from "@/features/projects/components/ProjectFavicon"
import { SidebarLaneTiles } from "@/features/projects/components/sidebar/SidebarLaneTiles"
import {
  resolveProjectCollabBranch,
  areSidebarProjectItemsEqual,
  SIDEBAR_PILL_ACTIVE_CLASS,
  SIDEBAR_PILL_HOVER_CLASS,
  type SidebarProjectTreeItemProps,
} from "@/features/projects/components/sidebar/projectSidebarShared"
import {
  buildWorkbenchLaneSidebarSummary,
  buildWorkbenchScopeKey,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"

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
    const { localPath } = useLocalProjectPath({
      initialPath: context.isCurrentProject
        ? (context.currentProjectPath ?? project.localPath)
        : project.localPath,
      preferInitialPath: context.isCurrentProject && Boolean(context.currentProjectPath),
      lookupOnMount: shouldLoadLanes,
      projectId: project.id,
      projectSlug: project.slug,
    })
    const projectIconPath = React.useMemo(
      () => project.localPath ?? localPath,
      [localPath, project.localPath],
    )
    const fetchedLaneState = useProjectLaneState({
      projectId: context.prefetchedLaneState ? null : shouldLoadLanes ? project.id : null,
      projectPath: context.prefetchedLaneState ? null : shouldLoadLanes ? localPath : null,
      collabBranch,
    })
    const activeLane = context.prefetchedActiveLane ?? fetchedLaneState.activeLane
    const activeLaneWorkbench = useProjectWorkbenchStore((state) => {
      if (!activeLane) return null
      return state.workbenches[buildWorkbenchScopeKey(project.id, activeLane.id)] ?? null
    })
    const activeLaneSummary = React.useMemo(
      () => (activeLaneWorkbench ? buildWorkbenchLaneSidebarSummary(activeLaneWorkbench) : null),
      [activeLaneWorkbench],
    )

    const handleProjectMenuClick = React.useCallback(
      async (event: React.MouseEvent<HTMLButtonElement>) => {
        const items: ContextMenuItem<
          | "open-project"
          | "open-folder"
          | "settings"
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
          { id: "open-folder", label: "Open Folder" },
          { id: "settings", label: "Settings" },
          { id: "divider-primary", label: "", type: "separator" },
          { id: "rename", label: "Rename" },
          {
            id: project.status === "archived" ? "restore" : "archive",
            label: project.status === "archived" ? "Restore" : "Archive",
          },
          { id: "delete", label: "Delete" },
        ]

        const hasSidebarActions =
          projectIndex > 0 ||
          projectIndex < projectCount - 1 ||
          (context.isCurrentProject && context.currentProjectPath && !context.isSyncingProject)

        if (hasSidebarActions) {
          items.push({ id: "divider-secondary", label: "", type: "separator" })
        }

        if (projectIndex > 0) {
          items.push({ id: "move-up", label: "Move up" })
        }

        if (projectIndex < projectCount - 1) {
          items.push({ id: "move-down", label: "Move down" })
        }

        if (context.isCurrentProject && context.currentProjectPath && !context.isSyncingProject) {
          items.push({ id: "sync", label: "Sync" })
        }

        const action = await showNativeSidebarMenu(event, items)
        if (!action) return

        switch (action) {
          case "open-project":
            void actions.openProject(project, localPath ?? project.localPath)
            break
          case "open-folder":
            void actions.openProjectFolder(project, localPath ?? project.localPath)
            break
          case "settings":
            actions.openProjectSettings(project)
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
        context.currentProjectPath,
        context.isCurrentProject,
        context.isSyncingProject,
        localPath,
        project,
        project.id,
        project.status,
        projectCount,
        projectIndex,
      ],
    )

    return (
      <Collapsible open={selection.isExpanded}>
        <div
          className={cn(
            "group/project-item flex min-h-8 items-center gap-2 rounded-md px-2 text-sidebar-foreground/70",
            SIDEBAR_PILL_HOVER_CLASS,
            selection.activeSelectionLevel === "project" && SIDEBAR_PILL_ACTIVE_CLASS,
          )}
        >
          <div
            role="button"
            tabIndex={0}
            className={cn(
              "group flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-xs font-normal focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            onClick={() => {
              void actions.openProject(project, localPath ?? project.localPath)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                void actions.openProject(project, localPath ?? project.localPath)
              }
            }}
          >
            <ProjectFavicon cwd={projectIconPath} />
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              <span className="min-w-0 truncate font-normal text-muted-foreground">
                {project.name}
              </span>
              <button
                type="button"
                className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm"
                onClick={(event) => {
                  event.stopPropagation()
                  actions.toggleExpanded(project.id)
                }}
                aria-label={
                  selection.isExpanded ? "Collapse project lanes" : "Expand project lanes"
                }
              >
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground/75 transition-[transform,opacity] duration-150 group-hover/project-item:opacity-100 group-focus-visible:opacity-100 opacity-0",
                    selection.isExpanded && "rotate-90",
                  )}
                />
              </button>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 rounded-md p-0 text-muted-foreground/70 opacity-0 transition-opacity group-hover/project-item:opacity-100 group-focus-within/project-item:opacity-100 hover:bg-transparent hover:text-foreground"
            onClick={handleProjectMenuClick}
            aria-label={`${project.name} options`}
          >
            <EllipsisVertical className="size-3.5" />
          </Button>
        </div>

        <CollapsibleContent className="overflow-hidden">
          <SidebarLaneTiles
            activeLaneSummary={activeLaneSummary}
            activeSelectionLevel={selection.activeSelectionLevel}
            activeTileId={selection.activeTileId}
            onOpenLaneWorkbench={(options) => {
              if (!activeLane) return
              void actions.openLaneWorkbench(project, activeLane.id, options)
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
      prev.context.currentProjectPath === next.context.currentProjectPath &&
      prev.context.isSyncingProject === next.context.isSyncingProject &&
      prev.context.prefetchedLaneState === next.context.prefetchedLaneState &&
      prev.context.prefetchedActiveLane === next.context.prefetchedActiveLane &&
      prev.actions === next.actions
    )
  },
)

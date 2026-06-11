

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon as __ArrowLeftHugeIcon, FolderAddIcon as __FolderAddHugeIcon, ShoppingBag01Icon as __ShoppingBagHugeIcon } from '@hugeicons/core-free-icons'


import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";

import { useViewTransitionNavigate } from "@/lib/navigation";
import { useLocation } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibleProject } from "@/features/projects/hooks/useAccessibleProject";
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext";
import { useProjectLaneState } from "@/features/projects/hooks/useProjectLaneState";
import { useProjectCreationMenu } from "@/features/projects/hooks/useProjectCreationMenu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useTranslation } from "@/lib/i18n";
import { NavUser } from "@/components/nav-user";
import { Button } from "@/components/ui/button";
import { buildProjectPath } from "../lib/projectRoutes";
import { buildWorkbenchIntentState } from "../lib/workbenchIntent";
import { buildProjectRouteNavigationState } from "@/features/projects/lib/projectNavigationState";
import { ProjectSidebarTreeItem } from "@/features/projects/components/sidebar/ProjectSidebarTreeItem";
import {
  areSidebarProjectItemsEqual,
  resolveProjectCollabBranch,
  SIDEBAR_GROUP_LABEL_CLASS,
  SIDEBAR_NAV_ROW_BUTTON_CLASS,
  SIDEBAR_PILL_ACTIVE_CLASS,
  type SidebarProjectItem,
} from "@/features/projects/components/sidebar/projectSidebarShared";
import {
  getProjectSidebarRouteState,
  PROJECT_SETTINGS_SECTIONS,
} from "@/features/projects/components/sidebar/projectSidebarRoutes";
import {
  areStringArraysEqual,
  buildOrderedProjects,
  readPersistedProjectSidebarState,
  type PersistedProjectSidebarState,
  writePersistedProjectSidebarState,
} from "@/features/projects/components/sidebar/projectSidebarState";
import {
  formatProjectDeleteError,
  formatProjectRenameError,
} from "../lib/projectMutationPresentation";
import { cleanupDeletedProjectLocally } from "@/features/projects/lib/projectLocalCleanup";
import { detachDeletedProjectFromUi } from "@/features/projects/lib/detachDeletedProjectFromUi";
import type { ProjectDeleteConfirmOptions } from "@/features/projects/components/ProjectDeleteDialog";
import { withProjectMutationTimeout } from "@/features/projects/lib/projectMutationTimeout";
import {
  selectProjectWorkbench,
  selectVisibleActiveWorkbenchTileId,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore";
import { useOptionalProjectRouteContext } from "@/features/projects/contexts/ProjectRouteContext";
import { useWorkspaceIdentity } from "@/features/projects/workspaces/useWorkspaceIdentity";
import { useProjectWorkspaceActions } from "@/features/projects/hooks/useProjectWorkspaceActions";

const LazyProjectDeleteDialog = React.lazy(() =>
  import("./ProjectDeleteDialog").then((module) => ({
    default: module.ProjectDeleteDialog,
  })),
);
const LazyProjectRenameDialog = React.lazy(() =>
  import("./ProjectRenameDialog").then((module) => ({
    default: module.ProjectRenameDialog,
  })),
);

interface ProjectSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user?: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  } | null;
  projectId?: Id<"projects"> | null;
  presenceUsers?: unknown[];
  presenceCount?: number;
}

export function ProjectSidebar({
  user,
  projectId: providedProjectId,
  presenceUsers: _presenceUsers,
  presenceCount: _presenceCount,
  className,
  ...props
}: ProjectSidebarProps) {
  const { t } = useTranslation();
  const navigate = useViewTransitionNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { openProjectCreationMenu } = useProjectCreationMenu();
  const { convexUserId } = useAuth();
  const projectRouteContext = useOptionalProjectRouteContext();
  const { project: currentProject, projectIdParam } = useAccessibleProject();
  const projectSyncContext = useOptionalProjectSyncContext();
  const currentProjectId = providedProjectId
    ? String(providedProjectId)
    : currentProject?._id
      ? String(currentProject._id)
      : projectIdParam;
  const { workspaceId: currentWorkspaceId } = useWorkspaceIdentity();
  const persistedSidebarState = React.useMemo(() => readPersistedProjectSidebarState(), []);
  const stableProjectItemsRef = React.useRef<Map<string, SidebarProjectItem>>(new Map());
  const [expandedProjectIds, setExpandedProjectIds] = React.useState<string[]>(
    () => persistedSidebarState.expandedProjectIds,
  );
  const [projectOrderIds, setProjectOrderIds] = React.useState<string[]>(
    () => persistedSidebarState.projectOrderIds,
  );
  const [isSyncingProject, setIsSyncingProject] = React.useState(false);
  const [projectPendingRename, setProjectPendingRename] = React.useState<SidebarProjectItem | null>(
    null,
  );
  const [renameValue, setRenameValue] = React.useState("");
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [isRenamingProject, setIsRenamingProject] = React.useState(false);
  const [projectPendingDelete, setProjectPendingDelete] = React.useState<SidebarProjectItem | null>(
    null,
  );
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [isDeletingProject, setIsDeletingProject] = React.useState(false);
  const updateProject = useMutation(api.projects.update);
  const archiveProject = useMutation(api.projects.archive);
  const restoreProject = useMutation(api.projects.restore);
  const deleteProject = useMutation(api.projects.deleteProject);
  const {
    relinkProjectWorkspace,
    closeProjectWorkspace,
  } = useProjectWorkspaceActions();

  const accessibleProjects = useQuery(
    api.projects.listForCurrentUser,
    convexUserId
      ? {
          userId: convexUserId,
        }
      : "skip",
  );

  const projectItems = React.useMemo<SidebarProjectItem[]>(() => {
    const source = accessibleProjects;
    if (!source) {
      return [];
    }

    const nextStableProjectMap = new Map<string, SidebarProjectItem>();

    const nextItems = source
      .filter((project): project is NonNullable<typeof project> => Boolean(project))
      .map((project) => {
        const nextProjectItem: SidebarProjectItem = {
          _id: project._id,
          id: String(project._id),
          name: project.name,
          status: project.status,
          template: project.template ?? null,
          slug: project.slug,
          updatedAt: project.updatedAt,
          createdBy: project.createdBy ?? null,
          localPath: project.localPath ?? null,
          sourceControl: project.sourceControl,
          gitRepository: project.gitRepository,
          importedFrom: project.importedFrom ?? null,
        };

        const previousProjectItem = stableProjectItemsRef.current.get(nextProjectItem.id);
        const stableProjectItem =
          previousProjectItem && areSidebarProjectItemsEqual(previousProjectItem, nextProjectItem)
            ? previousProjectItem
            : nextProjectItem;

        nextStableProjectMap.set(stableProjectItem.id, stableProjectItem);
        return stableProjectItem;
      });

    stableProjectItemsRef.current = nextStableProjectMap;
    return nextItems;
  }, [accessibleProjects]);

  React.useEffect(() => {
    if (projectItems.length === 0) return;

    const nextOrderedIds = buildOrderedProjects(projectItems, projectOrderIds).map(
      (project) => project.id,
    );
    if (areStringArraysEqual(projectOrderIds, nextOrderedIds)) return;
    setProjectOrderIds(nextOrderedIds);
  }, [projectItems, projectOrderIds]);

  const sortedProjects = React.useMemo(
    () => buildOrderedProjects(projectItems, projectOrderIds),
    [projectItems, projectOrderIds],
  );

  React.useEffect(() => {
    // Only prune expansion state for projects that actually disappeared. While
    // the projects query is still loading, projectItems is momentarily empty —
    // pruning then wiped (and persisted) the expansion list, which made the
    // sidebar auto-collapse everything on every launch.
    if (accessibleProjects === undefined) {
      return;
    }
    const nextProjectIdSet = new Set(projectItems.map((project) => project.id));

    setExpandedProjectIds((current) => {
      const filtered = current.filter((projectId) => nextProjectIdSet.has(projectId));
      return areStringArraysEqual(current, filtered) ? current : filtered;
    });

  }, [accessibleProjects, projectItems]);

  React.useEffect(() => {
    if (currentProjectId) {
      setExpandedProjectIds((current) => {
        if (current.includes(currentProjectId)) return current;
        return [...current, currentProjectId];
      });
    }
  }, [currentProjectId]);

  React.useEffect(() => {
    writePersistedProjectSidebarState({
      expandedProjectIds,
      projectOrderIds,
    } satisfies PersistedProjectSidebarState);
  }, [expandedProjectIds, projectOrderIds]);

  const currentProjectItem = React.useMemo(
    () => sortedProjects.find((project) => project.id === currentProjectId) ?? null,
    [currentProjectId, sortedProjects],
  );
  const currentCollabBranch = React.useMemo(
    () => (currentProjectItem ? resolveProjectCollabBranch(currentProjectItem) : "main"),
    [currentProjectItem],
  );
  const {
    laneState: currentLaneState,
    activeLane: currentActiveLane,
  } = useProjectLaneState({
    projectId: currentProjectId,
    workspaceId: currentWorkspaceId,
    collabBranch: currentCollabBranch,
  });
  const displayedCurrentLaneState = projectRouteContext?.laneState ?? currentLaneState;
  const displayedCurrentActiveLane = projectRouteContext?.activeLane ?? currentActiveLane;
  const currentVisibleActiveTileId = useProjectWorkbenchStore(
    React.useMemo(
      () =>
        selectVisibleActiveWorkbenchTileId(
          currentProjectId,
          displayedCurrentActiveLane?.id ?? null,
          displayedCurrentActiveLane?.workspaceId ?? currentWorkspaceId,
        ),
      [
        displayedCurrentActiveLane?.id,
        displayedCurrentActiveLane?.workspaceId,
        currentProjectId,
        currentWorkspaceId,
      ],
    ),
  );

  const toggleExpandedProject = React.useCallback((projectId: string) => {
    setExpandedProjectIds((current) => {
      return current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId];
    });
  }, []);

  const moveProject = React.useCallback(
    (projectId: string, direction: "up" | "down") => {
      setProjectOrderIds((current) => {
        const ensuredOrder = buildOrderedProjects(projectItems, current).map(
          (project) => project.id,
        );
        const index = ensuredOrder.indexOf(projectId);
        if (index === -1) return ensuredOrder;

        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= ensuredOrder.length) return ensuredOrder;

        const next = [...ensuredOrder];
        const [moved] = next.splice(index, 1);
        next.splice(targetIndex, 0, moved);
        return next;
      });
    },
    [projectItems],
  );

  const openLaneWorkbench = React.useCallback(
    async (
      project: SidebarProjectItem,
      laneId: string,
      options?: {
        openTile?: "assistantChat" | "terminal";
        focusTileId?: string;
        workspaceId?: string | null;
      },
    ) => {
      const workbenchStore = useProjectWorkbenchStore.getState();
      const workbenchWorkspaceId =
        options?.workspaceId ??
        (project.id === currentProjectId
          ? (displayedCurrentActiveLane?.workspaceId ?? currentWorkspaceId)
          : null);
      workbenchStore.actions.ensureWorkbench(project.id, laneId, workbenchWorkspaceId);

      const ensuredWorkbench = selectProjectWorkbench(
        project.id,
        laneId,
        workbenchWorkspaceId,
      )(useProjectWorkbenchStore.getState());

      let nextOptions = options;
      if (!options?.openTile && !options?.focusTileId && ensuredWorkbench) {
        const hasVisibleTiles = ensuredWorkbench.order.some((tileId) => {
          const tile = ensuredWorkbench.tiles[tileId];
          return tile && tile.type !== "selection";
        });

        if (!hasVisibleTiles) {
          const selectionTileId =
            ensuredWorkbench.order.find(
              (tileId) => ensuredWorkbench.tiles[tileId]?.type === "selection",
            ) ?? null;

          if (selectionTileId) {
            nextOptions = { focusTileId: selectionTileId };
          }
        }
      }

      // Same project, same lane, already on the workbench route: apply the tile
      // intent directly on the store. Routing it through the URL would run two
      // to three router transitions per click (param navigation plus the sync
      // hook's cleanup replaces) and re-push every dockview portal root. This
      // mirrors what useProjectWorkbenchSearchParamSync would do with the params.
      const isSameWorkbenchView =
        project.id === currentProjectId &&
        displayedCurrentActiveLane?.id === laneId &&
        pathname === `${buildProjectPath(project.id)}/workbench`;
      if (isSameWorkbenchView) {
        if (nextOptions?.focusTileId) {
          workbenchStore.actions.setActiveTile(
            project.id,
            laneId,
            nextOptions.focusTileId,
            workbenchWorkspaceId,
          );
          return;
        }
        if (nextOptions?.openTile) {
          workbenchStore.actions.addTile(
            project.id,
            laneId,
            nextOptions.openTile,
            undefined,
            workbenchWorkspaceId,
          );
          return;
        }
        return;
      }

      // Clean URL; the intent rides navigation state. The search-param flow
      // remains only for external deep links (see lib/workbenchIntent.ts).
      navigate(`${buildProjectPath(project.id)}/workbench`, {
        state: {
          ...buildProjectRouteNavigationState({
            projectId: project.id,
            projectSlug: project.slug,
            projectName: project.name,
            preferredWorkspaceId: workbenchWorkspaceId,
          }),
          ...buildWorkbenchIntentState({
            laneId,
            ...(nextOptions?.openTile ? { openTile: nextOptions.openTile } : {}),
            ...(nextOptions?.focusTileId ? { focusTileId: nextOptions.focusTileId } : {}),
          }),
        },
      });
    },
    [
      displayedCurrentActiveLane?.id,
      displayedCurrentActiveLane?.workspaceId,
      currentProjectId,
      currentWorkspaceId,
      navigate,
      pathname,
    ],
  );

  const handleSyncCurrentProject = React.useCallback(async () => {
    if (!projectSyncContext?.workspaceId) {
      return;
    }

    setIsSyncingProject(true);
    try {
      await projectSyncContext.triggerSync();
    } finally {
      setIsSyncingProject(false);
    }
  }, [projectSyncContext]);

  const isProjectsLoading = Boolean(convexUserId) && accessibleProjects === undefined;
  const currentWorkbenchPath = currentProjectId
    ? `${buildProjectPath(currentProjectId)}/workbench`
    : null;
  const currentProjectSettingsBasePath = currentProjectId
    ? `${buildProjectPath(currentProjectId)}/settings`
    : null;
  const {
    isOnCurrentProjectSubMenu,
    isOnCurrentProjectSettings,
    currentProjectSettingsSection,
    currentSelectionLevel,
  } = React.useMemo(
    () =>
      getProjectSidebarRouteState({
        pathname: pathname,
        currentProjectId,
        currentWorkbenchPath,
        currentProjectSettingsBasePath,
        currentVisibleActiveTileId,
      }),
    [
      currentProjectId,
      currentProjectSettingsBasePath,
      currentVisibleActiveTileId,
      currentWorkbenchPath,
      pathname,
    ],
  );

  const handleOpenProjectSettings = React.useCallback(
    (project: SidebarProjectItem) => {
      navigate(`${buildProjectPath(project.id)}/workbench?settings=1`);
    },
    [navigate],
  );

  const handleOpenMarketplace = React.useCallback(() => {
    navigate("/projects/store");
  }, [navigate]);

  const isOnAppStore = pathname === "/projects/store";

  const { isMobile, state, openMobile } = useSidebar();
  const showInSidebarSidebarTrigger = isMobile ? openMobile : state === "expanded";

  const handleOpenProject = React.useCallback(
    async (project: SidebarProjectItem, workspaceId: string | null) => {
      navigate(buildProjectPath(project.id, "workbench"), {
        state: buildProjectRouteNavigationState({
          projectId: project.id,
          projectSlug: project.slug,
          projectName: project.name,
          preferredWorkspaceId: workspaceId,
        }, {
          projectTemplate: project.template ?? undefined,
        }),
      });
    },
    [navigate],
  );

  const handleOpenProjectFolder = React.useCallback(
    async (project: SidebarProjectItem) => {
      try {
        const workspace = await window.electronAPI.workspace!.getActiveForProject(project.id);

        if (!workspace) {
          throw new Error("Project folder is not available on this device.");
        }

        const result = await window.electronAPI.project.openFolder({
          workspaceId: workspace.workspaceId,
        });

        if (!result.success) {
          throw new Error(result.error || "Failed to open project folder.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open project folder.";

        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          title: "Open Folder Failed",
          message: "Failed to open project folder",
          detail: message,
        });
      }
    },
    [],
  );

  const handleRelinkProjectWorkspace = React.useCallback(
    async (project: SidebarProjectItem, workspaceId: string | null) => {
      await relinkProjectWorkspace(project, workspaceId);
    },
    [relinkProjectWorkspace],
  );

  const handleCloseProjectWorkspace = React.useCallback(
    async (project: SidebarProjectItem, workspaceId: string | null) => {
      await closeProjectWorkspace(project, workspaceId, { replace: true });
    },
    [closeProjectWorkspace],
  );

  const handleStartRenameProject = React.useCallback((project: SidebarProjectItem) => {
    setProjectPendingRename(project);
    setRenameValue(project.name);
    setRenameError(null);
  }, []);

  const handleConfirmRenameProject = React.useCallback(
    async (nextName: string) => {
      if (!projectPendingRename || !convexUserId || isRenamingProject) return;

      const trimmedName = nextName.trim();
      if (!trimmedName || trimmedName === projectPendingRename.name) return;

      setIsRenamingProject(true);
      setRenameError(null);
      try {
        await updateProject({
          projectId: projectPendingRename._id,
          userId: convexUserId,
          name: trimmedName,
        });
        setProjectPendingRename(null);
      } catch (error) {
        const presentation = formatProjectRenameError(error);
        setRenameError(
          presentation.detail
            ? `${presentation.message} ${presentation.detail}`
            : presentation.message,
        );
      } finally {
        setIsRenamingProject(false);
      }
    },
    [convexUserId, isRenamingProject, projectPendingRename, updateProject],
  );

  const handleArchiveProject = React.useCallback(
    async (project: SidebarProjectItem) => {
      if (!convexUserId) return;

      const result = await window.electronAPI.dialog.showMessageBox({
        type: "warning",
        buttons: ["Cancel", "Archive Project"],
        defaultId: 0,
        cancelId: 0,
        title: "Archive Project",
        message: `Archive ${project.name}?`,
        detail: "The project will be hidden from active views and can be restored later.",
      });

      if (result.response !== 1) {
        return;
      }

      try {
        await archiveProject({
          projectId: project._id,
          userId: convexUserId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to archive project";
        const cleanMessage = message
          .replace(/^\[CONVEX.*?\]\s*/, "")
          .replace(/\s*Called by client$/, "");
        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          title: "Archive Failed",
          message: "Failed to archive project",
          detail: cleanMessage,
        });
      }
    },
    [archiveProject, convexUserId],
  );

  const handleRestoreProject = React.useCallback(
    async (project: SidebarProjectItem) => {
      if (!convexUserId) return;

      const result = await window.electronAPI.dialog.showMessageBox({
        type: "question",
        buttons: ["Cancel", "Restore Project"],
        defaultId: 1,
        cancelId: 0,
        title: "Restore Project",
        message: `Restore ${project.name}?`,
        detail: "The project will return to active views.",
      });

      if (result.response !== 1) {
        return;
      }

      try {
        await restoreProject({
          projectId: project._id,
          userId: convexUserId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to restore project";
        const cleanMessage = message
          .replace(/^\[CONVEX.*?\]\s*/, "")
          .replace(/\s*Called by client$/, "");
        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          title: "Restore Failed",
          message: "Failed to restore project",
          detail: cleanMessage,
        });
      }
    },
    [convexUserId, restoreProject],
  );

  const handleStartDeleteProject = React.useCallback((project: SidebarProjectItem) => {
    setProjectPendingDelete(project);
    setDeleteError(null);
  }, []);

  const handleConfirmDeleteProject = React.useCallback(
    async ({ keepLocalFiles }: ProjectDeleteConfirmOptions) => {
      if (!projectPendingDelete || !convexUserId || isDeletingProject) {
        return;
      }

      setIsDeletingProject(true);
      setDeleteError(null);
      const deletedProject = projectPendingDelete;
      const deletedProjectId = String(deletedProject._id);
      try {
        await withProjectMutationTimeout(
          deleteProject({
            projectId: deletedProject._id,
            userId: convexUserId,
            // Server still validates the name; UI no longer requires retyping it.
            confirmName: deletedProject.name,
          }),
          "Deleting this project is taking longer than expected. Check your connection and try again.",
        );

        // Detach + leave the dead route before local disk cleanup so the
        // workbench cannot keep hosting a deleted project.
        detachDeletedProjectFromUi(deletedProjectId);
        setProjectPendingDelete(null);
        navigate("/projects", { replace: true });

        await cleanupDeletedProjectLocally(deletedProjectId, {
          projectName: deletedProject.name,
          projectSlug: deletedProject.slug,
          managedProjectPaths: [deletedProject.localPath],
          keepLocalFiles,
        });
      } catch (error) {
        const presentation = formatProjectDeleteError(error);
        setDeleteError(
          presentation.detail
            ? `${presentation.message} ${presentation.detail}`
            : presentation.message,
        );
      } finally {
        setIsDeletingProject(false);
      }
    },
    [convexUserId, deleteProject, isDeletingProject, navigate, projectPendingDelete],
  );

  const handleSyncProject = React.useCallback(
    async (project: SidebarProjectItem) => {
      if (!currentProjectItem || currentProjectItem.id !== project.id) {
        return;
      }
      await handleSyncCurrentProject();
    },
    [currentProjectItem, handleSyncCurrentProject],
  );

  return (
    <>
      <Sidebar
        collapsible="offcanvas"
        windowChromeAware
        windowChromeEndAddon={
          showInSidebarSidebarTrigger ? (
            <SidebarTrigger
              className={cn(
                "h-7 w-7 shrink-0 rounded-md",
                "text-muted-foreground/75 hover:bg-sidebar-accent hover:text-foreground",
              )}
            />
          ) : null
        }
        rootClassName={cn("h-full min-w-0 overflow-hidden", className)}
        rootStyle={{ "--sidebar-width": "14rem" } as React.CSSProperties}
        className="h-full min-w-0 z-20 sidebar-glass"
        {...props}
      >
        <SidebarContent className="gap-0 px-2 py-3">
          {!isOnCurrentProjectSubMenu && (
            <div className="mb-4 space-y-1">
              <button
                type="button"
                className={cn(
                  SIDEBAR_NAV_ROW_BUTTON_CLASS,
                  "px-1.5",
                  "[&>svg]:text-current",
                )}
                onClick={(event) => void openProjectCreationMenu(event)}
              >
                <HugeiconsIcon icon={__FolderAddHugeIcon} />
                <span className="truncate">{t('nav.newProject')}</span>
              </button>
              <button
                type="button"
                className={cn(
                  SIDEBAR_NAV_ROW_BUTTON_CLASS,
                  "px-1.5",
                  isOnAppStore && SIDEBAR_PILL_ACTIVE_CLASS,
                  "[&>svg]:text-current",
                )}
                onClick={handleOpenMarketplace}
              >
                <HugeiconsIcon icon={__ShoppingBagHugeIcon} />
                <span className="truncate">{t('nav.devAppsStore')}</span>
              </button>
            </div>
          )}

          <div className="mb-3">
            <div className={SIDEBAR_GROUP_LABEL_CLASS}>
              {isOnCurrentProjectSettings ? t('projects.projectSettings') : t('projects.projects')}
            </div>
          </div>

          <div className="space-y-1">
            {isOnCurrentProjectSettings && currentProjectId ? (
              PROJECT_SETTINGS_SECTIONS.map((section) => {
                const isActive = currentProjectSettingsSection === section.id;
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    className={cn(SIDEBAR_NAV_ROW_BUTTON_CLASS, isActive && SIDEBAR_PILL_ACTIVE_CLASS)}
                    onClick={() => {
                      navigate(`${buildProjectPath(currentProjectId)}/settings/${section.id}`);
                    }}
                  >
                    <Icon />
                    <span className="truncate">{section.label}</span>
                  </button>
                );
              })
            ) : isProjectsLoading ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {t('projects.projectsSyncing')}
              </div>
            ) : sortedProjects.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {t('projects.createToGetStarted')}
              </div>
            ) : (
              sortedProjects.map((project, index) => (
                <ProjectSidebarTreeItem
                  key={project.id}
                  project={project}
                  projectIndex={index}
                  projectCount={sortedProjects.length}
                  selection={{
                    isExpanded: expandedProjectIds.includes(project.id),
                    activeSelectionLevel:
                      project.id === currentProjectId ? currentSelectionLevel : "none",
                    activeTileId:
                      project.id === currentProjectId ? currentVisibleActiveTileId : null,
                  }}
                  context={{
                    isCurrentProject: project.id === currentProjectId,
                    currentWorkspaceId:
                      project.id === currentProjectId ? currentWorkspaceId : null,
                    isSyncingProject: project.id === currentProjectId && isSyncingProject,
                    prefetchedLaneState:
                      project.id === currentProjectId ? displayedCurrentLaneState : undefined,
                    prefetchedActiveLane:
                      project.id === currentProjectId ? displayedCurrentActiveLane : undefined,
                  }}
                  actions={{
                    toggleExpanded: toggleExpandedProject,
                    openProject: handleOpenProject,
                    openProjectFolder: handleOpenProjectFolder,
                    openProjectSettings: handleOpenProjectSettings,
                    renameProject: handleStartRenameProject,
                    archiveProject: handleArchiveProject,
                    restoreProject: handleRestoreProject,
                deleteProject: handleStartDeleteProject,
                relinkProjectWorkspace: handleRelinkProjectWorkspace,
                closeProjectWorkspace: handleCloseProjectWorkspace,
                syncProject: handleSyncProject,
                moveProject,
                openLaneWorkbench,
                  }}
                />
              ))
            )}
          </div>
        </SidebarContent>

        <SidebarSeparator />

        <SidebarFooter className="gap-3 p-3">
          {isOnCurrentProjectSubMenu && currentProjectId ? (
            <Button
              type="button"
              variant="ghost"
              className="h-7 w-full justify-start gap-2 rounded-md px-2 text-xs font-normal"
              onClick={() => navigate(`${buildProjectPath(currentProjectId)}/workbench`)}
            >
              <HugeiconsIcon icon={__ArrowLeftHugeIcon} className="size-3.5 shrink-0 text-muted-foreground/80" />
              Back to workbench
            </Button>
          ) : (
            <div>
              <NavUser user={user} />
            </div>
          )}
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>
      {projectPendingRename ? (
        <React.Suspense fallback={null}>
          <LazyProjectRenameDialog
            open
            onOpenChange={(open) => {
              if (!open && !isRenamingProject) {
                setProjectPendingRename(null);
                setRenameError(null);
              }
            }}
            currentName={projectPendingRename.name}
            value={renameValue}
            onValueChange={setRenameValue}
            onConfirm={handleConfirmRenameProject}
            isSaving={isRenamingProject}
            errorMessage={renameError}
          />
        </React.Suspense>
      ) : null}
      {projectPendingDelete ? (
        <React.Suspense fallback={null}>
          <LazyProjectDeleteDialog
            open
            onOpenChange={(open) => {
              if (!open && !isDeletingProject) {
                setProjectPendingDelete(null);
                setDeleteError(null);
              }
            }}
            projectName={projectPendingDelete.name}
            onConfirm={handleConfirmDeleteProject}
            isDeleting={isDeletingProject}
            errorMessage={deleteError}
          />
        </React.Suspense>
      ) : null}
    </>
  );
}

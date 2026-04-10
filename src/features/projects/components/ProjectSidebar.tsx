"use client";

import * as React from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowPathIcon as Loader2,
  PlusIcon,
} from "@heroicons/react/24/outline"

import { useViewTransitionNavigate } from "@/lib/navigation";
import { useLocation } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useScopedAppContext } from "@/hooks/useScopedAppContext";
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
} from "@/components/ui/sidebar";
import { NavUser } from "@/components/nav-user";
import { Button } from "@/components/ui/button";
import { buildProjectPath } from "../lib/projectRoutes";
import { buildWorkbenchHref } from "../lib/lastWorkbenchRoute";
import { prepareGitProjectForOpen } from "../lib/projectOpenGitSync";
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
import { formatProjectCloudAccessError } from "../lib/projectCloudAccessPresentation";
import {
  formatProjectDeleteError,
  formatProjectRenameError,
} from "../lib/projectMutationPresentation";
import {
  buildWorkbenchScopeKey,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore";
import { primeLocalProjectPath } from "@/features/projects/hooks/useLocalProjectPath";
import { ProjectDeleteDialog } from "./ProjectDeleteDialog";
import { ProjectRenameDialog } from "./ProjectRenameDialog";

interface ProjectSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user?: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  } | null;
  onLogout?: () => void;
  projectId?: Id<"projects"> | null;
  presenceUsers?: unknown[];
  presenceCount?: number;
}

export function ProjectSidebar({
  user,
  onLogout,
  projectId: providedProjectId,
  presenceUsers: _presenceUsers,
  presenceCount: _presenceCount,
  className,
  ...props
}: ProjectSidebarProps) {
  const convex = useConvex();
  const navigate = useViewTransitionNavigate();
  const location = useLocation();
  const { openProjectCreationMenu } = useProjectCreationMenu();
  const { convexUserId } = useAuth();
  const { personalScoped, convexOrganizationId, workspaceScoped } = useScopedAppContext();
  const { project: currentProject, projectIdParam } = useAccessibleProject();
  const projectSyncContext = useOptionalProjectSyncContext();
  const currentProjectId = providedProjectId
    ? String(providedProjectId)
    : currentProject?._id
      ? String(currentProject._id)
      : projectIdParam;
  const currentProjectPath = projectSyncContext?.projectPath ?? null;
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
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath);

  const organizationProjects = useQuery(
    api.projects.listForOrganization,
    !personalScoped && convexOrganizationId && convexUserId
      ? {
          organizationId: convexOrganizationId,
          userId: convexUserId,
        }
      : "skip",
  );
  const personalProjects = useQuery(
    api.projects.listForPersonalWorkspaceMemberView,
    personalScoped && convexUserId
      ? {
          userId: convexUserId,
        }
      : "skip",
  );

  const projectItems = React.useMemo<SidebarProjectItem[]>(() => {
    const source = personalScoped ? personalProjects : organizationProjects;
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
          organizationId: project.organizationId,
          createdBy: project.createdBy ?? null,
          syncMode: project.syncMode,
          localPath: project.localPath ?? null,
          sourceControl: project.sourceControl,
          gitRepository: project.gitRepository,
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
  }, [organizationProjects, personalProjects, personalScoped]);

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
    const nextProjectIdSet = new Set(projectItems.map((project) => project.id));

    setExpandedProjectIds((current) => {
      const filtered = current.filter((projectId) => nextProjectIdSet.has(projectId));
      return areStringArraysEqual(current, filtered) ? current : filtered;
    });

  }, [projectItems]);

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
    projectPath: currentProjectPath,
    collabBranch: currentCollabBranch,
  });
  const currentVisibleActiveTileId = useProjectWorkbenchStore(
    React.useMemo(
      () => (state) => {
        if (!currentProjectId) return null;
        const scopeKey = buildWorkbenchScopeKey(currentProjectId, currentActiveLane?.id ?? null);
        const workbench = state.workbenches[scopeKey] ?? null;
        if (!workbench?.activeTileId) return null;
        const activeTile = workbench.tiles[workbench.activeTileId];
        return activeTile && activeTile.type !== "selection" ? activeTile.id : null;
      },
      [currentActiveLane?.id, currentProjectId],
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
        openTile?: "assistantChat" | "browser" | "terminal" | "devServer";
        focusTileId?: string;
      },
    ) => {
      const workbenchStore = useProjectWorkbenchStore.getState();
      workbenchStore.actions.ensureWorkbench(project.id, laneId);

      const ensuredWorkbench =
        useProjectWorkbenchStore.getState().workbenches[
          buildWorkbenchScopeKey(project.id, laneId)
        ] ?? null;

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

      try {
        await window.electronAPI.project.setActiveLane({
          projectId: project.id,
          laneId,
        });
      } catch (error) {
        console.warn("[ProjectSidebar] Failed to switch lane", error);
      }

      navigate(buildWorkbenchHref(project.id, laneId, nextOptions));
    },
    [navigate],
  );

  const handleSyncCurrentProject = React.useCallback(async () => {
    if (!projectSyncContext?.projectPath) {
      return;
    }

    setIsSyncingProject(true);
    try {
      await projectSyncContext.triggerSync();
    } finally {
      setIsSyncingProject(false);
    }
  }, [projectSyncContext]);

  const isProjectsLoading =
    (personalScoped && personalProjects === undefined) ||
    (!personalScoped && convexOrganizationId && organizationProjects === undefined);
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
        pathname: location.pathname,
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
      location.pathname,
    ],
  );

  const handleOpenProjectSettings = React.useCallback(
    (project: SidebarProjectItem) => {
      navigate(`${buildProjectPath(project.id)}/workbench?settings=1`);
    },
    [navigate],
  );

  const handleOpenProject = React.useCallback(
    async (project: SidebarProjectItem, localPath: string | null) => {
      try {
        const gitOpenResult = await prepareGitProjectForOpen({
          convex,
          project,
          localPath,
          userId: convexUserId,
          updateMemberLocalPath: convexUserId ? updateMemberLocalPath : undefined,
        });

        if (gitOpenResult.cancelled) {
          if (gitOpenResult.needsConflictResolution) {
            primeLocalProjectPath(project.id, gitOpenResult.localPath, project.slug);
            navigate(buildProjectPath(project.id, "conflicts"), {
              state: {
                projectId: project.id,
                projectSlug: project.slug,
                projectName: project.name,
                projectTemplate: project.template ?? undefined,
                localPath: gitOpenResult.localPath,
                syncMode: "git",
              },
            });
          }
          return;
        }

        primeLocalProjectPath(project.id, gitOpenResult.localPath, project.slug);
        navigate(buildProjectPath(project.id, "workbench"), {
          state: {
            projectId: project.id,
            projectSlug: project.slug,
            projectName: project.name,
            projectTemplate: project.template ?? undefined,
            localPath: gitOpenResult.localPath,
            syncMode: "git",
          },
        });
      } catch (error) {
        const presentation = formatProjectCloudAccessError(error, "Failed to prepare project", {
          workspaceScoped,
        });
        const response = await window.electronAPI.dialog.showMessageBox({
          type: presentation.isAccessError ? "warning" : "error",
          buttons: presentation.actionHref
            ? ["OK", presentation.actionLabel ?? "Open Settings"]
            : ["OK"],
          defaultId: 0,
          cancelId: 0,
          title: presentation.summary,
          message: presentation.summary,
          detail: presentation.detail ?? "",
          noLink: true,
        });

        if (presentation.actionHref && response.response === 1) {
          navigate(presentation.actionHref);
        }
      }
    },
    [convex, convexUserId, navigate, updateMemberLocalPath, workspaceScoped],
  );

  const handleOpenProjectFolder = React.useCallback(
    async (project: SidebarProjectItem, localPath: string | null) => {
      try {
        const resolvedLocalPath =
          localPath ??
          (await window.electronAPI.project.getLocalPath({
            slug: project.slug,
            projectId: project.id,
          }));

        if (!resolvedLocalPath) {
          throw new Error("Project folder is not available on this device.");
        }

        primeLocalProjectPath(project.id, resolvedLocalPath, project.slug);

        const result = await window.electronAPI.project.openFolder({
          projectPath: resolvedLocalPath,
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
    async (confirmName: string) => {
      if (
        !projectPendingDelete ||
        !convexUserId ||
        isDeletingProject ||
        confirmName !== projectPendingDelete.name
      ) {
        return;
      }

      setIsDeletingProject(true);
      setDeleteError(null);
      try {
        await deleteProject({
          projectId: projectPendingDelete._id,
          userId: convexUserId,
          confirmName,
        });
        setProjectPendingDelete(null);
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
    [convexUserId, deleteProject, isDeletingProject, projectPendingDelete],
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
        rootClassName={cn("h-full min-w-0 overflow-hidden", className)}
        rootStyle={{ "--sidebar-width": "14rem" } as React.CSSProperties}
        className="h-full min-w-0 z-20 sidebar-glass"
        {...props}
      >
        <SidebarContent className="gap-0 px-2 py-3">
          {!isOnCurrentProjectSubMenu && (
            <div className="mb-4 space-y-1 px-1">
              <button
                type="button"
                className={SIDEBAR_NAV_ROW_BUTTON_CLASS}
                onClick={(event) => void openProjectCreationMenu(event)}
              >
                <PlusIcon />
                <span className="truncate">New project</span>
              </button>
            </div>
          )}

          <div className="mb-3">
            <div className={SIDEBAR_GROUP_LABEL_CLASS}>
              {isOnCurrentProjectSettings ? "Project Settings" : "Projects"}
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
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Loading projects…
              </div>
            ) : sortedProjects.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No projects in this workspace yet
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
                    currentProjectPath:
                      project.id === currentProjectId ? currentProjectPath : null,
                    isSyncingProject: project.id === currentProjectId && isSyncingProject,
                    prefetchedLaneState:
                      project.id === currentProjectId ? currentLaneState : undefined,
                    prefetchedActiveLane:
                      project.id === currentProjectId ? currentActiveLane : undefined,
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
              className="h-8 w-full justify-start gap-2 rounded-md px-2 text-xs font-normal"
              onClick={() => navigate(`${buildProjectPath(currentProjectId)}/workbench`)}
            >
              <ArrowLeft className="size-3.5 shrink-0 text-muted-foreground/80" />
              Back to workbench
            </Button>
          ) : (
            <div>
              <NavUser user={user} onLogout={onLogout} />
            </div>
          )}
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>
      <ProjectRenameDialog
        open={projectPendingRename !== null}
        onOpenChange={(open) => {
          if (!open && !isRenamingProject) {
            setProjectPendingRename(null);
            setRenameError(null);
          }
        }}
        currentName={projectPendingRename?.name ?? ""}
        value={renameValue}
        onValueChange={setRenameValue}
        onConfirm={handleConfirmRenameProject}
        isSaving={isRenamingProject}
        errorMessage={renameError}
      />
      <ProjectDeleteDialog
        open={projectPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingProject) {
            setProjectPendingDelete(null);
            setDeleteError(null);
          }
        }}
        projectName={projectPendingDelete?.name ?? ""}
        onConfirm={handleConfirmDeleteProject}
        isDeleting={isDeletingProject}
        errorMessage={deleteError}
      />
    </>
  );
}

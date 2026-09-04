

import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon as __Add01HugeIcon,
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  Search01Icon as __SearchHugeIcon,
  ShoppingBag01Icon as __ShoppingBagHugeIcon,
} from '@hugeicons/core-free-icons'

import * as React from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { api } from "../../../../../../convex/_generated/api";

import { useViewTransitionNavigate } from "@/lib/navigation";
import { useLocation } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  publishOrgDevAppFromWorkspace,
  type OrgDevAppPublishStage,
} from "@/features/devapps/orgDevAppPublishing";
import { useAccessibleProject } from "@/contexts/project/useAccessibleProject";
import { useWindowChrome } from "@/hooks/useWindowChrome";
import { useOptionalProjectSyncContext } from "@/contexts/project/ProjectSyncContext";
import { useProjectLaneState } from "@/features/workbench/hooks/useProjectLaneState";
import { useProjectCreationMenu } from "@/features/projects/hooks/useProjectCreationMenu";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useTranslation } from "@/lib/i18n";
import { featureFlags } from "@/lib/featureFlags";
import { NavUser } from "@/components/nav-user";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { buildProjectPath } from "@/contexts/project/projectRoutes";
import { buildWorkbenchIntentState } from "@/features/workbench/model/workbenchIntent";
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState";
import { ProjectSidebarTreeItem } from "@/features/projects/ui/sidebar/ProjectSidebarTreeItem";
import {
  areSidebarProjectItemsEqual,
  resolveProjectCollabBranch,
  canReuseProjectDevAppLogo,
  SIDEBAR_GROUP_LABEL_CLASS,
  SIDEBAR_NAV_ROW_BUTTON_CLASS,
  SIDEBAR_PILL_ACTIVE_CLASS,
  type SidebarDevAppPublishMode,
  type SidebarProjectItem,
} from "@/features/projects/ui/sidebar/projectSidebarShared";
import {
  getProjectSidebarRouteState,
  PROJECT_SETTINGS_SECTIONS,
} from "@/features/projects/ui/sidebar/projectSidebarRoutes";
import {
  areStringArraysEqual,
  buildOrderedProjects,
  readPersistedProjectSidebarState,
  type PersistedProjectSidebarState,
  writePersistedProjectSidebarState,
} from "@/features/projects/ui/sidebar/projectSidebarState";
import {
  formatProjectDeleteError,
  formatProjectRenameError,
} from "../lib/projectMutationPresentation";
import { cleanupDeletedProjectLocally } from "@/features/projects/lib/projectLocalCleanup";
import { detachDeletedProjectFromUi } from "@/features/projects/lib/detachDeletedProjectFromUi";
import type { ProjectDeleteConfirmOptions } from "@/features/projects/ui/ProjectDeleteDialog";
import { withProjectMutationTimeout } from "@/features/projects/lib/projectMutationTimeout";
import {
  selectProjectWorkbench,
  selectVisibleActiveWorkbenchTileId,
  useProjectWorkbenchStore,
} from "@/lib/workbenchStore";
import { useOptionalProjectRouteContext } from "@/contexts/project/ProjectRouteContext";
import { useWorkspaceIdentity } from "@/contexts/workspace/useWorkspaceIdentity";
import { useProjectWorkspaceActions } from "@/features/workspace/hooks/useProjectWorkspaceActions";
import { openCommandPalette } from "@/features/workbench/command-palette/commandPaletteBus";

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
const LazyProjectDevAppLogoDialog = React.lazy(() =>
  import("@/features/devapps/components/ProjectDevAppLogoDialog").then((module) => ({
    default: module.ProjectDevAppLogoDialog,
  })),
);
const LazyOrgAttachDialog = React.lazy(() =>
  import("@/features/projects/ui/OrgAttachDialog").then((module) => ({
    default: module.OrgAttachDialog,
  })),
);

/** Content-only: renders inside the persistent AppSidebarShell. */
interface ProjectSidebarProps {
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

interface PendingProjectDevAppLogo {
  project: SidebarProjectItem;
  workspaceId: string;
  mode: SidebarDevAppPublishMode;
}

interface PendingProjectOrgAttach {
  project: SidebarProjectItem;
  workspaceId: string;
  mode: SidebarDevAppPublishMode;
}

export function ProjectSidebar({
  user,
  projectId: providedProjectId,
  presenceUsers: _presenceUsers,
  presenceCount: _presenceCount,
}: ProjectSidebarProps) {
  const { t } = useTranslation();
  const { isMac } = useWindowChrome();
  const navigate = useViewTransitionNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { openProjectCreationMenu } = useProjectCreationMenu();
  const { convexUserId } = useAuth();
  const convex = useConvex();
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
  const [devAppPublishing, setDevAppPublishing] = React.useState<{
    projectId: string;
    projectName: string;
    mode: SidebarDevAppPublishMode;
    stage: OrgDevAppPublishStage | "cancelling";
  } | null>(null);
  const devAppPublishingRef = React.useRef(false);
  const devAppPublishAbortRef = React.useRef<AbortController | null>(null);
  const [projectPendingDevAppLogo, setProjectPendingDevAppLogo] =
    React.useState<PendingProjectDevAppLogo | null>(null);
  const [projectPendingOrgAttach, setProjectPendingOrgAttach] =
    React.useState<PendingProjectOrgAttach | null>(null);
  const updateProject = useMutation(api.projects.update);
  const archiveProject = useMutation(api.projects.archive);
  const restoreProject = useMutation(api.projects.restore);
  const deleteProject = useMutation(api.projects.deleteProject);
  const attachProjectToOrg = useMutation(api.organizations.attachProject);
  const createAndAttachProjectOrg = useMutation(api.organizations.createAndAttachProject);
  const {
    relinkProjectWorkspace,
    closeProjectWorkspace,
  } = useProjectWorkspaceActions();

  // Slim projection: the sidebar re-renders on every list push, so it
  // subscribes only to the fields it renders (no generatedPlan/buildContract).
  const accessibleProjects = useQuery(
    api.projects.listSummariesForCurrentUser,
    convexUserId
      ? {
          userId: convexUserId,
        }
      : "skip",
  );
  const publisherStatus = useQuery(
    api.devApps.listPublisherStatus,
    featureFlags.projectDevApps && convexUserId ? {} : "skip",
  );
  const projectDevAppStateByProjectId = React.useMemo(
    () =>
      new Map(
        (publisherStatus ?? []).map((entry) => [String(entry.projectId), entry] as const),
      ),
    [publisherStatus],
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
          sourceControl: project.sourceControl ?? undefined,
          gitRepository: project.gitRepository ?? undefined,
          importedFrom: project.importedFrom ?? null,
          organizationId: project.organizationId ?? null,
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

  const handleReorderProject = React.useCallback(
    (sourceProjectId: string, targetProjectId: string, position: "before" | "after") => {
      if (sourceProjectId === targetProjectId) return;
      setProjectOrderIds((current) => {
        const ensuredOrder = buildOrderedProjects(projectItems, current).map(
          (project) => project.id,
        );
        const sourceIndex = ensuredOrder.indexOf(sourceProjectId);
        if (sourceIndex === -1) return ensuredOrder;

        const next = [...ensuredOrder];
        next.splice(sourceIndex, 1);

        const targetIndex = next.indexOf(targetProjectId);
        if (targetIndex === -1) return ensuredOrder;

        const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
        next.splice(insertIndex, 0, sourceProjectId);
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
        openTile?: "assistantChat" | "devServer" | "terminal";
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

      let nextOptions = options;
      if (workbenchWorkspaceId) {
        // Only touch the store when the workspace scope is known. Ensuring or
        // writing tiles with a null scope creates orphan `project::lane`
        // benches whose tiles silently disappear once the real (workspace-
        // scoped) bench resolves.
        workbenchStore.actions.ensureWorkbench(project.id, laneId, workbenchWorkspaceId);

        const ensuredWorkbench = selectProjectWorkbench(
          project.id,
          laneId,
          workbenchWorkspaceId,
        )(useProjectWorkbenchStore.getState());

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
      }

      // Same project, same lane, already on the workbench route: apply the tile
      // intent directly on the store. Routing it through the URL would run two
      // to three router transitions per click (param navigation plus the sync
      // hook's cleanup replaces) and re-push every dockview portal root. This
      // mirrors what useProjectWorkbenchSearchParamSync would do with the params.
      // Requires a known workspace scope; before resolution the intent rides
      // navigation state instead and applies once the surface has the scope.
      const isSameWorkbenchView =
        Boolean(workbenchWorkspaceId) &&
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
          if (nextOptions.openTile === "devServer") {
            workbenchStore.actions.openSingletonTile(
              project.id,
              laneId,
              "devServer",
              undefined,
              workbenchWorkspaceId,
            );
          } else {
            workbenchStore.actions.addTile(
              project.id,
              laneId,
              nextOptions.openTile,
              undefined,
              workbenchWorkspaceId,
            );
          }
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

  const handlePublishDevApp = React.useCallback(
    async (
      project: SidebarProjectItem,
      workspaceId: string,
      mode: SidebarDevAppPublishMode,
      logoDataUrl: string,
    ) => {
      // Re-entrancy and feature gating stay silent; a missing account does not.
      // Signed out, the old combined guard dropped the click with no dialog and
      // no log, so Publish looked like it did nothing at all.
      if (!featureFlags.projectDevApps || devAppPublishingRef.current) return;
      if (!convexUserId) {
        console.warn("[orgDevApp] Publish blocked: no authenticated Convex user.");
        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          title: mode === "update" ? "DevApp Update Failed" : "DevApp Publish Failed",
          message: t("orgDevApp.publish.failed"),
          detail: t("orgDevApp.publish.needsAccount"),
        });
        return;
      }

      if (!project.organizationId) {
        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          title: mode === "update" ? "DevApp Update Failed" : "DevApp Publish Failed",
          message: t("orgDevApp.publish.failed"),
          detail: t("orgDevApp.publish.needsOrg"),
        });
        return;
      }

      devAppPublishingRef.current = true;
      const abortController = new AbortController();
      devAppPublishAbortRef.current = abortController;
      setDevAppPublishing({ projectId: project.id, projectName: project.name, mode, stage: "building" });
      try {
        await publishOrgDevAppFromWorkspace({
          convex,
          projectId: project._id,
          workspaceId,
          name: project.name,
          logoDataUrl,
          signal: abortController.signal,
          onStageChange: (stage) => {
            setDevAppPublishing((current) => current ? { ...current, stage } : current);
          },
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const fallback = t("orgDevApp.publish.failed");
        const detail = (error instanceof Error ? error.message : fallback)
          .replace(/^\[CONVEX.*?\]\s*/, "")
          .replace(/\s*Called by client$/, "");
        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          title: mode === "update" ? "DevApp Update Failed" : "DevApp Publish Failed",
          message: fallback,
          detail,
        });
      } finally {
        devAppPublishingRef.current = false;
        devAppPublishAbortRef.current = null;
        setDevAppPublishing(null);
      }
    },
    [convex, convexUserId, t],
  );

  const continuePublishAfterOrg = React.useCallback(
    async (project: SidebarProjectItem, workspaceId: string, mode: SidebarDevAppPublishMode) => {
      const existingLogo = projectDevAppStateByProjectId.get(project.id)?.logoDataUrl;
      if (!canReuseProjectDevAppLogo(mode, existingLogo)) {
        setProjectPendingDevAppLogo({ project, workspaceId, mode });
        return;
      }
      await handlePublishDevApp(project, workspaceId, mode, existingLogo);
    },
    [handlePublishDevApp, projectDevAppStateByProjectId],
  );

  const handleRequestPublishDevApp = React.useCallback(
    async (
      project: SidebarProjectItem,
      workspaceId: string | null,
      mode: SidebarDevAppPublishMode,
    ) => {
      if (!featureFlags.projectDevApps || devAppPublishingRef.current) return;
      if (!convexUserId) {
        console.warn("[orgDevApp] Publish request blocked: no authenticated Convex user.");
        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          title: mode === "update" ? "DevApp Update Failed" : "DevApp Publish Failed",
          message: t("orgDevApp.publish.failed"),
          detail: t("orgDevApp.publish.needsAccount"),
        });
        return;
      }

      if (!workspaceId) {
        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          title: mode === "update" ? "DevApp Update Failed" : "DevApp Publish Failed",
          message: t("orgDevApp.publish.failed"),
          detail: t("orgDevApp.publish.noFolder"),
        });
        return;
      }

      if (!project.organizationId) {
        setProjectPendingOrgAttach({ project, workspaceId, mode });
        return;
      }

      await continuePublishAfterOrg(project, workspaceId, mode);
    },
    [continuePublishAfterOrg, convexUserId, t],
  );

  const handleConfirmProjectDevAppLogo = React.useCallback(
    async (logoDataUrl: string) => {
      if (!projectPendingDevAppLogo) return;

      const { project, workspaceId, mode } = projectPendingDevAppLogo;
      setProjectPendingDevAppLogo(null);
      await handlePublishDevApp(project, workspaceId, mode, logoDataUrl);
    },
    [handlePublishDevApp, projectPendingDevAppLogo],
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
          keepLocalFiles,
          projectSlug: deletedProject.slug,
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
      <SidebarHeader className="gap-2 px-2 pt-2.5 pb-1.5">
        <div className="flex items-center justify-between px-1.5">
          <div className="flex items-baseline gap-1.5 select-none">
            <span className="text-lg font-semibold tracking-tight text-foreground">Cozea</span>
            <span className="text-lg font-normal tracking-tight text-muted-foreground/50">Alpha</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => openCommandPalette()}
          className="group flex h-8 w-full cursor-pointer items-center gap-2 rounded-search border border-border/50 bg-[var(--left-sidebar-search-surface)] px-2.5 text-xs text-muted-foreground transition-colors hover:border-border/80 hover:bg-muted/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={t('nav.search')}
        >
          <HugeiconsIcon icon={__SearchHugeIcon} className="size-3.5 shrink-0 text-muted-foreground/75 transition-colors group-hover:text-foreground" />
          <span className="font-normal">{t('nav.search')}</span>
          <kbd className="ml-auto pointer-events-none inline-flex select-none items-center font-mono text-[11px] font-normal text-muted-foreground/50 tracking-wider">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-2 py-2">
          {!isOnCurrentProjectSubMenu && (
            <div className="mb-4 space-y-1">
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

          <div className="mb-2.5 flex items-center justify-between pr-1.5">
            <div className={SIDEBAR_GROUP_LABEL_CLASS}>
              {isOnCurrentProjectSettings ? t('projects.projectSettings') : t('projects.projects')}
            </div>
            {!isOnCurrentProjectSettings ? (
              <button
                type="button"
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center p-0 text-muted-foreground/75 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
                onClick={(event) => void openProjectCreationMenu(event)}
                aria-label={t('nav.newProject')}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-4"
                >
                  <path d="M8 2.5v11" />
                  <path d="M2.5 8h11" />
                </svg>
              </button>
            ) : null}
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
              sortedProjects.map((project, index) => {
                const devAppState = projectDevAppStateByProjectId.get(project.id);
                const isPublishingDevApp = devAppPublishing?.projectId === project.id;

                return (
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
                      devAppPublicationState: isPublishingDevApp
                        ? "publishing"
                        : devAppState?.hasArtifact
                          ? "published"
                          : "unpublished",
                      devAppPublishingMode: isPublishingDevApp ? devAppPublishing.mode : null,
                      canPublishDevApp: featureFlags.projectDevApps && Boolean(convexUserId),
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
                      publishDevApp: handleRequestPublishDevApp,
                      renameProject: handleStartRenameProject,
                      archiveProject: handleArchiveProject,
                      restoreProject: handleRestoreProject,
                      deleteProject: handleStartDeleteProject,
                      relinkProjectWorkspace: handleRelinkProjectWorkspace,
                      closeProjectWorkspace: handleCloseProjectWorkspace,
                      syncProject: handleSyncProject,
                      moveProject,
                      reorderProject: handleReorderProject,
                      openLaneWorkbench,
                    }}
                  />
                );
              })
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
            projectId={String(projectPendingDelete._id)}
            projectName={projectPendingDelete.name}
            onConfirm={handleConfirmDeleteProject}
            isDeleting={isDeletingProject}
            errorMessage={deleteError}
          />
        </React.Suspense>
      ) : null}
      {projectPendingDevAppLogo ? (
        <React.Suspense fallback={null}>
          <LazyProjectDevAppLogoDialog
            open
            projectName={projectPendingDevAppLogo.project.name}
            mode={projectPendingDevAppLogo.mode}
            initialLogoDataUrl={
              projectDevAppStateByProjectId.get(projectPendingDevAppLogo.project.id)?.logoDataUrl
            }
            onOpenChange={(open) => {
              if (!open) {
                setProjectPendingDevAppLogo(null);
              }
            }}
            onConfirm={handleConfirmProjectDevAppLogo}
          />
        </React.Suspense>
      ) : null}
      {projectPendingOrgAttach ? (
        <React.Suspense fallback={null}>
          <LazyOrgAttachDialog
            open
            projectName={projectPendingOrgAttach.project.name}
            onOpenChange={(open) => {
              if (!open) {
                setProjectPendingOrgAttach(null);
              }
            }}
            onAttach={async (organizationId) => {
              if (!convexUserId || !projectPendingOrgAttach) return;
              const pending = projectPendingOrgAttach;
              await attachProjectToOrg({
                organizationId,
                projectId: pending.project._id,
              });
              setProjectPendingOrgAttach(null);
              await continuePublishAfterOrg(
                { ...pending.project, organizationId },
                pending.workspaceId,
                pending.mode,
              );
            }}
            onCreate={async (name) => {
              if (!convexUserId || !projectPendingOrgAttach) return;
              const pending = projectPendingOrgAttach;
              const created = await createAndAttachProjectOrg({
                projectId: pending.project._id,
                name,
              });
              setProjectPendingOrgAttach(null);
              await continuePublishAfterOrg(
                { ...pending.project, organizationId: created.organizationId },
                pending.workspaceId,
                pending.mode,
              );
            }}
          />
        </React.Suspense>
      ) : null}
      <Dialog open={Boolean(devAppPublishing)} onOpenChange={() => undefined}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {devAppPublishing?.mode === "update"
                ? t("orgDevApp.publish.updateTitle")
                : t("orgDevApp.publish.title")}
            </DialogTitle>
            <DialogDescription>
              {devAppPublishing?.projectName ?? "Preparing the project"}
            </DialogDescription>
          </DialogHeader>
          <Progress
            value={devAppPublishing ? ({
              building: 20,
              uploading: 50,
              verifying: 72,
              runtimeBuild: 82,
              publishing: 90,
              complete: 100,
              cancelling: 100,
            } as const)[devAppPublishing.stage] : 0}
            className="h-1.5"
          />
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {devAppPublishing ? ({
              building: t("orgDevApp.publish.building"),
              uploading: t("orgDevApp.publish.uploading"),
              verifying: t("orgDevApp.publish.verifying"),
              runtimeBuild: t("orgDevApp.publish.runtimeBuild"),
              publishing: t("orgDevApp.publish.activating"),
              complete: t("orgDevApp.publish.complete"),
              cancelling: t("orgDevApp.publish.cancelling"),
            } as const)[devAppPublishing.stage] : null}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!devAppPublishing || devAppPublishing.stage === "complete" || devAppPublishing.stage === "cancelling"}
              onClick={() => {
                setDevAppPublishing((current) => current ? { ...current, stage: "cancelling" } : current);
                devAppPublishAbortRef.current?.abort();
              }}
            >
              {t("orgDevApp.publish.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

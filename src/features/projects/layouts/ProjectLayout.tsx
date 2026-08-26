"use client";

import { lazy, Suspense, type ReactNode, useRef, useCallback, useEffect, useMemo,  } from "react";
import { Outlet, useLocation, useParams } from "@/lib/router";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useCachedQuery } from "@/stores/useQueryCache";
import { ProjectSidebar } from "../components/ProjectSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { UnifiedHeader } from "@/components/layouts/UnifiedHeader";
import { TerminalEventBridge } from "@/features/projects/components/TerminalEventBridge";
import { usePageContextStore } from "@/stores/usePageContextStore";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { ProjectSyncProvider } from "../contexts/ProjectSyncContext";
import { useProjectPresence } from "@/hooks/useProjectPresence";
import type { PresenceUser } from "@/hooks/useProjectPresence";
import { buildLegacyProjectPath, buildProjectPath } from "@/features/projects/lib/projectRoutes";
import { readLastWorkbenchRoute } from "@/features/projects/lib/lastWorkbenchRoute";
import { featureFlags } from "@/lib/featureFlags";
import { useProjectWorkspaceResolution } from "@/features/projects/workspaces/useProjectWorkspaceResolution";
import { WorkspaceRepairScreen } from "@/features/projects/workspaces/WorkspaceRepairScreen";
import { ActiveWorkspaceProvider } from "@/features/projects/workspaces/ActiveWorkspaceContext";
import {
  buildProjectRouteNavigationState,
  resolveTrustedProjectRouteNavigationState,
} from "@/features/projects/lib/projectNavigationState";
import { useProjectChromeHeader } from "@/features/projects/hooks/useProjectChromeHeader";
import { useProjectLaneState } from "@/features/projects/hooks/useProjectLaneState";
import { useDeferredActivation } from "@/hooks/useDeferredActivation";
import {
  ProjectRouteContext,
  type ProjectRouteSlugResolutionResult,
} from "@/features/projects/contexts/ProjectRouteContext";
import { buildBranchSessionLaneId } from "@/features/projects/lib/projectBranchSessionStore";
import { resolveProjectSharedBranch } from "@/lib/git/projectRepositoryIntegration";
import { markCozeaInteractionEnd, markCozeaInteractionStart } from "@/lib/performance/marks";
import { formatActorDisplayName } from "@/lib/userDisplay";
import type { WorkspaceResolutionAction } from "../../../../shared/workspaceTypes";

const LazySettingsSidebar = lazy(() =>
  import("@/features/projects/components/SettingsSidebar").then((module) => ({
    default: module.SettingsSidebar,
  })),
);
const LazyAppStoreSidebar = lazy(() =>
  import("@/features/projects/components/AppStoreSidebar").then((module) => ({
    default: module.AppStoreSidebar,
  })),
);
const LazyPresenceAvatarGroup = lazy(() =>
  import("@/components/presence/PresenceAvatarGroup").then((module) => ({
    default: module.PresenceAvatarGroup,
  })),
);


function SidebarModeFallback() {
  return <div className="w-56 shrink-0 bg-sidebar" />;
}

interface ProjectLayoutProps {
  children?: ReactNode;
}

interface ProjectLayoutLocationState {
  projectId?: string | null;
  projectSlug?: string | null;
  projectName?: string | null;
  preferredWorkspaceId?: string | null;
  pendingTeamSetup?: Array<{
    email: string;
    name?: string;
    role: "project_manager" | "developer" | "designer" | "viewer";
    isCurrentUser?: boolean;
    profileImageUrl?: string | null;
  }>;
}



export function ProjectLayout({
  children, // NOTE: Router uses Outlet, but we keep children in case used as wrapper
}: ProjectLayoutProps) {
  const { convexUserId, user } = useAuth();
  const location = useLocation();
  const navigate = useViewTransitionNavigate();
  const { slug: routeSlug, projectId: routeProjectId } = useParams();
  const locationState = (location.state as ProjectLayoutLocationState | null) ?? null;

  // Get project data (with caching)
  const freshProjectById = useQuery(
    api.projects.getAccessibleById,
    routeProjectId && convexUserId
      ? { projectId: routeProjectId as Id<"projects">, userId: convexUserId }
      : "skip",
  );
  const freshProjectBySlug = useQuery(
    api.projects.getAccessibleBySlug,
    !routeProjectId && routeSlug && convexUserId
      ? {
          slug: routeSlug,
          userId: convexUserId,
        }
      : "skip",
  );
  const freshProject = routeProjectId
    ? freshProjectById
    : freshProjectBySlug?.status === "ok"
      ? freshProjectBySlug.project
      : null;
  const project = useCachedQuery(`layout-project-${routeProjectId ?? routeSlug}`, freshProject);
  const projectSlug = project?.slug ?? routeSlug ?? null;
  const trustedNavigationState = useMemo(
    () =>
      resolveTrustedProjectRouteNavigationState({
        state: location.state,
        routeProjectId: routeProjectId ?? null,
        routeProjectSlug: routeSlug ?? null,
        resolvedProjectId: project?._id ? String(project._id) : null,
        resolvedProjectSlug: project?.slug ?? null,
      }),
    [location.state, project?._id, project?.slug, routeProjectId, routeSlug],
  );
  const effectiveProjectName = project?.name ?? trustedNavigationState?.projectName ?? null;
  const projectBasePath = routeProjectId
    ? buildProjectPath(routeProjectId)
    : project?._id
      ? buildProjectPath(String(project._id))
      : projectSlug
        ? buildLegacyProjectPath(projectSlug)
        : null;

  const applyInitialTeamSetup = useMutation(api.projects.applyInitialTeamSetup);
  const appliedInitialTeamSetupKeysRef = useRef<Set<string>>(new Set());
  const { result: workspaceResolution, refresh: refreshWorkspace } = useProjectWorkspaceResolution(
    featureFlags.localWorkspaceCatalog && project?._id ? String(project._id) : null,
    projectSlug,
    null,
    trustedNavigationState?.preferredWorkspaceId ?? null,
  );

  const activeWorkspaceId = workspaceResolution?.status === "ready"
    ? workspaceResolution.workspace.workspaceId
    : null;
  const legacyLocalPath = featureFlags.localWorkspaceCatalog
    ? null
    : (trustedNavigationState?.preferredWorkspaceId ?? null);
  const runtimeWorkspaceId = featureFlags.localWorkspaceCatalog
    ? activeWorkspaceId
    : legacyLocalPath;

  const pendingTeamSetup = useMemo(
    () => locationState?.pendingTeamSetup ?? [],
    [locationState?.pendingTeamSetup],
  );
  const pendingTeamSetupReady = pendingTeamSetup.length > 0 && project?._id && convexUserId;

  useEffect(() => {
    if (!pendingTeamSetupReady || !project?._id || !convexUserId) {
      return;
    }

    const pendingKey = `${String(project._id)}:${pendingTeamSetup
      .map((member) => `${member.email}:${member.role}`)
      .sort()
      .join("|")}`;

    if (appliedInitialTeamSetupKeysRef.current.has(pendingKey)) {
      return;
    }
    appliedInitialTeamSetupKeysRef.current.add(pendingKey);

    let cancelled = false;

    void (async () => {
      try {
        await applyInitialTeamSetup({
          projectId: project._id,
          actorUserId: convexUserId,
          team: pendingTeamSetup,
        });

        if (cancelled) {
          return;
        }

        const nextState =
          runtimeWorkspaceId
            ? buildProjectRouteNavigationState({
                projectId: project?._id ? String(project._id) : routeProjectId ?? null,
                projectSlug,
                projectName: effectiveProjectName,
                preferredWorkspaceId: runtimeWorkspaceId,
              })
            : null;
        navigate(`${location.pathname}${location.search}${location.hash}`, {
          replace: true,
          state: nextState,
        });
      } catch (error) {
        console.warn("[ProjectLayout] Failed to apply deferred initial team setup:", error);
        appliedInitialTeamSetupKeysRef.current.delete(pendingKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    applyInitialTeamSetup,
    convexUserId,
    location.hash,
    location.pathname,
    location.search,
    runtimeWorkspaceId,
    navigate,
    pendingTeamSetup,
    pendingTeamSetupReady,
    projectSlug,
    project?._id,
    routeProjectId,
    effectiveProjectName,
  ]);


  const isWorkbenchView = location.pathname.endsWith("/workbench");
  const isChangesView = location.pathname.endsWith("/changes");
  const isAppStoreRoute = location.pathname.startsWith("/projects/store");
  const isSettingsModeRoute =
    location.pathname.startsWith("/projects/settings/") ||
    location.pathname.startsWith("/projects/workspace/") ||
    location.pathname.startsWith("/projects/teams");
  const shouldEnableProjectRuntime = Boolean(runtimeWorkspaceId);
  const runtimeEffectsReady = useDeferredActivation(shouldEnableProjectRuntime, {
    delayMs: 250,
    timeoutMs: 3_000,
  });
  const projectSwitchKey = `${routeProjectId ?? routeSlug ?? "unknown"}:${runtimeWorkspaceId ?? "unbound"}`;
  const collabBranch = useMemo(
    () => resolveProjectSharedBranch(project),
    [project],
  );
  const routeProjectIdentity = project?._id ? String(project._id) : routeProjectId ?? null;
  const {
    laneState,
    activeLane,
    collabLane,
    refreshLaneState,
  } = useProjectLaneState({
    projectId: shouldEnableProjectRuntime ? routeProjectIdentity : null,
    workspaceId: activeWorkspaceId,
    collabBranch,
  });
  const activeBranch = activeLane?.branch ?? collabBranch;
  const collaborationEnabled =
    shouldEnableProjectRuntime && Boolean(runtimeWorkspaceId) && activeBranch === collabBranch;
  const documentScopeId = useMemo(() => {
    if (!routeProjectIdentity) {
      return null;
    }

    if (!activeLane || activeLane.isCollab) {
      return routeProjectIdentity;
    }

    return `${routeProjectIdentity}:${buildBranchSessionLaneId(activeLane.branch, collabBranch)}`;
  }, [activeLane, collabBranch, routeProjectIdentity]);

  useEffect(() => {
    const switchStartMark = markCozeaInteractionStart("project-switch", {
      projectId: routeProjectId ?? null,
      projectSlug: routeSlug ?? null,
      hasWorkspace: Boolean(runtimeWorkspaceId),
    });
    const frameId = window.requestAnimationFrame(() => {
      markCozeaInteractionEnd("project-switch", switchStartMark, {
        projectId: routeProjectId ?? null,
        projectSlug: routeSlug ?? null,
        hasWorkspace: Boolean(runtimeWorkspaceId),
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [projectSwitchKey, routeProjectId, routeSlug, runtimeWorkspaceId]);

  const currentPreviewPage = usePageContextStore((state) => state.currentPage);
  const presenceActiveFile = isWorkbenchView ? (currentPreviewPage?.filePath ?? null) : null;
  const presenceActiveRoute = isWorkbenchView ? (currentPreviewPage?.route ?? null) : null;
  const displayUserName = user
    ? formatActorDisplayName(user.firstName || user.email, "User")
    : null;

  // Real-time presence tracking
  const { otherUsers: presenceUsers } = useProjectPresence({
    projectId: runtimeEffectsReady && shouldEnableProjectRuntime ? project?._id : null,
    userId: runtimeEffectsReady && shouldEnableProjectRuntime ? convexUserId : null,
    userName:
      runtimeEffectsReady && shouldEnableProjectRuntime
        ? displayUserName
        : null,
    userEmail: runtimeEffectsReady && shouldEnableProjectRuntime ? user?.email || null : null,
    userAvatarUrl: shouldEnableProjectRuntime ? user?.profileImageUrl || null : null,
    activeFile: presenceActiveFile,
    activeRoute: presenceActiveRoute,
  });

  const handlePresenceUserClick = useCallback(
    (presenceUser: PresenceUser) => {
      if (!projectBasePath) return;
      navigate(
        `${projectBasePath}/workbench?changes=1&userId=${encodeURIComponent(presenceUser.userId)}`,
      );
    },
    [navigate, projectBasePath],
  );

  // Check if we are on views that need full-bleed content (no padding)
  const shouldRemovePadding = isWorkbenchView || isChangesView;

  const presenceHeaderAddon = useMemo(
    () =>
      presenceUsers.length > 0 ? (
        <Suspense fallback={null}>
          <LazyPresenceAvatarGroup
            users={presenceUsers}
            maxVisible={4}
            onUserClick={handlePresenceUserClick}
          />
        </Suspense>
      ) : null,
    [handlePresenceUserClick, presenceUsers],
  );

  const workspaceSelectionId = user?.id ?? "local-device";

  const collaborationProjectId = useMemo((): Id<"projects"> | null => {
    if (project?._id) return project._id;
    const entry = readLastWorkbenchRoute(workspaceSelectionId);
    if (!entry?.projectId) return null;
    return entry.projectId as Id<"projects">;
  }, [project?._id, workspaceSelectionId]);

  const chromeHeader = useProjectChromeHeader({
    isSettingsModeRoute,
    pathname: location.pathname,
    workspaceScoped: false,
    presencePreSearchAddon: presenceHeaderAddon,
    projectId: collaborationProjectId,
    projectName: effectiveProjectName,
    editorProjectPath: runtimeWorkspaceId ?? null,
  });

  const handleRepairAction = useCallback(
    async (action: WorkspaceResolutionAction) => {
      if (!project?._id) return;
      const projectId = String(project._id);
      const slug = project.slug ?? routeSlug ?? projectId;
      const repoUrl =
        (project as { repoSource?: { repoUrl?: string | null } | null }).repoSource?.repoUrl ??
        (project as { sourceControl?: { repoUrl?: string | null } | null }).sourceControl?.repoUrl ??
        null;
      const branch =
        (project as { repoSource?: { branch?: string | null } | null }).repoSource?.branch ??
        (project as { sourceControl?: { defaultBranch?: string | null } | null }).sourceControl?.defaultBranch ??
        undefined;

      try {
        switch (action.kind) {
          case "locate": {
            const folderPath = await window.desktopBridge?.pickFolder();
            if (folderPath) {
              const bindResult = await window.electronAPI.workspace!.bindExistingFolder({
                projectId,
                folderPath,
                writeMarker: true,
                setActive: true,
                source: "locate",
              });
              if (bindResult.success) {
                refreshWorkspace();
              } else {
                await window.desktopBridge?.confirm("Failed to bind folder: " + bindResult.error);
              }
            }
            break;
          }
          case "bind-candidate": {
            const bindResult = await window.electronAPI.workspace!.bindExistingFolder({
              projectId,
              folderPath: action.folderPath,
              writeMarker: true,
              setActive: true,
              source: "repair",
            });
            if (bindResult.success) {
              refreshWorkspace();
            } else {
              await window.desktopBridge?.confirm("Failed to bind folder: " + (bindResult.error ?? "unknown error"));
            }
            break;
          }
          case "create": {
            const createResult = await window.electronAPI.workspace!.createForProject({
              projectId,
              slug,
              initGit: true,
              setActive: true,
            });
            if (createResult.success) {
              refreshWorkspace();
            } else {
              await window.desktopBridge?.confirm("Failed to create workspace: " + (createResult.error ?? "unknown error"));
            }
            break;
          }
          case "clone": {
            if (!repoUrl) {
              await window.desktopBridge?.confirm("This project does not have a repository URL to clone.");
              break;
            }
            const cloneResult = await window.electronAPI.workspace!.cloneForProject({
              projectId,
              slug,
              repoUrl,
              branch,
              setActive: true,
            });
            if (cloneResult.success) {
              refreshWorkspace();
            } else {
              await window.desktopBridge?.confirm("Failed to clone workspace: " + (cloneResult.error ?? "unknown error"));
            }
            break;
          }
          case "forget": {
            if ("workspaceId" in action && action.workspaceId) {
              await window.electronAPI.workspace!.forget(action.workspaceId);
              refreshWorkspace();
            }
            break;
          }
        }
      } catch (err) {
        console.error("[ProjectLayout] Repair action failed:", err);
      }
    },
    [project, refreshWorkspace, routeSlug],
  );

  const layoutContent = (
    <SidebarProvider>
      <div className="h-screen w-screen bg-transparent flex flex-col overflow-hidden">
        {/* Main content */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden relative">
          {isAppStoreRoute ? (
            <Suspense fallback={<SidebarModeFallback />}>
              <LazyAppStoreSidebar color="currentColor" user={user} />
            </Suspense>
          ) : isSettingsModeRoute ? (
            <Suspense fallback={<SidebarModeFallback />}>
              <LazySettingsSidebar color="currentColor" user={user} />
            </Suspense>
          ) : (
            <ProjectSidebar
              color="currentColor"
              user={user}
              projectId={project?._id ?? null}
            />
          )}
          <SidebarInset
            color="currentColor"
            className="flex flex-col flex-1 min-w-0 overflow-hidden md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none"
          >
            <UnifiedHeader
              layoutMode="embedded"
              leftWindowControlsInset
              compactHeaderActions
              {...chromeHeader}
            />
            <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
              <div
                className={cn(
                  // `min-w-0` prevents the main content from overflowing under the right panels
                  // when it contains wide children (iframes, editors, etc.).
                  "flex flex-1 flex-col min-h-0 min-w-0",
                  shouldRemovePadding ? "p-0" : "p-4",
                  shouldRemovePadding ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden",
                )}
              >
                {featureFlags.localWorkspaceCatalog && project?._id && !workspaceResolution ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                  </div>
                ) : featureFlags.localWorkspaceCatalog && project?._id && workspaceResolution?.status !== "ready" ? (
                  <WorkspaceRepairScreen
                    result={workspaceResolution!}
                    project={{ _id: String(project._id), slug: project.slug, name: project.name }}
                    onAction={handleRepairAction}
                  />
                ) : (
                  children || <Outlet />
                )}
              </div>
              <TerminalEventBridge />
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );

  const projectRouteContextValue = useMemo(
    () => ({
      project,
      projectIdParam: routeProjectId ?? null,
      slugParam: routeSlug ?? null,
      slugResolution: (!routeProjectId ? freshProjectBySlug : undefined) as
        | ProjectRouteSlugResolutionResult
        | undefined,
      workspaceId: activeWorkspaceId,
      localPath: legacyLocalPath,
      gitCwd: null,
      projectBasePath,
      projectName: effectiveProjectName,
      collabBranch,
      laneState,
      activeLane,
      collabLane,
      collaborationEnabled,
      refreshLaneState,
    }),
    [
      activeLane,
      collabBranch,
      collabLane,
      collaborationEnabled,
      effectiveProjectName,
      activeWorkspaceId,
      legacyLocalPath,
      freshProjectBySlug,
      laneState,
      project,
      projectBasePath,
      refreshLaneState,
      routeProjectId,
      routeSlug,
    ],
  );

  const canProvideActiveWorkspace = Boolean(project?._id && workspaceResolution?.status === "ready");

  // Only block on project loading when we're actually on a project-specific
  // route. Routes like /projects/ (launch page) have no routeProjectId or
  // routeSlug, so project is always null there — don't block them.
  const projectRoutePending = !project && Boolean(routeProjectId || routeSlug);
  // freshProject === undefined means Convex hasn't responded yet (still loading).
  // freshProject === null means Convex responded: project not found / deleted.
  const projectDefinitelyMissing =
    projectRoutePending && freshProject !== undefined && freshProject === null;

  // Navigate in an effect — never during render. Calling navigate while rendering
  // races with brand-new imports (query can briefly miss) and bounces the user
  // back to /projects so it looks like the project was only added to the sidebar.
  useEffect(() => {
    if (!projectDefinitelyMissing) {
      return;
    }
    navigate("/projects", { replace: true });
  }, [navigate, projectDefinitelyMissing]);

  if (projectRoutePending) {
    if (projectDefinitelyMissing) {
      return null;
    }

    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading project...
      </div>
    );
  }

  return (
    <ProjectRouteContext.Provider value={projectRouteContextValue}>
      
      {canProvideActiveWorkspace && workspaceResolution?.status === "ready" && project?._id ? (
        <ActiveWorkspaceProvider value={{
          projectId: String(project._id),
          projectSlug: project.slug,
          projectName: effectiveProjectName,
          workspace: workspaceResolution.workspace,
          lane: workspaceResolution.lane,
          runtime: workspaceResolution.runtimeIdentity,
          collaborationScopeId: workspaceResolution.collaborationScopeId,
        }}>
          <ProjectSyncProvider
            workspaceId={activeWorkspaceId}
            workspaceRevision={workspaceResolution.workspace.workspaceRevision}
            projectId={shouldEnableProjectRuntime ? project?._id ?? null : null}
            userId={shouldEnableProjectRuntime ? convexUserId ?? null : null}
            userName={displayUserName ?? "User"}
            laneId={activeLane?.id ?? laneState?.activeLaneId ?? laneState?.collabLaneId ?? null}
            projectSlug={projectSlug}
            gitCwd={null}
            lastSyncAt={project?.lastSyncAt}
            collaborationEnabled={collaborationEnabled}
            activeBranch={activeBranch}
            sharedBranch={collabBranch}
            documentScopeId={documentScopeId}
          >
            {layoutContent}
          </ProjectSyncProvider>
        </ActiveWorkspaceProvider>
      ) : (
        <ProjectSyncProvider
          workspaceId={null}
          workspaceRevision={1}
          projectId={shouldEnableProjectRuntime ? project?._id ?? null : null}
          userId={shouldEnableProjectRuntime ? convexUserId ?? null : null}
          userName={displayUserName ?? "User"}
          laneId={activeLane?.id ?? laneState?.activeLaneId ?? laneState?.collabLaneId ?? null}
          projectSlug={projectSlug}
          gitCwd={null}
          lastSyncAt={project?.lastSyncAt}
          collaborationEnabled={collaborationEnabled}
          activeBranch={activeBranch}
          sharedBranch={collabBranch}
          documentScopeId={documentScopeId}
        >
          {layoutContent}
        </ProjectSyncProvider>
      )}

    </ProjectRouteContext.Provider>
  );
}

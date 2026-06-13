"use client";

import { lazy, Suspense, type ReactNode, useRef, useCallback, useEffect, useMemo,  } from "react";
import { Outlet, useLocation, useParams } from "@/lib/router";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useCachedQuery } from "@/stores/useQueryCache";
import { ProjectSidebar } from "../components/ProjectSidebar";
import { AppSidebarShell } from "../components/sidebar/AppSidebarShell";
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
import { ActiveWorkspaceContext } from "@/features/projects/workspaces/ActiveWorkspaceContext";
import {
  buildProjectRouteNavigationState,
  resolveTrustedProjectRouteNavigationState,
} from "@/features/projects/lib/projectNavigationState";
import { useProjectChromeHeader } from "@/features/projects/hooks/useProjectChromeHeader";
import { formatWorkspaceBindFailure } from "@/features/projects/lib/localProjectImport";
import { appToast } from "@/lib/appToast";
import { useTranslation } from "@/lib/i18n";
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
import type {
  ActiveWorkspaceContextValue,
  WorkspaceResolutionAction,
} from "../../../../shared/workspaceTypes";

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
  // Content-only: the persistent AppSidebarShell already paints the surface.
  return <div className="min-h-0 flex-1" />;
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

/**
 * Null-rendering sibling that owns the deferred team-setup flow. It subscribes
 * to `location.href` and navigation state, which change on every navigation —
 * isolating those subscriptions here keeps ProjectLayout (and the whole route
 * tree under it) from re-rendering when only the URL or state changed.
 */
function PendingTeamSetupEffect({
  projectId,
  convexUserId,
  projectSlug,
  projectName,
  runtimeWorkspaceId,
  routeProjectId,
}: {
  projectId: Id<"projects">;
  convexUserId: Id<"users">;
  projectSlug: string | null;
  projectName: string | null;
  runtimeWorkspaceId: string | null;
  routeProjectId: string | null;
}) {
  const navigate = useViewTransitionNavigate();
  const locationHref = useLocation({ select: (location) => location.href });
  const statePendingTeamSetup = useLocation({
    select: (location) =>
      (location.state as ProjectLayoutLocationState | null)?.pendingTeamSetup ?? null,
  });
  const applyInitialTeamSetup = useMutation(api.projects.applyInitialTeamSetup);
  const appliedInitialTeamSetupKeysRef = useRef<Set<string>>(new Set());

  const pendingTeamSetup = useMemo(
    () => statePendingTeamSetup ?? [],
    [statePendingTeamSetup],
  );

  useEffect(() => {
    if (pendingTeamSetup.length === 0) {
      return;
    }

    const pendingKey = `${String(projectId)}:${pendingTeamSetup
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
          projectId,
          actorUserId: convexUserId,
          team: pendingTeamSetup,
        });

        if (cancelled) {
          return;
        }

        const nextState =
          runtimeWorkspaceId
            ? buildProjectRouteNavigationState({
                projectId: String(projectId) || (routeProjectId ?? null),
                projectSlug,
                projectName,
                preferredWorkspaceId: runtimeWorkspaceId,
              })
            : null;
        navigate(locationHref, {
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
    locationHref,
    runtimeWorkspaceId,
    navigate,
    pendingTeamSetup,
    projectSlug,
    projectId,
    routeProjectId,
    projectName,
  ]);

  return null;
}

/**
 * Presence subscription isolated from the layout: heartbeats from other users
 * arrive frequently, and subscribing in ProjectLayout re-rendered the entire
 * project surface per update. This renders only the avatar group.
 */
function ProjectPresenceHeaderAddon({
  projectId,
  convexUserId,
  userName,
  userEmail,
  userAvatarUrl,
  isWorkbenchView,
  projectBasePath,
}: {
  projectId: Id<"projects"> | null;
  convexUserId: Id<"users"> | null;
  userName: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
  isWorkbenchView: boolean;
  projectBasePath: string | null;
}) {
  const navigate = useViewTransitionNavigate();
  const presenceActiveFile = usePageContextStore((state) =>
    isWorkbenchView ? (state.currentPage?.filePath ?? null) : null,
  );
  const presenceActiveRoute = usePageContextStore((state) =>
    isWorkbenchView ? (state.currentPage?.route ?? null) : null,
  );

  const { otherUsers: presenceUsers } = useProjectPresence({
    projectId,
    userId: convexUserId,
    userName,
    userEmail,
    userAvatarUrl,
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

  if (presenceUsers.length === 0) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LazyPresenceAvatarGroup
        users={presenceUsers}
        maxVisible={4}
        onUserClick={handlePresenceUserClick}
      />
    </Suspense>
  );
}



export function ProjectLayout({
  children, // NOTE: Router uses Outlet, but we keep children in case used as wrapper
}: ProjectLayoutProps) {
  const { t } = useTranslation();
  const { convexUserId, user } = useAuth();
  // Narrow location subscriptions: subscribing to the whole location object
  // re-renders this layout (and everything under it) on every navigation,
  // including no-op clicks to the current URL.
  const pathname = useLocation({ select: (location) => location.pathname });
  const stateProjectId = useLocation({
    select: (location) => (location.state as ProjectLayoutLocationState | null)?.projectId ?? null,
  });
  const stateProjectSlug = useLocation({
    select: (location) => (location.state as ProjectLayoutLocationState | null)?.projectSlug ?? null,
  });
  const stateProjectName = useLocation({
    select: (location) => (location.state as ProjectLayoutLocationState | null)?.projectName ?? null,
  });
  const statePreferredWorkspaceId = useLocation({
    select: (location) =>
      (location.state as ProjectLayoutLocationState | null)?.preferredWorkspaceId ?? null,
  });
  const navigate = useViewTransitionNavigate();
  const { slug: routeSlug, projectId: routeProjectId } = useParams();
  const updateProjectStatusMutation = useMutation(api.projects.updateStatus);

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
  // For slug routes, `undefined` must stay "still loading" — collapsing it to
  // null made projectDefinitelyMissing fire mid-flight and bounce legacy slug
  // links to /projects before the query resolved.
  const freshProject = routeProjectId
    ? freshProjectById
    : freshProjectBySlug === undefined
      ? undefined
      : freshProjectBySlug.status === "ok"
        ? freshProjectBySlug.project
        : null;
  const project = useCachedQuery(`layout-project-${routeProjectId ?? routeSlug}`, freshProject);
  const projectSlug = project?.slug ?? routeSlug ?? null;
  const trustedNavigationState = useMemo(
    () =>
      resolveTrustedProjectRouteNavigationState({
        state: {
          projectId: stateProjectId,
          projectSlug: stateProjectSlug,
          projectName: stateProjectName,
          preferredWorkspaceId: statePreferredWorkspaceId,
        },
        routeProjectId: routeProjectId ?? null,
        routeProjectSlug: routeSlug ?? null,
        resolvedProjectId: project?._id ? String(project._id) : null,
        resolvedProjectSlug: project?.slug ?? null,
      }),
    [
      stateProjectId,
      stateProjectSlug,
      stateProjectName,
      statePreferredWorkspaceId,
      project?._id,
      project?.slug,
      routeProjectId,
      routeSlug,
    ],
  );
  const effectiveProjectName = project?.name ?? trustedNavigationState?.projectName ?? null;
  const projectBasePath = routeProjectId
    ? buildProjectPath(routeProjectId)
    : project?._id
      ? buildProjectPath(String(project._id))
      : projectSlug
        ? buildLegacyProjectPath(projectSlug)
        : null;

  const { result: rawWorkspaceResolution, refresh: refreshWorkspace } = useProjectWorkspaceResolution(
    featureFlags.localWorkspaceCatalog && project?._id ? String(project._id) : null,
    projectSlug,
    null,
    trustedNavigationState?.preferredWorkspaceId ?? null,
    { allowCandidateScan: true },
  );
  // Never act on a resolution for a different project. A stale window here
  // once created workbenches for project B keyed with project A's workspace
  // id; the hook is now render-time key-scoped, this is cheap insurance.
  const workspaceResolution =
    rawWorkspaceResolution && project?._id && rawWorkspaceResolution.projectId !== String(project._id)
      ? null
      : rawWorkspaceResolution;

  const activeWorkspaceId = workspaceResolution?.status === "ready"
    ? workspaceResolution.workspace.workspaceId
    : null;
  const activeProjectRootPath = workspaceResolution?.status === "ready"
    ? workspaceResolution.workspace.projectRootPath
    : null;
  const activeGitRootPath = workspaceResolution?.status === "ready"
    ? (workspaceResolution.lane.gitRootPath ?? workspaceResolution.workspace.gitRootPath)
    : null;
  const runtimeWorkspaceId = activeWorkspaceId;

  const isWorkbenchView = pathname.endsWith("/workbench");
  const isChangesView = pathname.endsWith("/changes");
  const isAppStoreRoute = pathname.startsWith("/projects/store");
  const isSettingsModeRoute =
    pathname.startsWith("/projects/settings/") ||
    pathname.startsWith("/projects/workspace/") ||
    pathname.startsWith("/projects/teams");
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

  // Active-workspace context value, or null until the workspace resolves. Kept
  // nullable (rather than gating the provider's presence) so ProjectSyncProvider
  // and the layout shell stay mounted at the same tree position across the
  // not-ready -> ready transition instead of remounting the whole subtree.
  const activeWorkspaceContextValue = useMemo<ActiveWorkspaceContextValue | null>(() => {
    if (workspaceResolution?.status !== "ready" || !project?._id) {
      return null;
    }
    return {
      projectId: String(project._id),
      projectSlug: project.slug ?? null,
      projectName: effectiveProjectName,
      workspace: workspaceResolution.workspace,
      lane: workspaceResolution.lane,
      runtime: workspaceResolution.runtimeIdentity,
      collaborationScopeId: workspaceResolution.collaborationScopeId,
    };
  }, [workspaceResolution, project?._id, project?.slug, effectiveProjectName]);

  const activeWorkspaceRevision =
    workspaceResolution?.status === "ready" ? workspaceResolution.workspace.workspaceRevision : 1;

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

  const displayUserName = user
    ? formatActorDisplayName(user.firstName || user.email, "User")
    : null;

  // Check if we are on views that need full-bleed content (no padding)
  const shouldRemovePadding = isWorkbenchView || isChangesView;

  const presenceGateOpen = runtimeEffectsReady && shouldEnableProjectRuntime;
  const presenceHeaderAddon = useMemo(
    () => (
      <ProjectPresenceHeaderAddon
        projectId={presenceGateOpen ? project?._id ?? null : null}
        convexUserId={presenceGateOpen ? convexUserId ?? null : null}
        userName={presenceGateOpen ? displayUserName : null}
        userEmail={presenceGateOpen ? user?.email || null : null}
        userAvatarUrl={shouldEnableProjectRuntime ? user?.profileImageUrl || null : null}
        isWorkbenchView={isWorkbenchView}
        projectBasePath={projectBasePath}
      />
    ),
    [
      presenceGateOpen,
      project?._id,
      convexUserId,
      displayUserName,
      user?.email,
      user?.profileImageUrl,
      shouldEnableProjectRuntime,
      isWorkbenchView,
      projectBasePath,
    ],
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
    pathname,
    workspaceScoped: false,
    presencePreSearchAddon: presenceHeaderAddon,
    projectId: collaborationProjectId,
    projectName: effectiveProjectName,
    editorProjectPath: runtimeWorkspaceId ?? null,
  });

  // Stable element: layout re-renders bail out of the header subtree unless
  // the chrome inputs actually changed (chromeHeader is memoized upstream).
  const headerElement = useMemo(
    () => (
      <UnifiedHeader
        layoutMode="embedded"
        leftWindowControlsInset
        compactHeaderActions
        {...chromeHeader}
      />
    ),
    [chromeHeader],
  );

  // Resume path for the creation saga: a crash between doc creation and the
  // local workspace step leaves status "provisioning"; a successful repair
  // (locate/bind/create/clone) completes what the original attempt started.
  const finalizeProvisioningAfterRepair = useCallback(async () => {
    if (!project?._id || !convexUserId || project.status !== "provisioning") return;
    try {
      await updateProjectStatusMutation({
        projectId: project._id,
        userId: convexUserId,
        status: "active",
      });
    } catch (error) {
      console.warn("[ProjectLayout] Failed to finalize provisioning project:", error);
    }
  }, [convexUserId, project?._id, project?.status, updateProjectStatusMutation]);

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
                await finalizeProvisioningAfterRepair();
              } else {
                appToast.error({
                  title: t("workspace.bindFailed"),
                  description: formatWorkspaceBindFailure(bindResult),
                });
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
              await finalizeProvisioningAfterRepair();
            } else {
              appToast.error({
                title: t("workspace.bindFailed"),
                description: formatWorkspaceBindFailure(bindResult),
              });
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
              await finalizeProvisioningAfterRepair();
            } else {
              appToast.error({
                title: t("workspace.createFailed"),
                description: createResult.error ?? undefined,
              });
            }
            break;
          }
          case "clone": {
            if (!repoUrl) {
              appToast.warning({ title: t("workspace.noRepoUrl") });
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
              await finalizeProvisioningAfterRepair();
            } else {
              appToast.error({
                title: t("workspace.cloneFailed"),
                description: cloneResult.error ?? undefined,
              });
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
          case "force-bind":
          case "open-found": {
            // These action kinds exist in the union but have no resolver that
            // emits them yet and carry no folder/target to act on. Surface them
            // rather than leaving the rendered button silently inert.
            console.warn(
              `[ProjectLayout] Repair action '${action.kind}' is not implemented yet.`,
            );
            appToast.warning({ title: t("workspace.actionFailed") });
            break;
          }
          default: {
            // Exhaustiveness guard: a new WorkspaceResolutionAction kind without
            // a case here is a compile error, not a silently dead button.
            const _exhaustive: never = action;
            void _exhaustive;
            break;
          }
        }
      } catch (err) {
        console.error("[ProjectLayout] Repair action failed:", err);
        appToast.error({
          title: t("workspace.actionFailed"),
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [finalizeProvisioningAfterRepair, project, refreshWorkspace, routeSlug, t],
  );

  // Only block on project loading when we're actually on a project-specific
  // route. Routes like /projects/ (launch page) have no routeProjectId or
  // routeSlug, so project is always null there — don't block them.
  // freshProject === undefined means Convex hasn't responded yet (still loading).
  // freshProject === null means Convex responded: project not found / deleted.
  // Distinguish so we don't spin forever on a deleted project.
  const isResolvingProject = !project && Boolean(routeProjectId || routeSlug);
  const projectDefinitelyMissing = isResolvingProject && freshProject === null;

  useEffect(() => {
    if (!projectDefinitelyMissing) return;
    // Project was deleted or is not accessible. Redirect to the launch page
    // so the user isn't stuck on a dead URL.
    navigate("/projects", { replace: true });
  }, [navigate, projectDefinitelyMissing]);

  const layoutContent = (
    <SidebarProvider>
      <div className="h-screen w-screen bg-transparent flex flex-col overflow-hidden">
        {/* Main content */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden relative">
          {/* Persistent shell: route-mode switches swap only the content. */}
          <AppSidebarShell
            surface={isAppStoreRoute ? "appStore" : isSettingsModeRoute ? "settings" : "project"}
          >
            {isAppStoreRoute ? (
              <Suspense fallback={<SidebarModeFallback />}>
                <LazyAppStoreSidebar user={user} />
              </Suspense>
            ) : isSettingsModeRoute ? (
              <Suspense fallback={<SidebarModeFallback />}>
                <LazySettingsSidebar user={user} />
              </Suspense>
            ) : (
              <ProjectSidebar
                user={user}
                projectId={project?._id ?? null}
              />
            )}
          </AppSidebarShell>
          <SidebarInset
            color="currentColor"
            // bg-background: keep window vibrancy/transparency confined to the
            // sidebar — the header + tile canvas stay one opaque surface.
            className="flex flex-col flex-1 min-w-0 overflow-hidden bg-background md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none md:peer-data-[variant=inset]:bg-transparent"
          >
            {headerElement}
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
                {isResolvingProject ? (
                  // Resolve in place: early-returning a bare loading screen here
                  // unmounted the whole shell (sidebar included) on every cold
                  // project switch, then remounted it when Convex answered.
                  <div className="flex h-full items-center justify-center">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                  </div>
                ) : featureFlags.localWorkspaceCatalog && project?._id && !workspaceResolution ? (
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
      projectRootPath: activeProjectRootPath,
      gitRootPath: activeGitRootPath,
      gitCwd: activeGitRootPath,
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
      activeGitRootPath,
      activeProjectRootPath,
      activeWorkspaceId,
      freshProjectBySlug,
      laneState,
      project,
      projectBasePath,
      refreshLaneState,
      routeProjectId,
      routeSlug,
    ],
  );



  return (
    <ProjectRouteContext.Provider value={projectRouteContextValue}>
      {project?._id && convexUserId ? (
        <PendingTeamSetupEffect
          projectId={project._id}
          convexUserId={convexUserId}
          projectSlug={projectSlug}
          projectName={effectiveProjectName}
          runtimeWorkspaceId={runtimeWorkspaceId}
          routeProjectId={routeProjectId ?? null}
        />
      ) : null}
      {/*
        Single, stable ProjectSyncProvider + active-workspace context: mounted
        once at this slot regardless of resolution state. activeWorkspaceId and
        activeGitRootPath are already null until the workspace is ready, and the
        active-workspace value is null until then, so the not-ready -> ready flip
        only updates props instead of remounting the layout shell + sync subtree.
      */}
      <ProjectSyncProvider
        workspaceId={activeWorkspaceId}
        workspaceRevision={activeWorkspaceRevision}
        projectId={shouldEnableProjectRuntime ? project?._id ?? null : null}
        userId={shouldEnableProjectRuntime ? convexUserId ?? null : null}
        userName={displayUserName ?? "User"}
        laneId={activeLane?.id ?? laneState?.activeLaneId ?? laneState?.collabLaneId ?? null}
        projectSlug={projectSlug}
        gitCwd={activeGitRootPath}
        lastSyncAt={project?.lastSyncAt}
        collaborationEnabled={collaborationEnabled}
        activeBranch={activeBranch}
        sharedBranch={collabBranch}
        documentScopeId={documentScopeId}
      >
        <ActiveWorkspaceContext.Provider value={activeWorkspaceContextValue}>
          {layoutContent}
        </ActiveWorkspaceContext.Provider>
      </ProjectSyncProvider>

    </ProjectRouteContext.Provider>
  );
}

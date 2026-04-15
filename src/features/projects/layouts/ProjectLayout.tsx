"use client";

import { type ReactNode, useRef, useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useParams } from "@/lib/router";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useCachedQuery } from "@/stores/useQueryCache";
import { ProjectSidebar } from "../components/ProjectSidebar";
import { SettingsSidebar } from "../components/SettingsSidebar";
import { AppStoreSidebar } from "../components/AppStoreSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { UnifiedHeader } from "@/components/layouts/UnifiedHeader";
import { TerminalEventBridge } from "@/features/projects/components/TerminalEventBridge";
import { usePageContextStore } from "@/stores/usePageContextStore";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { ProjectSyncProvider } from "../contexts/ProjectSyncContext";
import { useProjectPresence } from "@/hooks/useProjectPresence";
import { useDiagnosticsBridge } from "@/hooks/useDiagnosticsBridge";
import { setVscodeWorkspaceProjectPath } from "@/lib/editor/vscodeFileSystemBridge";
import { PresenceAvatarGroup } from "@/components/presence/PresenceAvatarGroup";
import type { PresenceUser } from "@/hooks/useProjectPresence";
import { buildLegacyProjectPath, buildProjectPath } from "@/features/projects/lib/projectRoutes";
import { readLastWorkbenchRoute } from "@/features/projects/lib/lastWorkbenchRoute";
import { useScopedAppContext } from "@/hooks/useScopedAppContext";
import { getWorkspaceSelectionId } from "@shared/types";
import { primeLocalProjectPath, useLocalProjectPath } from "@/features/projects/hooks/useLocalProjectPath";
import { resolveAttachedLocalProjectPathHint } from "@/features/projects/lib/projectLocalRootHints";
import { useProjectChromeHeader } from "@/features/projects/hooks/useProjectChromeHeader";
import { useProjectLaneState } from "@/features/projects/hooks/useProjectLaneState";
import {
  ProjectRouteContext,
  type ProjectRouteSlugResolutionResult,
} from "@/features/projects/contexts/ProjectRouteContext";
import { buildBranchSessionLaneId } from "@/features/projects/lib/projectBranchSessionStore";
import { resolveProjectSharedBranch } from "@/lib/git/projectRepositoryIntegration";

function normalizeProjectPath(projectPath: string | null | undefined): string | null {
  if (!projectPath?.trim()) {
    return null;
  }

  return projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
}

interface ProjectLayoutProps {
  children?: ReactNode;
}

interface ProjectLayoutLocationState {
  localPath?: string | null;
  projectName?: string | null;
  pendingTeamSetup?: Array<{
    email: string;
    name?: string;
    role: "project_manager" | "developer" | "designer" | "viewer";
    isCurrentUser?: boolean;
    profileImageUrl?: string | null;
  }>;
}

function extractProjectCloudLocalPath(project: unknown): string | null {
  if (!project || typeof project !== "object" || !("localPath" in project)) {
    return null;
  }

  const localPath = (project as { localPath?: unknown }).localPath;
  return typeof localPath === "string" && localPath.trim().length > 0 ? localPath : null;
}

export function ProjectLayout({
  children, // NOTE: Router uses Outlet, but we keep children in case used as wrapper
}: ProjectLayoutProps) {
  const { convexUserId, user, logout } = useAuth();
  const { preferredConvexOrganizationId, workspaceScoped, resolvedScope } = useScopedAppContext();
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
          preferredOrganizationId: preferredConvexOrganizationId,
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
  const effectiveProjectName = project?.name ?? locationState?.projectName ?? null;
  const projectBasePath = routeProjectId
    ? buildProjectPath(routeProjectId)
    : project?._id
      ? buildProjectPath(String(project._id))
      : projectSlug
        ? buildLegacyProjectPath(projectSlug)
        : null;

  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath);
  const applyInitialTeamSetup = useMutation(api.projects.applyInitialTeamSetup);
  const appliedInitialTeamSetupKeysRef = useRef<Set<string>>(new Set());
  const mirroredLocalPathRef = useRef<string | null>(null);
  const navigationLocalPath = locationState?.localPath ?? null;
  const trustedNavigationPath = useMemo(
    () => normalizeProjectPath(navigationLocalPath),
    [navigationLocalPath],
  );
  const projectCloudLocalPath = useMemo(() => extractProjectCloudLocalPath(project), [project]);
  const attachedPathHint = useMemo(
    () =>
      resolveAttachedLocalProjectPathHint(
        project as {
          importedFrom?: { provider: string; repoFullName: string; branch?: string | null } | null;
        } | null,
      ),
    [project],
  );
  const normalizedAttachedPathHint = useMemo(
    () => normalizeProjectPath(attachedPathHint),
    [attachedPathHint],
  );
  const { localPath: candidateLocalPath } = useLocalProjectPath({
    initialPath: navigationLocalPath,
    preferInitialPath: Boolean(navigationLocalPath),
    projectId: project?._id ? String(project._id) : routeProjectId,
    projectSlug,
    cloudPathHint: projectCloudLocalPath,
    attachedPathHint,
  });
  const [effectiveLocalPath, setEffectiveLocalPath] = useState<string | null>(
    normalizeProjectPath(navigationLocalPath),
  );

  useEffect(() => {
    if (trustedNavigationPath) {
      setEffectiveLocalPath(trustedNavigationPath);
      return;
    }

    setEffectiveLocalPath(normalizeProjectPath(candidateLocalPath));
  }, [candidateLocalPath, trustedNavigationPath]);

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
          navigationLocalPath
            ? {
                localPath: navigationLocalPath,
              }
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
    navigationLocalPath,
    navigate,
    pendingTeamSetup,
    pendingTeamSetupReady,
    project?._id,
  ]);

  const trustedCloudMirrorPath = useMemo(() => {
    if (!effectiveLocalPath) {
      return null;
    }

    if (trustedNavigationPath && effectiveLocalPath === trustedNavigationPath) {
      return trustedNavigationPath;
    }

    if (normalizedAttachedPathHint && effectiveLocalPath === normalizedAttachedPathHint) {
      return normalizedAttachedPathHint;
    }

    return null;
  }, [effectiveLocalPath, normalizedAttachedPathHint, trustedNavigationPath]);

  useEffect(() => {
    if (!effectiveLocalPath || !project?._id) {
      return;
    }

    primeLocalProjectPath(String(project._id), effectiveLocalPath, projectSlug);

    if (!convexUserId || !trustedCloudMirrorPath) {
      return;
    }

    const mirrorKey = `${String(project._id)}:${convexUserId}:${trustedCloudMirrorPath}`;
    if (mirroredLocalPathRef.current === mirrorKey) {
      return;
    }
    mirroredLocalPathRef.current = mirrorKey;

    void updateMemberLocalPath({
      projectId: project._id,
      userId: convexUserId,
      localPath: trustedCloudMirrorPath,
    }).catch((error) => {
      mirroredLocalPathRef.current = null;
      console.warn("[ProjectLayout] Failed to mirror local project path to cloud metadata:", error);
    });
  }, [
    convexUserId,
    effectiveLocalPath,
    project?._id,
    projectSlug,
    trustedCloudMirrorPath,
    updateMemberLocalPath,
  ]);

  const isWorkbenchView = location.pathname.endsWith("/workbench");
  const isChangesView = location.pathname.endsWith("/changes");
  const isAppStoreRoute = location.pathname.startsWith("/projects/store");
  const isSettingsModeRoute =
    location.pathname.startsWith("/projects/settings/") ||
    location.pathname.startsWith("/projects/workspace/") ||
    location.pathname.startsWith("/projects/teams");
  const shouldEnableProjectRuntime = Boolean(effectiveLocalPath && (isWorkbenchView || isChangesView));
  const runtimeProjectPath = shouldEnableProjectRuntime ? effectiveLocalPath : null;
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
    projectPath: runtimeProjectPath,
    collabBranch,
  });
  const activeBranch = activeLane?.branch ?? collabBranch;
  const collaborationEnabled =
    shouldEnableProjectRuntime && Boolean(runtimeProjectPath) && activeBranch === collabBranch;
  const documentScopeId = useMemo(() => {
    if (!routeProjectIdentity) {
      return null;
    }

    if (!activeLane || activeLane.isCollab) {
      return routeProjectIdentity;
    }

    return `${routeProjectIdentity}:${buildBranchSessionLaneId(activeLane.branch, collabBranch)}`;
  }, [activeLane, collabBranch, routeProjectIdentity]);

  useDiagnosticsBridge(runtimeProjectPath);

  useEffect(() => {
    setVscodeWorkspaceProjectPath(runtimeProjectPath);
    return () => {
      setVscodeWorkspaceProjectPath(null);
    };
  }, [runtimeProjectPath]);

  const currentPreviewPage = usePageContextStore((state) => state.currentPage);
  const presenceActiveFile = isWorkbenchView ? (currentPreviewPage?.filePath ?? null) : null;
  const presenceActiveRoute = isWorkbenchView ? (currentPreviewPage?.route ?? null) : null;

  // Real-time presence tracking
  const { otherUsers: presenceUsers } = useProjectPresence({
    projectId: shouldEnableProjectRuntime ? project?._id : null,
    userId: shouldEnableProjectRuntime ? convexUserId : null,
    userName: shouldEnableProjectRuntime ? user?.firstName || user?.email || null : null,
    userEmail: shouldEnableProjectRuntime ? user?.email || null : null,
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
        <PresenceAvatarGroup
          users={presenceUsers}
          maxVisible={4}
          onUserClick={handlePresenceUserClick}
        />
      ) : null,
    [handlePresenceUserClick, presenceUsers],
  );

  const workspaceSelectionId = useMemo(
    () => getWorkspaceSelectionId(resolvedScope.activeWorkspace),
    [resolvedScope.activeWorkspace],
  );

  const collaborationProjectId = useMemo((): Id<"projects"> | null => {
    if (project?._id) return project._id;
    const entry = readLastWorkbenchRoute(workspaceSelectionId);
    if (!entry?.projectId) return null;
    return entry.projectId as Id<"projects">;
  }, [project?._id, workspaceSelectionId]);

  const chromeHeader = useProjectChromeHeader({
    isSettingsModeRoute,
    pathname: location.pathname,
    workspaceScoped,
    presencePreSearchAddon: presenceHeaderAddon,
    projectId: collaborationProjectId,
    projectName: effectiveProjectName,
    editorProjectPath: effectiveLocalPath ?? null,
  });

  const layoutContent = (
    <SidebarProvider>
      <div className="h-screen w-screen bg-transparent flex flex-col overflow-hidden">
        {/* Main content */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden relative">
          {isAppStoreRoute ? (
            <AppStoreSidebar color="currentColor" user={user} onLogout={logout} />
          ) : isSettingsModeRoute ? (
            <SettingsSidebar color="currentColor" user={user} onLogout={logout} />
          ) : (
            <ProjectSidebar
              color="currentColor"
              user={user}
              onLogout={logout}
              projectId={project?._id ?? null}
            />
          )}
          <SidebarInset
            color="currentColor"
            className="flex flex-col flex-1 min-w-0 overflow-hidden md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none"
          >
            <UnifiedHeader
              className="border-b-0 bg-transparent"
              layoutMode="fixed"
              leftWindowControlsInset
              compactHeaderActions
              {...chromeHeader}
            />
            <div
              className="h-10 shrink-0 border-b border-border/60 bg-background"
              aria-hidden="true"
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
                {children || <Outlet />}
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
      localPath: effectiveLocalPath ?? null,
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
      effectiveLocalPath,
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
      <ProjectSyncProvider
        projectId={shouldEnableProjectRuntime ? project?._id ?? null : null}
        userId={shouldEnableProjectRuntime ? convexUserId ?? null : null}
        userName={user?.firstName || user?.email || "User"}
        projectSlug={projectSlug}
        localPath={runtimeProjectPath}
        lastSyncAt={project?.lastSyncAt}
        collaborationEnabled={collaborationEnabled}
        activeBranch={activeBranch}
        sharedBranch={collabBranch}
        documentScopeId={documentScopeId}
      >
        {layoutContent}
      </ProjectSyncProvider>
    </ProjectRouteContext.Provider>
  );
}

"use client";

import { type ReactNode, useRef, useCallback, useEffect, useMemo } from "react";
import { Outlet, useLocation, useParams } from "@/lib/router";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useCachedQuery } from "@/stores/useQueryCache";
import { ProjectSidebar } from "../components/ProjectSidebar";
import { SettingsSidebar } from "../components/SettingsSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { UnifiedHeader } from "@/components/layouts/UnifiedHeader";
import { TerminalEventBridge } from "@/features/projects/components/TerminalEventBridge";
import { usePageContextStore } from "@/stores/usePageContextStore";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { ProjectSyncProvider } from "../contexts/ProjectSyncContext";
import { useProjectPresence } from "@/hooks/useProjectPresence";
import { useDiagnosticsBridge } from "@/hooks/useDiagnosticsBridge";
import { setVscodeWorkspaceProjectPath } from "@/lib/editor/vscodeFileSystemBridge";
import { PresenceAvatarGroup } from "@/components/presence/PresenceAvatarGroup";
import type { PresenceUser } from "@/hooks/useProjectPresence";
import { hasRecentProjectOpenSync } from "@/features/projects/lib/recentProjectOpenSync";
import { logGitOpenDebug } from "@/lib/git/gitOpenDebug";
import { buildLegacyProjectPath, buildProjectPath } from "@/features/projects/lib/projectRoutes";
import { readLastWorkbenchRoute } from "@/features/projects/lib/lastWorkbenchRoute";
import { useScopedAppContext } from "@/hooks/useScopedAppContext";
import { getWorkspaceSelectionId } from "@shared/types";
import { useLocalProjectPath } from "@/features/projects/hooks/useLocalProjectPath";
import { useProjectChromeHeader } from "@/features/projects/hooks/useProjectChromeHeader";

interface ProjectLayoutProps {
  children?: ReactNode;
}

interface ProjectLayoutLocationState {
  syncMode?: "git";
  localPath?: string | null;
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
  const { convexUserId, user, logout } = useAuth();
  const { preferredConvexOrganizationId, workspaceScoped, resolvedScope } = useScopedAppContext();
  const location = useLocation();
  const navigate = useViewTransitionNavigate();
  const { slug: routeSlug, projectId: routeProjectId } = useParams();
  const locationState = (location.state as ProjectLayoutLocationState | null) ?? null;
  const initialSyncMode = locationState?.syncMode ?? null;

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
  const projectIdForSyncBypass = routeProjectId ?? (project?._id ? String(project._id) : null);
  const shouldSkipInitialSyncCheck =
    initialSyncMode === "git" ||
    project?.syncMode === "git" ||
    (projectIdForSyncBypass ? hasRecentProjectOpenSync(projectIdForSyncBypass) : false);
  useEffect(() => {
    if (!project?._id) {
      return;
    }

    logGitOpenDebug("project_layout:route_state", {
      projectId: String(project._id),
      routeProjectId: routeProjectId ?? null,
      routeSlug: routeSlug ?? null,
      syncMode: project.syncMode ?? null,
      initialSyncMode,
      shouldSkipInitialSyncCheck,
      projectIdForSyncBypass,
    });
  }, [
    initialSyncMode,
    project?._id,
    project?.syncMode,
    projectIdForSyncBypass,
    routeProjectId,
    routeSlug,
    shouldSkipInitialSyncCheck,
  ]);
  const projectSlug = project?.slug ?? routeSlug ?? null;
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
  const { localPath: effectiveLocalPath } = useLocalProjectPath({
    initialPath: navigationLocalPath,
    preferInitialPath: Boolean(navigationLocalPath),
    projectId: project?._id ? String(project._id) : routeProjectId,
    projectSlug,
  });

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
          locationState?.syncMode || navigationLocalPath
            ? {
                syncMode: locationState?.syncMode,
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
    locationState?.syncMode,
    navigate,
    pendingTeamSetup,
    pendingTeamSetupReady,
    project?._id,
  ]);

  const rememberResolvedProjectPath = useCallback(
    async (projectPath: string) => {
      if (!project?._id) {
        return;
      }

      const result = await window.electronAPI.project.rememberLocalPath({
        projectId: String(project._id),
        projectPath,
      });

      if (!result.success) {
        console.warn("[ProjectLayout] Failed to persist local project path:", result.error);
      }
    },
    [project?._id],
  );

  useEffect(() => {
    if (!effectiveLocalPath || !project?._id || !convexUserId) {
      return;
    }

    const mirrorKey = `${String(project._id)}:${convexUserId}:${effectiveLocalPath}`;
    if (mirroredLocalPathRef.current === mirrorKey) {
      return;
    }
    mirroredLocalPathRef.current = mirrorKey;

    void rememberResolvedProjectPath(effectiveLocalPath);
    void updateMemberLocalPath({
      projectId: project._id,
      userId: convexUserId,
      localPath: effectiveLocalPath,
    }).catch((error) => {
      mirroredLocalPathRef.current = null;
      console.warn("[ProjectLayout] Failed to mirror local project path to cloud metadata:", error);
    });
  }, [
    convexUserId,
    effectiveLocalPath,
    project?._id,
    rememberResolvedProjectPath,
    updateMemberLocalPath,
  ]);

  const isWorkbenchView = location.pathname.endsWith("/workbench");
  const isChangesView = location.pathname.endsWith("/changes");
  const isSettingsModeRoute =
    location.pathname.startsWith("/projects/settings/") ||
    location.pathname.startsWith("/projects/workspace/") ||
    location.pathname.startsWith("/projects/teams");
  const shouldEnableProjectRuntime = Boolean(effectiveLocalPath && (isWorkbenchView || isChangesView));
  const runtimeProjectPath = shouldEnableProjectRuntime ? effectiveLocalPath : null;

  useDiagnosticsBridge(runtimeProjectPath);

  useEffect(() => {
    setVscodeWorkspaceProjectPath(runtimeProjectPath);
    return () => {
      setVscodeWorkspaceProjectPath(null);
    };
  }, [runtimeProjectPath]);

  // Ensure project-scoped runtime processes don't leak across navigation.
  // - Stops any dev server PTY (devServer API)
  // - Kills any terminals started for this projectPath (terminal API)
  useEffect(() => {
    if (!effectiveLocalPath) return;

    return () => {
      const projectPath = effectiveLocalPath;

      // Stop dev server if running (ok if already stopped)
      void window.electronAPI.devServer.stop({ projectPath }).catch(() => {
        // ignore
      });

      // Kill all terminals for this project (ok if none)
      void window.electronAPI.terminal
        .list({ projectPath })
        .then((terminalIds) =>
          Promise.all(
            terminalIds.map((terminalId) =>
              window.electronAPI.terminal.kill({ terminalId }).catch(() => null),
            ),
          ),
        )
        .catch(() => {
          // ignore
        });

      // Clear any stale terminal tabs in renderer state so we don't
      // keep dead terminal IDs after project path changes.
      useTerminalStore.getState().actions.resetProject(projectPath);
    };
  }, [effectiveLocalPath]);

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
    projectName: project?.name ?? null,
    editorProjectPath: effectiveLocalPath ?? null,
  });

  const layoutContent = (
    <SidebarProvider>
      <div className="h-screen w-screen bg-transparent flex flex-col overflow-hidden">
        {/* Main content */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden relative">
          {isSettingsModeRoute ? (
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
              breadcrumbs={[]}
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

  return (
    <ProjectSyncProvider
      projectId={shouldEnableProjectRuntime ? project?._id ?? null : null}
      userId={shouldEnableProjectRuntime ? convexUserId ?? null : null}
      userName={user?.firstName || user?.email || "User"}
      projectSlug={projectSlug}
      localPath={runtimeProjectPath}
      lastSyncAt={project?.lastSyncAt}
      skipInitialSyncCheck={shouldSkipInitialSyncCheck}
    >
      {layoutContent}
    </ProjectSyncProvider>
  );
}

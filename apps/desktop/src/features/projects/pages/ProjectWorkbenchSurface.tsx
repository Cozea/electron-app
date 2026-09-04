import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAccessibleProject } from "@/features/projects/hooks/useAccessibleProject";
import { useAuth } from "@/contexts/AuthContext";
import { useProjectHeader } from "@/features/projects/hooks/useProjectHeader";
import {
  DEFAULT_WORKBENCH_LANE_ID,
  type WorkbenchTileType,
  buildWorkbenchScopeKey,
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/features/workbench/model/workbenchStore";
import { WorkbenchKeepAliveHost } from "@/features/workbench/WorkbenchKeepAliveHost";
import type { WorkbenchKeepAliveSession } from "@/features/workbench/workbenchKeepAlive";
import {
  type TaskOverlayLocationState,
  type TaskOverlayPayload,
} from "@/features/tasks/model/taskFocusOverlay";
import { useLocation, useSearchParams } from "@/lib/router";
import { useTheme } from "@/contexts/ThemeContext";
import { ProjectShellTitleBarLeft } from "@/features/projects/ui/ProjectShellTitleBarLeft";
import { ProjectSyncIndicator } from "@/features/projects/ui/ProjectSyncIndicator";
import { WorkbenchHeaderBranchControl } from "@/features/workbench/WorkbenchHeaderBranchControl";
import { useProjectWorkbenchSearchParamSync } from "@/features/workbench/hooks/useProjectWorkbenchSearchParamSync";
import {
  markWorkbenchIntentApplied,
  readWorkbenchIntentFromState,
  wasWorkbenchIntentApplied,
} from "@/features/workbench/model/workbenchIntent";
import { activateProjectBranchLane } from "@/features/source-control/model/projectBranchSessionStore";
import { writeLastWorkbenchRoute } from "@/features/workbench/model/lastWorkbenchRoute";
import { useWorkbenchSessionLifecycle } from "@/features/workbench/hooks/useWorkbenchSessionLifecycle";
import { useOptionalProjectRouteContext } from "@/features/projects/contexts/ProjectRouteContext";
import {
  resolveWorkspaceRuntimeId,
  useWorkspaceRuntimeStore,
} from "@/features/workspace/useWorkspaceRuntimeStore";
import { useActiveWorkspaceOrNull } from "@/features/workspace/ActiveWorkspaceContext";
import { useWorkspaceIdentity } from "@/features/workspace/useWorkspaceIdentity";
import { useTranslation } from "@/lib/i18n";
import { WorkbenchCommandPaletteHost } from "@/features/workbench/command-palette/WorkbenchCommandPaletteHost";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const LazyProjectSettingsPage = lazy(() =>
  import("@/features/settings/pages/ProjectSettingsPage").then((module) => ({
    default: module.ProjectSettingsPage,
  })),
);
const LazyTaskFocusOverlay = lazy(() =>
  import("@/features/tasks/ui/TaskFocusOverlay").then((module) => ({
    default: module.TaskFocusOverlay,
  })),
);

function WorkbenchOverlayLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <div className="loader" />
        <span>{t('workbench.surface.loading')}</span>
      </div>
    </div>
  );
}

function getTaskOverlayKey(task: TaskOverlayPayload): string {
  return `${task.projectId}:${task.source}:${task.storageId}`;
}

export function ProjectWorkbenchSurface() {
  const { t } = useTranslation();
  const projectRouteContext = useOptionalProjectRouteContext();
  const { project, projectIdParam } = useAccessibleProject();
  const activeWorkspace = useActiveWorkspaceOrNull();
  const {
    workspaceId,
    projectRootPath: identityProjectRootPath,
    gitRootPath: identityGitRootPath,
  } = useWorkspaceIdentity();
  const projectName = project?.name ?? projectRouteContext?.projectName ?? "Project";
  const taskOverlayState = useLocation({
    select: (location) => (location.state as TaskOverlayLocationState | null)?.taskOverlay ?? null,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = project?._id ? String(project._id) : projectIdParam ?? null;
  const { theme } = useTheme();
  const { user } = useAuth();
  const [taskCards, setTaskCards] = useState<TaskOverlayPayload[]>(() =>
    taskOverlayState ? [taskOverlayState] : [],
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const collabBranch = projectRouteContext?.collabBranch ?? "main";
  const laneState = projectRouteContext?.laneState ?? null;
  const activeLane = projectRouteContext?.activeLane ?? null;
  const refreshLaneState = projectRouteContext?.refreshLaneState;
  const activeLaneId =
    activeLane?.id ??
    laneState?.activeLaneId ??
    laneState?.collabLaneId ??
    DEFAULT_WORKBENCH_LANE_ID;
  const activeWorkbenchId = activeLane?.workspaceId ?? workspaceId;
  // Until lane state resolves, activeLaneId is the "collab" placeholder, NOT a
  // real lane. Keying or ensuring a bench from it created (and switched to) an
  // empty sibling bench whenever resolution was slow — the "came back to an
  // empty workspace" bug. While pending: render a holding state, write nothing.
  const laneResolutionPending = Boolean(activeWorkbenchId) && !activeLane && !laneState;
  const projectRootPath = identityProjectRootPath;
  const gitRootPath = identityGitRootPath;
  const workbenchScopeKey = projectId
    ? buildWorkbenchScopeKey(projectId, activeLaneId, activeWorkbenchId)
    : null;
  const projectWorkbench = useProjectWorkbenchStore(
    useMemo(
      () => selectProjectWorkbench(projectId, activeLaneId, activeWorkbenchId),
      [activeLaneId, activeWorkbenchId, projectId],
    ),
  );
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions);
  const workspaceSelectionId = user?.id ?? "local-device";
  const currentWorkspaceRuntimeId = useMemo(
    () =>
      resolveWorkspaceRuntimeId({
        projectId: project?._id ?? null,
        workspaceId: activeWorkspace?.workspace.workspaceId ?? null,
        laneId: activeLaneId,
        workspaceRevision: activeWorkspace?.workspace.workspaceRevision ?? 1,
      }),
    [activeLaneId, activeWorkspace?.workspace.workspaceId, activeWorkspace?.workspace.workspaceRevision, project?._id],
  );
  const workspaceRuntimeRecord = useWorkspaceRuntimeStore(
    useMemo(
      () => (state) => (currentWorkspaceRuntimeId ? state.runtimes[currentWorkspaceRuntimeId] ?? null : null),
      [currentWorkspaceRuntimeId],
    ),
  );
  const workbenchSession = useWorkbenchSessionLifecycle({
    projectId,
    laneId: activeLaneId,
    workspaceId: activeWorkbenchId,
    backgroundMode:
      workspaceRuntimeRecord?.lifecycle === "background-frozen"
        ? "backgroundFrozen"
        : "backgroundWarm",
    enabled: Boolean(projectId),
  });
  const bindWorkspaceSessionSnapshot = useWorkspaceRuntimeStore((state) => state.actions.bindSessionSnapshot);
  // The dock runtime context renders on sessionKey only; tiles read snapshot
  // content (e.g. devServer initial state) through this getter on demand, so
  // lifecycle/binding broadcasts never re-render the dockview portal roots
  // and reads are never stale.
  const workbenchSessionKey = workbenchSession?.sessionKey ?? null;
  const workbenchSessionRef = useRef(workbenchSession);
  workbenchSessionRef.current = workbenchSession;
  const getWorkbenchSession = useCallback(() => workbenchSessionRef.current, []);

  useEffect(() => {
    if (!currentWorkspaceRuntimeId) {
      return;
    }

    bindWorkspaceSessionSnapshot(
      currentWorkspaceRuntimeId,
      workbenchSession ?? null,
    );
  }, [bindWorkspaceSessionSnapshot, currentWorkspaceRuntimeId, workbenchSession]);

  const headerWorkbench = useMemo(
    () => (
      <div className="flex min-w-0 items-center gap-2">
        <ProjectShellTitleBarLeft />
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="flex h-6 min-w-0 max-w-[min(320px,42vw)] items-center text-[11px] font-normal text-foreground"
            title={projectName}
          >
            <span className="truncate">{projectName}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <div className="inline-flex h-6 items-center rounded-md bg-secondary px-0.5 text-muted-foreground/85 transition-colors hover:bg-accent/80">
              {/* Lane/branch state is read from context inside the control so
                  this element stays identity-stable while lanes settle. */}
              <WorkbenchHeaderBranchControl
                triggerClassName="h-6 min-h-6 gap-px rounded-none border-0 bg-transparent px-1 font-normal text-inherit shadow-none hover:bg-transparent hover:text-inherit"
                trailing={
                  project?._id ? (
                    <ProjectSyncIndicator
                      variant="compact"
                      inheritPillTextColor
                      className="h-5 w-5 shrink-0 rounded-none bg-transparent shadow-none"
                    />
                  ) : null
                }
              />
            </div>
          </div>
        </div>
      </div>
    ),
    [project?._id, projectName],
  );

  useProjectHeader(headerWorkbench, null);

  const replaceSearchParams = useCallback(
    (nextParams: URLSearchParams) => {
      setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true });
    },
    [setSearchParams],
  );

  const openWorkbenchTarget = useCallback(
    (
      target: Extract<WorkbenchTileType, "assistantChat" | "browser" | "devServer" | "mobileSimulator" | "terminal">,
    ) => {
      if (!projectId) return;
      if (target === "devServer" || target === "mobileSimulator") {
        workbenchActions.openSingletonTile(projectId, activeLaneId, target, undefined, activeWorkbenchId);
        return;
      }
      workbenchActions.addTile(projectId, activeLaneId, target, undefined, activeWorkbenchId);
    },
    [activeLaneId, activeWorkbenchId, projectId, workbenchActions],
  );

  const focusWorkbenchTile = useCallback(
    (tileId: string) => {
      if (!projectId) return;
      workbenchActions.setActiveTile(projectId, activeLaneId, tileId, activeWorkbenchId);
    },
    [activeLaneId, activeWorkbenchId, projectId, workbenchActions],
  );

  useProjectWorkbenchSearchParamSync({
    projectId,
    activeLaneId,
    collabBranch,
    workspaceId: activeWorkbenchId,
    searchParams,
    replaceSearchParams,
    refreshLaneState: async () => {
      await refreshLaneState?.();
    },
    openWorkbenchTarget,
    focusWorkbenchTile,
  });

  // In-app intents arrive via navigation state (see lib/workbenchIntent.ts) —
  // no URL params, no cleanup replace-navigation. Each navigation produces a
  // fresh intent object; the ref makes application one-shot.
  const workbenchIntent = useLocation({
    select: (location) => readWorkbenchIntentFromState(location.state),
  });
  useEffect(() => {
    if (!projectId || !workbenchIntent || laneResolutionPending) return;
    if (wasWorkbenchIntentApplied(workbenchIntent)) return;

    // A freshly created/imported project can render this route before its local
    // workspace identity has hydrated. Applying a preview intent at that point
    // writes the tile into the workspace-less fallback bench, then the real bench
    // replaces it a moment later. Wait for the concrete target workspace so the
    // generated DevApp opens exactly once in the bench the user will keep.
    if (workbenchIntent.openDevAppPreview && !activeWorkbenchId) return;

    if (workbenchIntent.laneId && workbenchIntent.laneId !== activeLaneId) {
      // Activate the requested lane; the effect re-runs once activeLaneId
      // converges and then applies the tile part of the intent.
      activateProjectBranchLane({
        projectId,
        laneId: workbenchIntent.laneId,
        collabBranch,
        workspaceId: activeWorkbenchId,
      });
      void refreshLaneState?.();
      return;
    }

    markWorkbenchIntentApplied(workbenchIntent);
    if (workbenchIntent.focusTileId) {
      const liveWorkbench = selectProjectWorkbench(
        projectId,
        activeLaneId,
        activeWorkbenchId,
      )(useProjectWorkbenchStore.getState());
      if (liveWorkbench?.tiles[workbenchIntent.focusTileId]) {
        focusWorkbenchTile(workbenchIntent.focusTileId);
      }
      return;
    }
    if (workbenchIntent.openTile) {
      openWorkbenchTarget(workbenchIntent.openTile);
      return;
    }
    if (workbenchIntent.openDevAppPreview) {
      workbenchActions.addTile(
        projectId,
        activeLaneId,
        "devAppPreview",
        {
          title: "DevApp (development)",
          devAppPreviewRelativePath: workbenchIntent.openDevAppPreview.relativePath,
          devAppPreviewSourceProjectId: workbenchIntent.openDevAppPreview.sourceProjectId,
          devAppPreviewSourceWorkspaceId: workbenchIntent.openDevAppPreview.sourceWorkspaceId,
          devAppRef: workbenchIntent.openDevAppPreview.sourceRef,
        },
        activeWorkbenchId,
      );
    }
  }, [
    activeLaneId,
    activeWorkbenchId,
    collabBranch,
    focusWorkbenchTile,
    laneResolutionPending,
    openWorkbenchTarget,
    projectId,
    refreshLaneState,
    workbenchIntent,
    workbenchActions,
  ]);

  const closeSettingsOverlay = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("settings");
    replaceSearchParams(nextParams);
  };

  const openSettingsOverlay = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("settings", "1");
    replaceSearchParams(nextParams);
  }, [replaceSearchParams, searchParams]);

  useLayoutEffect(() => {
    if (!projectId || laneResolutionPending) return;
    workbenchActions.ensureWorkbench(projectId, activeLaneId, activeWorkbenchId);
  }, [activeLaneId, activeWorkbenchId, laneResolutionPending, projectId, workbenchActions]);

  useEffect(() => {
    if (!projectId || !workspaceSelectionId || laneResolutionPending) {
      return;
    }

    writeLastWorkbenchRoute({
      workspaceSelectionId,
      projectId,
      laneId: activeLaneId,
      focusTileId: projectWorkbench?.activeTileId ?? null,
      updatedAt: Date.now(),
    });
  }, [activeLaneId, laneResolutionPending, projectId, projectWorkbench?.activeTileId, workspaceSelectionId]);

  useEffect(() => {
    setIsSettingsOpen(searchParams.get("settings") === "1");
  }, [searchParams]);

  useEffect(() => {
    const nextTask = taskOverlayState;
    if (!nextTask) return;

    setTaskCards((current) => {
      const nextKey = getTaskOverlayKey(nextTask);
      const remaining = current.filter((task) => getTaskOverlayKey(task) !== nextKey);
      return [nextTask, ...remaining].slice(0, 3);
    });
  }, [taskOverlayState]);

  useEffect(() => {
    if (!projectId) {
      setTaskCards([]);
      return;
    }
    setTaskCards((current) => current.filter((task) => task.projectId === projectId));
  }, [projectId]);

  useEffect(() => {
    if (!isSettingsOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isSettingsOpen) setIsSettingsOpen(false);
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isSettingsOpen]);

  const resolvedDockviewThemeScheme =
    theme === "dark" || (theme === "system" && document.documentElement.classList.contains("dark"))
      ? "dark"
      : "light";

  const currentKeepAliveSession = useMemo<WorkbenchKeepAliveSession | null>(() => {
    if (!projectId || !workbenchScopeKey || !activeWorkbenchId || laneResolutionPending) {
      return null;
    }

    return {
      scopeKey: workbenchScopeKey,
      projectId,
      activeLaneId,
      workspaceId: activeWorkbenchId,
      projectRootPath,
      gitRootPath,
      projectName,
      framework: project?.frameworkInfo?.framework ?? null,
      storedDevCommand: project?.frameworkInfo?.devCommand ?? null,
      storedDevPort: project?.frameworkInfo?.devPort ?? null,
      workbenchSessionKey,
      themeScheme: resolvedDockviewThemeScheme,
      lastActiveAt: Date.now(),
    };
  }, [
    activeLaneId,
    activeWorkbenchId,
    gitRootPath,
    laneResolutionPending,
    project?.frameworkInfo?.devCommand,
    project?.frameworkInfo?.devPort,
    project?.frameworkInfo?.framework,
    projectId,
    projectName,
    projectRootPath,
    resolvedDockviewThemeScheme,
    workbenchScopeKey,
    workbenchSessionKey,
  ]);

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('workbench.surface.loadingWorkbench')}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-transparent"
      data-workbench-session-key={workbenchSession?.sessionKey ?? ""}
      data-workbench-lifecycle={workbenchSession?.lifecycle ?? "loading"}
    >
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="relative flex h-full min-h-0 min-w-0">
          <div
            className="relative min-w-0 flex-1 overflow-hidden bg-transparent"
          >
            <WorkbenchKeepAliveHost
              current={currentKeepAliveSession}
              getWorkbenchSession={getWorkbenchSession}
              fallback={<WorkbenchOverlayLoading />}
            />
          </div>

          <Dialog
            open={isSettingsOpen}
            onOpenChange={(open) => {
              if (!open) closeSettingsOverlay();
            }}
          >
            <DialogContent
              showCloseButton={false}
              className="inset-0 left-0 top-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-background p-0 sm:max-w-none"
              aria-label={t('workbench.surface.closeSettings')}
            >
              <aside className="flex min-h-0 w-full flex-1 flex-col bg-background">
                <div className="min-h-0 flex-1 overflow-hidden">
                  <Suspense fallback={<WorkbenchOverlayLoading />}>
                    <LazyProjectSettingsPage presentation="embedded" onRequestClose={closeSettingsOverlay} />
                  </Suspense>
                </div>
              </aside>
            </DialogContent>
          </Dialog>

          {taskCards.length > 0 ? (
            <aside className="flex w-[320px] shrink-0 flex-col border-l border-border/60">
              <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('workbench.surface.selectedTasks')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('workbench.surface.contextCardsDesc')}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{taskCards.length}</span>
              </div>

              <div className="app-scrollbar flex-1 space-y-3 overflow-auto px-4 py-3">
                {taskCards.map((task) => (
                  <Suspense
                    fallback={<div className="h-32 rounded-xl bg-muted/50" />}
                    key={getTaskOverlayKey(task)}
                  >
                    <LazyTaskFocusOverlay
                      task={task}
                      presentation="docked"
                      onDismiss={() => {
                        const taskKey = getTaskOverlayKey(task);
                        setTaskCards((current) =>
                          current.filter((card) => getTaskOverlayKey(card) !== taskKey),
                        );
                      }}
                    />
                  </Suspense>
                ))}
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      <WorkbenchCommandPaletteHost
        projectId={projectId}
        laneId={activeLaneId}
        workspaceId={activeWorkbenchId}
        projectRootPath={projectRootPath}
        openSettings={openSettingsOverlay}
        closeSettings={closeSettingsOverlay}
        isSettingsOpen={isSettingsOpen}
      />
    </div>
  );
}

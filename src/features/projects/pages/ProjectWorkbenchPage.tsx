import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { DockviewReact } from "dockview";

import "dockview/dist/styles/dockview.css";

import "@/features/projects/components/workbench/workbench.css";
import { useAccessibleProject } from "@/features/projects/hooks/useAccessibleProject";
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProjectHeader } from "@/hooks/useProjectHeader";
import {
  DEFAULT_WORKBENCH_LANE_ID,
  type WorkbenchTileType,
  buildWorkbenchScopeKey,
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore";
import { TaskFocusOverlay } from "@/features/projects/components/TaskFocusOverlay";
import {
  WORKBENCH_DOCK_COMPONENTS,
  WorkbenchDockRuntimeProvider,
} from "@/features/projects/components/workbench/WorkbenchDockPanels";
import {
  type TaskOverlayLocationState,
  type TaskOverlayPayload,
} from "@/features/projects/lib/taskFocusOverlay";
import { useLocation, useSearchParams } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { ChangesPage } from "@/features/projects/pages/ChangesPage";
import { ProjectShellTitleBarLeft } from "@/features/projects/components/ProjectShellTitleBarLeft";
import { ProjectSyncIndicator } from "@/features/projects/components/ProjectSyncIndicator";
import { WorkbenchHeaderBranchControl } from "@/features/projects/components/workbench/WorkbenchHeaderBranchControl";
import { useWorkbenchDockviewRuntime } from "@/features/projects/hooks/useWorkbenchDockviewRuntime";
import { useProjectWorkbenchSearchParamSync } from "@/features/projects/hooks/useProjectWorkbenchSearchParamSync";
import { writeLastWorkbenchRoute } from "@/features/projects/lib/lastWorkbenchRoute";
import {
  ensureWorkbenchLayoutPersistenceReady,
  peekPersistedWorkbenchLayout,
} from "@/features/projects/lib/workbenchLayoutPersistence";
import { useWorkbenchSessionLifecycle } from "@/features/projects/hooks/useWorkbenchSessionLifecycle";
import { ProjectSettingsPage } from "@/features/projects/pages/ProjectSettingsPage";
import { useOptionalProjectRouteContext } from "@/features/projects/contexts/ProjectRouteContext";
import {
  resolveWorkspaceRuntimeId,
  useWorkspaceRuntimeStore,
} from "@/features/projects/workspaces/useWorkspaceRuntimeStore";

function getTaskOverlayKey(task: TaskOverlayPayload): string {
  return `${task.projectId}:${task.source}:${task.storageId}`;
}

export function ProjectWorkbenchPage() {
  const projectRouteContext = useOptionalProjectRouteContext();
  const { project, projectIdParam } = useAccessibleProject();
  const syncContext = useOptionalProjectSyncContext();
  const projectPath = syncContext?.projectPath ?? projectRouteContext?.localPath ?? null;
  const projectName = project?.name ?? projectRouteContext?.projectName ?? "Project";
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = project?._id ? String(project._id) : projectIdParam ?? null;
  const locationState = (location.state as TaskOverlayLocationState | null) ?? null;
  const { theme } = useTheme();
  const { user } = useAuth();
  const [taskCards, setTaskCards] = useState<TaskOverlayPayload[]>(() =>
    locationState?.taskOverlay ? [locationState.taskOverlay] : [],
  );
  const [isChangesOpen, setIsChangesOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLayoutPersistenceReady, setIsLayoutPersistenceReady] = useState(false);
  const collabBranch = projectRouteContext?.collabBranch ?? "main";
  const laneState = projectRouteContext?.laneState ?? null;
  const activeLane = projectRouteContext?.activeLane ?? null;
  const refreshLaneState = projectRouteContext?.refreshLaneState;
  const activeLaneId =
    activeLane?.id ??
    laneState?.activeLaneId ??
    laneState?.collabLaneId ??
    DEFAULT_WORKBENCH_LANE_ID;
  const activeWorkbenchPath = activeLane?.projectPath ?? projectPath;
  const workbenchScopeKey = projectId
    ? buildWorkbenchScopeKey(projectId, activeLaneId, activeWorkbenchPath)
    : null;
  const legacyWorkbenchScopeKey = projectId
    ? buildWorkbenchScopeKey(projectId, activeLaneId, null)
    : null;
  const projectWorkbench = useProjectWorkbenchStore(
    useMemo(
      () => selectProjectWorkbench(projectId, activeLaneId, activeWorkbenchPath),
      [activeLaneId, activeWorkbenchPath, projectId],
    ),
  );
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions);
  const workspaceSelectionId = user?.id ?? "local-device";
  const currentWorkspaceRuntimeId = useMemo(
    () =>
      resolveWorkspaceRuntimeId({
        projectId: project?._id ?? null,
        laneId: activeLaneId,
        localPath: activeWorkbenchPath,
      }),
    [activeLaneId, activeWorkbenchPath, project?._id],
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
    projectPath: activeWorkbenchPath,
    backgroundMode:
      workspaceRuntimeRecord?.lifecycle === "background-frozen"
        ? "backgroundFrozen"
        : "backgroundWarm",
    enabled: Boolean(projectId),
  });
  const bindWorkspaceSessionSnapshot = useWorkspaceRuntimeStore((state) => state.actions.bindSessionSnapshot);
  const persistedLayout = useMemo(() => {
    if (!workbenchScopeKey || !projectWorkbench) {
      return null;
    }

    const pathAwareLayout = peekPersistedWorkbenchLayout(
      workbenchScopeKey,
      projectWorkbench.layoutResetKey,
    );
    if (
      pathAwareLayout ||
      !legacyWorkbenchScopeKey ||
      legacyWorkbenchScopeKey === workbenchScopeKey
    ) {
      return pathAwareLayout;
    }

    return peekPersistedWorkbenchLayout(
      legacyWorkbenchScopeKey,
      projectWorkbench.layoutResetKey,
    );
  }, [legacyWorkbenchScopeKey, projectWorkbench, workbenchScopeKey]);
  const {
    dockviewHostRef,
    getSelectionPreviewTile,
    handleResolveSelectionTile,
    handleDuplicateAssistantTile,
    handleSplitTile,
    handleDockviewReady,
  } = useWorkbenchDockviewRuntime({
    projectId,
    activeLaneId,
    projectPath: activeWorkbenchPath,
    workbenchSessionKey: workbenchSession?.sessionKey ?? null,
    projectWorkbench,
    workbenchScopeKey,
    isLayoutPersistenceReady,
    persistedLayout,
  });

  useEffect(() => {
    ensureWorkbenchLayoutPersistenceReady();
    setIsLayoutPersistenceReady(true);
  }, []);

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
            <span className="text-muted-foreground/40 font-light select-none">/</span>
            <WorkbenchHeaderBranchControl
              projectId={projectId}
              projectPath={projectPath}
              collabBranch={collabBranch}
              laneState={laneState}
              activeLane={activeLane}
              onLaneStateChange={() => {
                void refreshLaneState?.();
              }}
              triggerClassName="h-6 rounded-md border-0 bg-transparent px-1.5 hover:bg-muted/60"
            />
            {project?._id ? (
              <ProjectSyncIndicator
                variant="compact"
                className="h-5 w-5 shrink-0 rounded-sm bg-transparent"
              />
            ) : null}
          </div>
        </div>
      </div>
    ),
    [
      activeLane,
      collabBranch,
      laneState,
      project,
      project?._id,
      projectName,
      projectId,
      projectPath,
      refreshLaneState,
    ],
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
        workbenchActions.openSingletonTile(projectId, activeLaneId, target, undefined, activeWorkbenchPath);
        return;
      }
      workbenchActions.addTile(projectId, activeLaneId, target, undefined, activeWorkbenchPath);
    },
    [activeLaneId, activeWorkbenchPath, projectId, workbenchActions],
  );

  const focusWorkbenchTile = useCallback(
    (tileId: string) => {
      if (!projectId) return;
      workbenchActions.setActiveTile(projectId, activeLaneId, tileId, activeWorkbenchPath);
    },
    [activeLaneId, activeWorkbenchPath, projectId, workbenchActions],
  );

  const { closeChangesOverlay } = useProjectWorkbenchSearchParamSync({
    projectId,
    activeLaneId,
    collabBranch,
    projectPath: activeWorkbenchPath,
    searchParams,
    replaceSearchParams,
    refreshLaneState: async () => {
      await refreshLaneState?.();
    },
    openWorkbenchTarget,
    focusWorkbenchTile,
  });

  const closeSettingsOverlay = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("settings");
    replaceSearchParams(nextParams);
  };

  useLayoutEffect(() => {
    if (!projectId) return;
    workbenchActions.ensureWorkbench(projectId, activeLaneId, activeWorkbenchPath);
  }, [activeLaneId, activeWorkbenchPath, projectId, workbenchActions]);

  useEffect(() => {
    if (!projectId || !workspaceSelectionId) {
      return;
    }

    writeLastWorkbenchRoute({
      workspaceSelectionId,
      projectId,
      laneId: activeLaneId,
      focusTileId: projectWorkbench?.activeTileId ?? null,
      updatedAt: Date.now(),
    });
  }, [activeLaneId, projectId, projectWorkbench?.activeTileId, workspaceSelectionId]);

  useEffect(() => {
    setIsChangesOpen(searchParams.get("changes") === "1");
    setIsSettingsOpen(searchParams.get("settings") === "1");
  }, [searchParams]);

  useEffect(() => {
    const nextTask = locationState?.taskOverlay;
    if (!nextTask) return;

    setTaskCards((current) => {
      const nextKey = getTaskOverlayKey(nextTask);
      const remaining = current.filter((task) => getTaskOverlayKey(task) !== nextKey);
      return [nextTask, ...remaining].slice(0, 3);
    });
  }, [locationState?.taskOverlay]);

  useEffect(() => {
    if (!projectId) {
      setTaskCards([]);
      setIsChangesOpen(false);
      return;
    }
    setTaskCards((current) => current.filter((task) => task.projectId === projectId));
  }, [projectId]);

  useEffect(() => {
    if (!isChangesOpen && !isSettingsOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isChangesOpen) setIsChangesOpen(false);
      if (isSettingsOpen) setIsSettingsOpen(false);
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isChangesOpen, isSettingsOpen]);

  const resolvedDockviewThemeClass =
    theme === "dark" || (theme === "system" && document.documentElement.classList.contains("dark"))
      ? "dockview-theme-dark"
      : "dockview-theme-light";

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading workbench…
      </div>
    );
  }

  return (
    <WorkbenchDockRuntimeProvider
      projectId={projectId}
      laneId={activeLaneId}
      projectPath={activeWorkbenchPath}
      projectName={projectName}
      workspaceId={currentWorkspaceRuntimeId}
      framework={project?.frameworkInfo?.framework ?? null}
      storedDevCommand={project?.frameworkInfo?.devCommand ?? null}
      storedDevPort={project?.frameworkInfo?.devPort ?? null}
      workbenchSession={workbenchSession}
      getSelectionPreviewTile={getSelectionPreviewTile}
      onDuplicateAssistantTile={handleDuplicateAssistantTile}
      onResolveSelectionTile={handleResolveSelectionTile}
      onSplitTile={handleSplitTile}
    >
      <div
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
        data-workbench-session-key={workbenchSession?.sessionKey ?? ""}
        data-workbench-lifecycle={workbenchSession?.lifecycle ?? "loading"}
      >
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
          <div className="relative flex h-full min-h-0 min-w-0">
            <div
              className="relative min-w-0 flex-1 overflow-hidden bg-content-surface"
            >
              <div ref={dockviewHostRef} className="h-full min-h-0 w-full min-w-0">
                <DockviewReact
                  key={workbenchScopeKey ?? "workbench"}
                  className={cn(
                    "cozea-workbench-dockview h-full w-full min-w-0",
                    resolvedDockviewThemeClass,
                  )}
                  components={WORKBENCH_DOCK_COMPONENTS}
                  disableFloatingGroups
                  tabAnimation="smooth"
                  singleTabMode="default"
                  onReady={handleDockviewReady}
                />
              </div>
            </div>

            {isChangesOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Close changes"
                  data-workbench-browser-overlay="true"
                  data-workbench-browser-overlay-reason="Changes overlay"
                  className="absolute inset-0 z-20 bg-background/30 transition-colors hover:bg-background/35"
                  onClick={closeChangesOverlay}
                />

                <aside
                  data-workbench-browser-overlay="true"
                  data-workbench-browser-overlay-reason="Changes overlay"
                  className="absolute inset-0 z-30 flex w-full max-w-full flex-col bg-background"
                >
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <ChangesPage presentation="embedded" />
                  </div>
                </aside>
              </>
            ) : null}

            {isSettingsOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Close settings"
                  data-workbench-browser-overlay="true"
                  data-workbench-browser-overlay-reason="Settings overlay"
                  className="absolute inset-0 z-20 bg-background/30 transition-colors hover:bg-background/35"
                  onClick={closeSettingsOverlay}
                />

                <aside
                  data-workbench-browser-overlay="true"
                  data-workbench-browser-overlay-reason="Settings overlay"
                  className="absolute inset-0 z-30 flex w-full max-w-full flex-col bg-background"
                >
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <ProjectSettingsPage presentation="embedded" onRequestClose={closeSettingsOverlay} />
                  </div>
                </aside>
              </>
            ) : null}

            {taskCards.length > 0 ? (
              <aside className="flex w-[320px] shrink-0 flex-col border-l border-border/60">
                <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Selected Tasks</p>
                    <p className="text-xs text-muted-foreground">
                      Context cards stay beside the workbench.
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">{taskCards.length}</span>
                </div>

                <div className="app-scrollbar flex-1 space-y-3 overflow-auto px-4 py-3">
                  {taskCards.map((task) => (
                    <TaskFocusOverlay
                      key={getTaskOverlayKey(task)}
                      task={task}
                      presentation="docked"
                      onDismiss={() => {
                        const taskKey = getTaskOverlayKey(task);
                        setTaskCards((current) =>
                          current.filter((card) => getTaskOverlayKey(card) !== taskKey),
                        );
                      }}
                    />
                  ))}
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </div>
    </WorkbenchDockRuntimeProvider>
  );
}

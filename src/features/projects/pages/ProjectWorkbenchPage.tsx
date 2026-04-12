import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { DockviewReact } from "dockview";

import "dockview/dist/styles/dockview.css";

import "@/features/projects/components/workbench/workbench.css";
import { useAccessibleProject } from "@/features/projects/hooks/useAccessibleProject";
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext";
import { useProjectLaneState } from "@/features/projects/hooks/useProjectLaneState";
import { useAuth } from "@/contexts/AuthContext";
import { useProjectHeader } from "@/hooks/useProjectHeader";
import {
  DEFAULT_WORKBENCH_LANE_ID,
  type WorkbenchTileType,
  buildWorkbenchScopeKey,
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
import { useResolvedScope } from "@/hooks/useResolvedScope";
import { ChangesPage } from "@/features/projects/pages/ChangesPage";
import { WorkbenchEdgeInsertion } from "@/features/projects/components/workbench/WorkbenchEdgeInsertion";
import { WorkbenchJunctionInsertion } from "@/features/projects/components/workbench/WorkbenchJunctionInsertion";
import { WorkbenchSeamInsertion } from "@/features/projects/components/workbench/WorkbenchSeamInsertion";
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
import { getWorkspaceSelectionId } from "@shared/types";
import { useOptionalProjectRouteContext } from "@/features/projects/contexts/ProjectRouteContext";

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
  const { convexUserId } = useAuth();
  const resolvedScope = useResolvedScope({ ignoreLocation: true });
  const [taskCards, setTaskCards] = useState<TaskOverlayPayload[]>(() =>
    locationState?.taskOverlay ? [locationState.taskOverlay] : [],
  );
  const [isChangesOpen, setIsChangesOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLayoutPersistenceReady, setIsLayoutPersistenceReady] = useState(false);
  const collabBranch =
    project?.sourceControl?.activeCollabBranch ??
    project?.sourceControl?.defaultBranch ??
    project?.gitRepository?.defaultBranch ??
    "main";
  const {
    laneState,
    activeLane,
    refreshLaneState,
  } = useProjectLaneState({
    projectId,
    projectPath,
    collabBranch,
  });
  const activeLaneId =
    activeLane?.id ??
    laneState?.activeLaneId ??
    laneState?.collabLaneId ??
    DEFAULT_WORKBENCH_LANE_ID;
  const workbenchScopeKey = projectId ? buildWorkbenchScopeKey(projectId, activeLaneId) : null;
  const projectWorkbench = useProjectWorkbenchStore((state) =>
    workbenchScopeKey ? (state.workbenches[workbenchScopeKey] ?? null) : null,
  );
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions);
  const activeWorkbenchPath = activeLane?.projectPath ?? projectPath;
  const workbenchSession = useWorkbenchSessionLifecycle({
    projectId,
    laneId: activeLaneId,
    projectPath: activeWorkbenchPath,
    enabled: Boolean(projectId),
  });
  const workspaceSelectionId =
    getWorkspaceSelectionId(resolvedScope.activeWorkspace) ??
    resolvedScope.activeWorkspace?.organizationId ??
    null;
  const persistedLayout = useMemo(() => {
    if (!workbenchScopeKey || !projectWorkbench) {
      return null;
    }

    return peekPersistedWorkbenchLayout(
      workbenchScopeKey,
      projectWorkbench.layoutResetKey,
    );
  }, [projectWorkbench, workbenchScopeKey]);
  const {
    dockviewHostRef,
    edgeInsertionArmed,
    edgeTargets,
    junctionTargets,
    seamTargets,
    getSelectionPreviewTile,
    handleWorkbenchPointerMove,
    handleWorkbenchPointerLeave,
    handleResolveSelectionTile,
    handleDuplicateAssistantTile,
    handleEdgeActivate,
    handleJunctionActivate,
    handleSeamActivate,
    handleDockviewReady,
  } = useWorkbenchDockviewRuntime({
    projectId,
    activeLaneId,
    projectPath: activeWorkbenchPath,
    projectWorkbench,
    workbenchScopeKey,
    isLayoutPersistenceReady,
    persistedLayout,
  });

  useEffect(() => {
    ensureWorkbenchLayoutPersistenceReady();
    setIsLayoutPersistenceReady(true);
  }, []);
  const headerCenter = useMemo(
    () => (
      <div className="flex min-w-0 max-w-[52vw] items-center justify-center gap-2">
        <div className="flex h-6 min-w-0 max-w-full items-center">
          <div
            className="flex h-6 min-w-0 max-w-[320px] items-center px-2.5 text-xs font-medium text-foreground"
            title={projectName}
          >
            <span className="block truncate">{projectName}</span>
          </div>
          <div className="h-4 w-px shrink-0 bg-border" aria-hidden />
          <WorkbenchHeaderBranchControl
            project={project ?? null}
            projectId={projectId}
            projectPath={projectPath}
            collabBranch={collabBranch}
            laneState={laneState}
            activeLane={activeLane}
            userId={convexUserId}
            onLaneStateChange={() => {
              void refreshLaneState();
            }}
            triggerClassName="h-6 rounded-md border-0 bg-transparent px-1.5 hover:bg-muted/60"
          />
        </div>
        {project?._id ? (
          <ProjectSyncIndicator
            variant="compact"
            className="h-5 w-5 shrink-0 rounded-sm bg-transparent"
          />
        ) : null}
      </div>
    ),
    [
      activeLane,
      collabBranch,
      convexUserId,
      laneState,
      project,
      project?._id,
      projectName,
      projectId,
      projectPath,
      refreshLaneState,
    ],
  );
  const headerControls = useMemo(
    () => <ProjectShellTitleBarLeft projectPath={activeWorkbenchPath} />,
    [activeWorkbenchPath],
  );

  useProjectHeader(headerControls, headerCenter);

  const replaceSearchParams = useCallback(
    (nextParams: URLSearchParams) => {
      setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true });
    },
    [setSearchParams],
  );

  const openWorkbenchTarget = useCallback(
    (
      target: Extract<WorkbenchTileType, "assistantChat" | "browser" | "devServer" | "terminal">,
    ) => {
      if (!projectId) return;
      if (target === "devServer") {
        workbenchActions.openSingletonTile(projectId, activeLaneId, "devServer");
        return;
      }
      workbenchActions.addTile(projectId, activeLaneId, target);
    },
    [activeLaneId, projectId, workbenchActions],
  );

  const focusWorkbenchTile = useCallback(
    (tileId: string) => {
      if (!projectId) return;
      workbenchActions.setActiveTile(projectId, activeLaneId, tileId);
    },
    [activeLaneId, projectId, workbenchActions],
  );

  const { closeChangesOverlay } = useProjectWorkbenchSearchParamSync({
    projectId,
    activeLaneId,
    searchParams,
    replaceSearchParams,
    refreshLaneState,
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
    workbenchActions.ensureWorkbench(projectId, activeLaneId);
  }, [activeLaneId, projectId, workbenchActions]);

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

  if (!projectId || !projectWorkbench) {
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
      workspaceId={workspaceSelectionId}
      framework={project?.frameworkInfo?.framework ?? null}
      storedDevCommand={project?.frameworkInfo?.devCommand ?? null}
      storedDevPort={project?.frameworkInfo?.devPort ?? null}
      workbenchSession={workbenchSession}
      getSelectionPreviewTile={getSelectionPreviewTile}
      onDuplicateAssistantTile={handleDuplicateAssistantTile}
      onResolveSelectionTile={handleResolveSelectionTile}
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
              onPointerMove={handleWorkbenchPointerMove}
              onPointerLeave={handleWorkbenchPointerLeave}
            >
              <WorkbenchEdgeInsertion
                armed={edgeInsertionArmed}
                targets={edgeTargets}
                disabledEdges={isChangesOpen ? ["top", "right"] : ["top"]}
                onEdgeActivate={handleEdgeActivate}
              />
              <WorkbenchJunctionInsertion
                armed={edgeInsertionArmed}
                targets={junctionTargets}
                onJunctionActivate={handleJunctionActivate}
              />
              <WorkbenchSeamInsertion
                armed={edgeInsertionArmed}
                targets={seamTargets}
                onSeamActivate={handleSeamActivate}
              />
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

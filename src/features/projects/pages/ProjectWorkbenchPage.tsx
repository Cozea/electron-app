import { useEffect, useMemo, useState } from "react";
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
import { WorkbenchSeamInsertion } from "@/features/projects/components/workbench/WorkbenchSeamInsertion";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ProjectSyncIndicator } from "@/features/projects/components/ProjectSyncIndicator";
import { WorkbenchHeaderEditorControl } from "@/features/projects/components/workbench/WorkbenchHeaderEditorControl";
import { WorkbenchHeaderBranchControl } from "@/features/projects/components/workbench/WorkbenchHeaderBranchControl";
import { useWorkbenchDockviewRuntime } from "@/features/projects/hooks/useWorkbenchDockviewRuntime";
import { writeLastWorkbenchRoute } from "@/features/projects/lib/lastWorkbenchRoute";
import {
  ensureWorkbenchLayoutPersistenceReady,
  peekPersistedWorkbenchLayout,
} from "@/features/projects/lib/workbenchLayoutPersistence";
import { ProjectSettingsPage } from "@/features/projects/pages/ProjectSettingsPage";
import { getWorkspaceSelectionId } from "@shared/types";
import { useOptionalSidebar } from "@/components/ui/sidebar";

function normalizeOpenTargetParam(
  value: string | null,
):
  | "changes"
  | Extract<WorkbenchTileType, "browser" | "terminal" | "devServer" | "assistantChat">
  | null {
  if (
    value === "changes" ||
    value === "browser" ||
    value === "terminal" ||
    value === "devServer" ||
    value === "assistantChat"
  ) {
    return value;
  }
  return null;
}

function getTaskOverlayKey(task: TaskOverlayPayload): string {
  return `${task.projectId}:${task.source}:${task.storageId}`;
}

export function ProjectWorkbenchPage() {
  const { project } = useAccessibleProject();
  const syncContext = useOptionalProjectSyncContext();
  const projectPath = syncContext?.projectPath ?? null;
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = project?._id ? String(project._id) : null;
  const locationState = (location.state as TaskOverlayLocationState | null) ?? null;
  const { theme } = useTheme();
  const sidebar = useOptionalSidebar();
  const sidebarChromeOpen = Boolean(
    sidebar && (sidebar.isMobile ? sidebar.openMobile : sidebar.open),
  );
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
    isLoading: isLaneStateLoading,
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
    seamZones,
    getSelectionPreviewTile,
    handleWorkbenchPointerMove,
    handleWorkbenchPointerLeave,
    handleResolveSelectionTile,
    handleDuplicateAssistantTile,
    handleEdgeActivate,
    handleSeamActivate,
    handleDockviewReady,
  } = useWorkbenchDockviewRuntime({
    projectId,
    activeLaneId,
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
            title={project?.name ?? "Project"}
          >
            <span className="block truncate">{project?.name ?? "Project"}</span>
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
      project?.name,
      projectId,
      projectPath,
      refreshLaneState,
    ],
  );
  const headerControls = useMemo(
    () => (
      <div className="workbench-header-toolbar flex min-w-0 items-center gap-0">
        <SidebarTrigger
          className={cn(
            "h-7 w-7 shrink-0 rounded-md",
            sidebarChromeOpen
              ? "text-muted-foreground/75 hover:bg-sidebar-accent hover:text-foreground"
              : "text-muted-foreground/75 hover:bg-muted/60 hover:text-foreground",
          )}
        />
        <div
          className={cn(
            "mx-0.5 h-4 w-px shrink-0",
            sidebarChromeOpen ? "bg-sidebar-border" : "bg-border",
          )}
          aria-hidden
        />
        <WorkbenchHeaderEditorControl
          projectPath={activeWorkbenchPath}
          adjacentOpenSidebar={sidebarChromeOpen}
        />
      </div>
    ),
    [activeWorkbenchPath, sidebarChromeOpen],
  );

  useProjectHeader(headerControls, headerCenter);

  const closeChangesOverlay = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("changes");
    nextParams.delete("openTile");
    nextParams.delete("userId");
    setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true });
  };

  const closeSettingsOverlay = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("settings");
    setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true });
  };

  useEffect(() => {
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
    if (!projectId) return;

    const requestedLaneId = searchParams.get("lane");
    if (!requestedLaneId || requestedLaneId === activeLaneId) {
      return;
    }

    let isCancelled = false;

    void (async () => {
      try {
        await window.electronAPI.project.setActiveLane({
          projectId,
          laneId: requestedLaneId,
        });

        if (!isCancelled) {
          await refreshLaneState();
        }
      } catch (error) {
        console.warn("[ProjectWorkbenchPage] Failed to activate requested lane", error);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [activeLaneId, projectId, refreshLaneState, searchParams]);

  useEffect(() => {
    if (!projectId) return;
    const requestedLaneId = searchParams.get("lane");
    if (requestedLaneId && requestedLaneId !== activeLaneId) return;
    const requestedOpenTarget = normalizeOpenTargetParam(searchParams.get("openTile"));
    if (!requestedOpenTarget) return;
    if (requestedOpenTarget === "changes") {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("lane");
      nextParams.delete("openTile");
      nextParams.set("changes", "1");
      setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true });
    } else {
      if (
        requestedOpenTarget === "assistantChat" ||
        requestedOpenTarget === "browser" ||
        requestedOpenTarget === "terminal"
      ) {
        workbenchActions.addTile(projectId, activeLaneId, requestedOpenTarget);
      } else {
        workbenchActions.openSingletonTile(projectId, activeLaneId, requestedOpenTarget);
      }
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("lane");
      nextParams.delete("openTile");
      setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true });
    }
  }, [activeLaneId, projectId, searchParams, setSearchParams, workbenchActions]);

  useEffect(() => {
    if (!projectId) return;
    const requestedLaneId = searchParams.get("lane");
    if (requestedLaneId && requestedLaneId !== activeLaneId) return;
    const requestedTileId = searchParams.get("focusTile");
    if (!requestedTileId) return;

    const liveWorkbench =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ];

    if (liveWorkbench?.tiles[requestedTileId]) {
      workbenchActions.setActiveTile(projectId, activeLaneId, requestedTileId);
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("lane");
    nextParams.delete("focusTile");
    setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true });
  }, [activeLaneId, projectId, searchParams, setSearchParams, workbenchActions]);

  useEffect(() => {
    if (!projectId) return;

    const requestedLaneId = searchParams.get("lane");
    if (!requestedLaneId || requestedLaneId !== activeLaneId) return;
    if (searchParams.get("openTile") || searchParams.get("focusTile")) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("lane");
    setSearchParams(Object.fromEntries(nextParams.entries()) as never, { replace: true });
  }, [activeLaneId, projectId, searchParams, setSearchParams]);

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

  const handleOpenBrowser = (sourceTileId: string, url: string) => {
    if (!projectId || !projectWorkbench) return;
    const sourceTile = projectWorkbench.tiles[sourceTileId];
    if (sourceTile?.type !== "devServer") return;
    const linkedBrowserTileId = sourceTile.linkedBrowserTileId;
    if (linkedBrowserTileId && projectWorkbench.tiles[linkedBrowserTileId]?.type === "browser") {
      workbenchActions.updateBrowserTile(projectId, activeLaneId, linkedBrowserTileId, {
        url,
        linkedDevServerTileId: sourceTileId,
      });
      workbenchActions.setActiveTile(projectId, activeLaneId, linkedBrowserTileId);
      return;
    }

    const nextBrowserTileId = workbenchActions.addTile(projectId, activeLaneId, "browser", {
      url,
      linkedDevServerTileId: sourceTileId,
    });
    workbenchActions.updateDevServerTile(projectId, activeLaneId, sourceTileId, {
      linkedBrowserTileId: nextBrowserTileId,
    });
    workbenchActions.setActiveTile(projectId, activeLaneId, nextBrowserTileId);
  };

  const handleOpenBrowserFromBrowser = (sourceTileId: string, url: string) => {
    if (!projectId || !projectWorkbench) return;

    const sourceTile = projectWorkbench.tiles[sourceTileId];
    if (sourceTile?.type !== "browser") return;

    workbenchActions.addTile(projectId, activeLaneId, "browser", {
      url,
      storageScope: sourceTile.storageScope ?? "workspace",
    });
  };

  if (!projectId || !projectWorkbench || (isLaneStateLoading && !laneState)) {
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
      projectName={project?.name ?? null}
      getSelectionPreviewTile={getSelectionPreviewTile}
      onOpenBrowserFromDevServer={handleOpenBrowser}
      onOpenBrowserFromBrowser={handleOpenBrowserFromBrowser}
      onDuplicateAssistantTile={handleDuplicateAssistantTile}
      onResolveSelectionTile={handleResolveSelectionTile}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
          <div className="relative flex h-full min-h-0 min-w-0">
            <div
              className="relative min-w-0 flex-1 overflow-hidden bg-content-surface"
              onPointerMove={handleWorkbenchPointerMove}
              onPointerLeave={handleWorkbenchPointerLeave}
            >
              <WorkbenchEdgeInsertion
                armed={edgeInsertionArmed}
                disabledEdges={isChangesOpen ? ["top", "right"] : ["top"]}
                onEdgeActivate={handleEdgeActivate}
              />
              <WorkbenchSeamInsertion
                armed={edgeInsertionArmed}
                seamZones={seamZones}
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

import { Debouncer } from "@tanstack/react-pacer";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type {
  AddPanelOptions,
  DockviewApi,
  DockviewReadyEvent,
  IDockviewPanel,
  SerializedDockview,
} from "dockview";
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
  type WorkbenchProjectState,
  type WorkbenchSelectionTile,
  type WorkbenchSelectionTileEdge,
  type WorkbenchTile,
  type WorkbenchTileType,
  buildWorkbenchScopeKey,
  isWorkbenchSingletonTile,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore";
import { TaskFocusOverlay } from "@/features/projects/components/TaskFocusOverlay";
import {
  WORKBENCH_DOCK_COMPONENTS,
  WorkbenchDockRuntimeProvider,
  type WorkbenchDockPanelParams,
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
import {
  WorkbenchEdgeInsertion,
  type WorkbenchInsertionEdge,
} from "@/features/projects/components/workbench/WorkbenchEdgeInsertion";
import {
  WorkbenchSeamInsertion,
  type SeamZone,
} from "@/features/projects/components/workbench/WorkbenchSeamInsertion";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ProjectSyncIndicator } from "@/features/projects/components/ProjectSyncIndicator";
import { WorkbenchHeaderEditorControl } from "@/features/projects/components/workbench/WorkbenchHeaderEditorControl";
import { WorkbenchHeaderBranchControl } from "@/features/projects/components/workbench/WorkbenchHeaderBranchControl";
import { writeLastWorkbenchRoute } from "@/features/projects/lib/lastWorkbenchRoute";
import { disposeBrowserTileModel } from "@/features/projects/browser/browserTileModel";
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

function getDockComponentName(type: WorkbenchTileType): keyof typeof WORKBENCH_DOCK_COMPONENTS {
  switch (type) {
    case "selection":
    case "browser":
    case "terminal":
    case "devServer":
    case "assistantChat":
      return type;
    default:
      return "assistantChat";
  }
}

const EDGE_TO_DOCK_DIRECTION: Record<
  WorkbenchSelectionTileEdge,
  "left" | "right" | "above" | "below"
> = {
  left: "left",
  right: "right",
  top: "above",
  bottom: "below",
};

const SEAM_DIRECTION_TO_EDGE: Record<SeamZone["direction"], WorkbenchSelectionTileEdge> = {
  left: "left",
  right: "right",
  above: "top",
  below: "bottom",
};

const SEAM_ZONE_THICKNESS = 24;
const SEAM_INTERIOR_TOLERANCE = 4;

function computeSeamZones(api: DockviewApi, containerEl: HTMLElement): SeamZone[] {
  const containerRect = containerEl.getBoundingClientRect();
  const halfThickness = SEAM_ZONE_THICKNESS / 2;
  const zones: SeamZone[] = [];
  const groups = api.groups
    .map((group) => {
      const activePanel = group.activePanel;
      const groupEl =
        "element" in group && group.element instanceof HTMLElement ? group.element : null;
      if (!activePanel || !groupEl) return null;
      const rect = groupEl.getBoundingClientRect();
      return {
        id: group.api.id,
        referenceTileId: activePanel.id,
        rect,
        relLeft: rect.left - containerRect.left,
        relTop: rect.top - containerRect.top,
        relRight: rect.right - containerRect.left,
        relBottom: rect.bottom - containerRect.top,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
    Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > SEAM_INTERIOR_TOLERANCE;

  for (let i = 0; i < groups.length; i += 1) {
    const a = groups[i];
    for (let j = i + 1; j < groups.length; j += 1) {
      const b = groups[j];
      const touchesSelectionTile =
        a.referenceTileId.startsWith("selection-") || b.referenceTileId.startsWith("selection-");
      if (touchesSelectionTile) {
        continue;
      }

      // Vertical seam between A (left) and B (right)
      if (
        Math.abs(a.rect.right - b.rect.left) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.rect.top, a.rect.bottom, b.rect.top, b.rect.bottom)
      ) {
        const seamTop = Math.max(a.relTop, b.relTop);
        const seamBottom = Math.min(a.relBottom, b.relBottom);
        const seamHeight = seamBottom - seamTop;
        if (seamHeight > SEAM_INTERIOR_TOLERANCE) {
          zones.push({
            id: `seam-${a.id}-right-${b.id}`,
            referenceTileId: a.referenceTileId,
            direction: "right",
            rect: { x: a.relRight - halfThickness, y: seamTop, width: halfThickness, height: seamHeight },
          });
          zones.push({
            id: `seam-${b.id}-left-${a.id}`,
            referenceTileId: b.referenceTileId,
            direction: "left",
            rect: { x: b.relLeft, y: seamTop, width: halfThickness, height: seamHeight },
          });
        }
      }

      // Vertical seam between B (left) and A (right)
      if (
        Math.abs(b.rect.right - a.rect.left) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.rect.top, a.rect.bottom, b.rect.top, b.rect.bottom)
      ) {
        const seamTop = Math.max(a.relTop, b.relTop);
        const seamBottom = Math.min(a.relBottom, b.relBottom);
        const seamHeight = seamBottom - seamTop;
        if (seamHeight > SEAM_INTERIOR_TOLERANCE) {
          zones.push({
            id: `seam-${b.id}-right-${a.id}`,
            referenceTileId: b.referenceTileId,
            direction: "right",
            rect: { x: b.relRight - halfThickness, y: seamTop, width: halfThickness, height: seamHeight },
          });
          zones.push({
            id: `seam-${a.id}-left-${b.id}`,
            referenceTileId: a.referenceTileId,
            direction: "left",
            rect: { x: a.relLeft, y: seamTop, width: halfThickness, height: seamHeight },
          });
        }
      }

      // Horizontal seam between A (top) and B (bottom)
      if (
        Math.abs(a.rect.bottom - b.rect.top) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.rect.left, a.rect.right, b.rect.left, b.rect.right)
      ) {
        const seamLeft = Math.max(a.relLeft, b.relLeft);
        const seamRight = Math.min(a.relRight, b.relRight);
        const seamWidth = seamRight - seamLeft;
        if (seamWidth > SEAM_INTERIOR_TOLERANCE) {
          zones.push({
            id: `seam-${a.id}-below-${b.id}`,
            referenceTileId: a.referenceTileId,
            direction: "below",
            rect: { x: seamLeft, y: a.relBottom - halfThickness, width: seamWidth, height: halfThickness },
          });
          zones.push({
            id: `seam-${b.id}-above-${a.id}`,
            referenceTileId: b.referenceTileId,
            direction: "above",
            rect: { x: seamLeft, y: b.relTop, width: seamWidth, height: halfThickness },
          });
        }
      }

      // Horizontal seam between B (top) and A (bottom)
      if (
        Math.abs(b.rect.bottom - a.rect.top) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.rect.left, a.rect.right, b.rect.left, b.rect.right)
      ) {
        const seamLeft = Math.max(a.relLeft, b.relLeft);
        const seamRight = Math.min(a.relRight, b.relRight);
        const seamWidth = seamRight - seamLeft;
        if (seamWidth > SEAM_INTERIOR_TOLERANCE) {
          zones.push({
            id: `seam-${b.id}-below-${a.id}`,
            referenceTileId: b.referenceTileId,
            direction: "below",
            rect: { x: seamLeft, y: b.relBottom - halfThickness, width: seamWidth, height: halfThickness },
          });
          zones.push({
            id: `seam-${a.id}-above-${b.id}`,
            referenceTileId: a.referenceTileId,
            direction: "above",
            rect: { x: seamLeft, y: a.relTop, width: seamWidth, height: halfThickness },
          });
        }
      }
    }
  }

  return zones;
}

const EDGE_INSERTION_ARM_INSET = 28;

function getPanelParams(
  projectId: string,
  laneId: string,
  tileId: string,
): WorkbenchDockPanelParams {
  return { projectId, laneId, tileId };
}

function isObsoleteWorkbenchTile(tile: WorkbenchTile | undefined | null): boolean {
  return !tile || tile.type === "changes" || tile.type === "tasks";
}

function isSelectionTile(tile: WorkbenchTile | undefined | null): tile is WorkbenchSelectionTile {
  return Boolean(tile && tile.type === "selection");
}

function findPanelByType(
  api: DockviewApi,
  project: WorkbenchProjectState,
  type: WorkbenchTileType,
  excludeTileId?: string,
): IDockviewPanel | undefined {
  for (const tileId of project.order) {
    if (tileId === excludeTileId) continue;
    const tile = project.tiles[tileId];
    if (!tile || tile.type !== type) continue;
    const panel = api.getPanel(tileId);
    if (panel) return panel;
  }
  return undefined;
}

function buildAddPanelOptions(
  api: DockviewApi,
  project: WorkbenchProjectState,
  tile: WorkbenchTile,
  projectId: string,
  laneId: string,
): AddPanelOptions<WorkbenchDockPanelParams> {
  const base: AddPanelOptions<WorkbenchDockPanelParams> = {
    id: tile.id,
    title: tile.title,
    component: getDockComponentName(tile.type),
    params: getPanelParams(projectId, laneId, tile.id),
  };

  if (api.totalPanels === 0) {
    return base;
  }

  const activePanel = api.activePanel;
  const browserPanel = findPanelByType(api, project, "browser", tile.id);

  switch (tile.type) {
    case "browser":
      if (browserPanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: browserPanel.id,
            direction: "within",
          },
        };
      }
      if (activePanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: activePanel.id,
            direction: "right",
          },
        };
      }
      return base;
    case "terminal":
      if (browserPanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: browserPanel.id,
            direction: "below",
          },
        };
      }
      break;
    case "devServer":
      if (browserPanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: browserPanel.id,
            direction: "below",
          },
        };
      }
      break;
    case "assistantChat":
      if (activePanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: activePanel.id,
            direction: "right",
          },
        };
      }
      break;
    default:
      break;
  }

  if (activePanel) {
    return {
      ...base,
      floating: false,
      position: {
        referencePanel: activePanel.id,
        direction: "right",
      },
    };
  }

  return base;
}

function buildDefaultDockview(
  api: DockviewApi,
  project: WorkbenchProjectState,
  projectId: string,
  laneId: string,
) {
  api.clear();

  for (const tileId of project.order) {
    const tile = project.tiles[tileId];
    if (isObsoleteWorkbenchTile(tile)) continue;
    api.addPanel(buildAddPanelOptions(api, project, tile, projectId, laneId));
  }
}

function syncPanelTitles(api: DockviewApi, project: WorkbenchProjectState) {
  for (const tileId of project.order) {
    const tile = project.tiles[tileId];
    const panel = api.getPanel(tileId);
    if (isObsoleteWorkbenchTile(tile) || !panel) continue;
    if (panel.api.title !== tile.title) {
      panel.api.setTitle(tile.title);
    }
  }
}

function reconcilePanels(
  api: DockviewApi,
  project: WorkbenchProjectState,
  projectId: string,
  laneId: string,
  addPanel: (options: AddPanelOptions<WorkbenchDockPanelParams>) => IDockviewPanel | undefined = (
    options,
  ) => api.addPanel(options),
) {
  const nextTileIds = new Set(project.order);

  for (const panel of api.panels) {
    if (!nextTileIds.has(panel.id)) {
      api.removePanel(panel);
    }
  }

  for (const tileId of project.order) {
    const tile = project.tiles[tileId];
    if (isObsoleteWorkbenchTile(tile)) continue;
    const existingPanel = api.getPanel(tileId);
    if (existingPanel) {
      if (existingPanel.api.title !== tile.title) {
        existingPanel.api.setTitle(tile.title);
      }
      continue;
    }
    addPanel(buildAddPanelOptions(api, project, tile, projectId, laneId));
  }

  syncPanelTitles(api, project);
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
  const dockviewApiRef = useRef<DockviewApi | null>(null);
  const dockviewHostRef = useRef<HTMLDivElement | null>(null);
  const hydratedProjectKeyRef = useRef<string | null>(null);
  const layoutSaveFrameRef = useRef<number | null>(null);
  const layoutSnapshotDebouncerRef = useRef<Debouncer<(layout: SerializedDockview) => void> | null>(
    null,
  );
  const transientSelectionTileIdRef = useRef<string | null>(null);
  const lastReconciledOrderRef = useRef<string[] | null>(null);
  const lastReconciledTilesRef = useRef<Record<string, WorkbenchTile> | null>(null);
  const edgeInsertionArmedRef = useRef(false);
  const seamZoneRafRef = useRef<number | null>(null);
  const [taskCards, setTaskCards] = useState<TaskOverlayPayload[]>(() =>
    locationState?.taskOverlay ? [locationState.taskOverlay] : [],
  );
  const [isChangesOpen, setIsChangesOpen] = useState(false);
  const [edgeInsertionArmed, setEdgeInsertionArmed] = useState(false);
  const [seamZones, setSeamZones] = useState<SeamZone[]>([]);
  const [dockviewReadyScopeKey, setDockviewReadyScopeKey] = useState<string | null>(null);
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

  useProjectHeader(null, headerControls, headerCenter, true);

  useEffect(() => {
    dockviewApiRef.current = null;
    hydratedProjectKeyRef.current = null;
    lastReconciledOrderRef.current = null;
    lastReconciledTilesRef.current = null;
    transientSelectionTileIdRef.current = null;
    setDockviewReadyScopeKey(null);
  }, [workbenchScopeKey]);

  const closeChangesOverlay = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("changes");
    nextParams.delete("openTile");
    nextParams.delete("userId");
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
      dockviewApiRef.current?.getPanel(requestedTileId)?.api.setActive();
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

  const handleWorkbenchPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;

    if (target?.closest("[data-workbench-chrome='true']")) {
      edgeInsertionArmedRef.current = false;
      setEdgeInsertionArmed(false);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const withinInterior =
      localX > EDGE_INSERTION_ARM_INSET &&
      localX < rect.width - EDGE_INSERTION_ARM_INSET &&
      localY > EDGE_INSERTION_ARM_INSET &&
      localY < rect.height - EDGE_INSERTION_ARM_INSET;

    if (withinInterior) {
      edgeInsertionArmedRef.current = true;
      setEdgeInsertionArmed(true);
    }
  };

  useEffect(() => {
    setIsChangesOpen(searchParams.get("changes") === "1");
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
    if (!isChangesOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsChangesOpen(false);
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isChangesOpen]);

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

    const api = dockviewApiRef.current;
    const sourceTile = projectWorkbench.tiles[sourceTileId];
    if (!api || sourceTile?.type !== "browser") return;

    const nextBrowserTileId = workbenchActions.addTile(projectId, activeLaneId, "browser", {
      url,
      storageScope: sourceTile.storageScope ?? "workspace",
    });
    const nextTile =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ]?.tiles[nextBrowserTileId];
    if (!nextTile || nextTile.type !== "browser") return;

    api.addPanel({
      id: nextTile.id,
      title: nextTile.title,
      component: getDockComponentName(nextTile.type),
      params: getPanelParams(projectId, activeLaneId, nextTile.id),
      position: {
        referencePanel: sourceTileId,
        direction: "right",
      },
    });

    workbenchActions.setActiveTile(projectId, activeLaneId, nextBrowserTileId);
    api.getPanel(nextBrowserTileId)?.api.setActive();
  };

  useEffect(() => {
    const api = dockviewApiRef.current;
    if (!api || !projectId || !projectWorkbench || dockviewReadyScopeKey !== workbenchScopeKey)
      return;

    const hydrationKey = `${projectId}:${activeLaneId}:${projectWorkbench.layoutResetKey}`;
    if (hydratedProjectKeyRef.current === hydrationKey) return;

    hydratedProjectKeyRef.current = hydrationKey;

    if (projectWorkbench.layout) {
      api.clear();
      api.fromJSON(projectWorkbench.layout, { reuseExistingPanels: false });
      syncPanelTitles(api, projectWorkbench);
    } else {
      buildDefaultDockview(api, projectWorkbench, projectId, activeLaneId);
    }

    if (projectWorkbench.activeTileId) {
      api.getPanel(projectWorkbench.activeTileId)?.api.setActive();
    }
  }, [activeLaneId, dockviewReadyScopeKey, projectId, projectWorkbench, workbenchScopeKey]);

  useEffect(() => {
    const api = dockviewApiRef.current;
    if (!api || !projectId || !projectWorkbench || dockviewReadyScopeKey !== workbenchScopeKey)
      return;
    if (
      hydratedProjectKeyRef.current !==
      `${projectId}:${activeLaneId}:${projectWorkbench.layoutResetKey}`
    )
      return;

    if (
      projectWorkbench.order === lastReconciledOrderRef.current &&
      projectWorkbench.tiles === lastReconciledTilesRef.current
    ) {
      return;
    }

    lastReconciledOrderRef.current = projectWorkbench.order;
    lastReconciledTilesRef.current = projectWorkbench.tiles;

    reconcilePanels(api, projectWorkbench, projectId, activeLaneId);

    if (projectWorkbench.activeTileId) {
      api.getPanel(projectWorkbench.activeTileId)?.api.setActive();
    }
  }, [activeLaneId, dockviewReadyScopeKey, projectId, projectWorkbench, workbenchScopeKey]);

  useEffect(() => {
    return () => {
      layoutSnapshotDebouncerRef.current?.flush();
      layoutSnapshotDebouncerRef.current = null;
    };
  }, [workbenchScopeKey]);

  useEffect(() => {
    return () => {
      if (layoutSaveFrameRef.current !== null) {
        cancelAnimationFrame(layoutSaveFrameRef.current);
      }
      if (seamZoneRafRef.current !== null) {
        cancelAnimationFrame(seamZoneRafRef.current);
      }
      layoutSnapshotDebouncerRef.current?.flush();
    };
  }, []);

  // Sidebar width animates via CSS; that does not fire `window.resize`. The dock host must
  // drive `api.layout` so panels (and embedded browser views) match the inset width.
  useEffect(() => {
    if (!dockviewReadyScopeKey) return;
    const host = dockviewHostRef.current;
    if (!host) return;

    const syncLayout = () => {
      const api = dockviewApiRef.current;
      if (!api) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w <= 0 || h <= 0) return;
      api.layout(w, h);
    };

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(syncLayout);
    });
    ro.observe(host);
    requestAnimationFrame(syncLayout);
    return () => ro.disconnect();
  }, [dockviewReadyScopeKey, workbenchScopeKey, sidebar?.state]);

  const retractSelectionTile = (selectionTileId: string) => {
    if (!projectId) return;
    const liveProject =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ];
    const selectionTile = liveProject?.tiles[selectionTileId];

    if (
      !isSelectionTile(selectionTile) ||
      (selectionTile.mode !== "edgePreview" && selectionTile.mode !== "seamPreview")
    )
      return;

    const survivingTileIds = (liveProject?.order ?? []).filter((tileId) => {
      const tile = liveProject?.tiles[tileId];
      return !isObsoleteWorkbenchTile(tile);
    });

    if (survivingTileIds.length <= 1) return;

    transientSelectionTileIdRef.current = null;

    const panel = dockviewApiRef.current?.getPanel(selectionTileId);
    if (panel) {
      panel.api.close();
      return;
    }

    workbenchActions.removeTile(projectId, activeLaneId, selectionTileId);
  };

  if (!projectId || !projectWorkbench || (isLaneStateLoading && !laneState)) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading workbench…
      </div>
    );
  }

  const handleResolveSelectionTile = (
    selectionTileId: string,
    type: Extract<WorkbenchTileType, "assistantChat" | "browser" | "terminal" | "devServer">,
  ) => {
    if (!projectId) return;

    const api = dockviewApiRef.current;
    const liveProject =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ];
    const selectionTile = liveProject?.tiles[selectionTileId];
    if (!api || !isSelectionTile(selectionTile)) return;

    if (isWorkbenchSingletonTile(type)) {
      const existingSingletonId = liveProject.order.find(
        (tileId) => liveProject.tiles[tileId]?.type === type,
      );
      if (existingSingletonId) {
        workbenchActions.setActiveTile(projectId, activeLaneId, existingSingletonId);
        api.getPanel(existingSingletonId)?.api.setActive();
        api.getPanel(selectionTileId)?.api.close();
        transientSelectionTileIdRef.current = null;
        return;
      }
    }

    const tileId = workbenchActions.addTile(projectId, activeLaneId, type);
    const nextTile =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ]?.tiles[tileId];
    if (!nextTile) return;

    api.addPanel({
      id: nextTile.id,
      title: nextTile.title,
      component: getDockComponentName(nextTile.type),
      params: getPanelParams(projectId, activeLaneId, nextTile.id),
      position: {
        referencePanel: selectionTileId,
        direction: "within",
      },
    });

    workbenchActions.setActiveTile(projectId, activeLaneId, nextTile.id);
    api.getPanel(nextTile.id)?.api.setActive();
    api.getPanel(selectionTileId)?.api.close();
    transientSelectionTileIdRef.current = null;
  };

  const handleDuplicateAssistantTile = (sourceTileId: string) => {
    if (!projectId) return;

    const api = dockviewApiRef.current;
    const liveProject =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ];
    const sourceTile = liveProject?.tiles[sourceTileId];
    if (!liveProject || !sourceTile || sourceTile.type !== "assistantChat") return;

    const nextTileId = workbenchActions.addTile(projectId, activeLaneId, "assistantChat", {
      title: `${sourceTile.title} Copy`,
      assistantProjectId: sourceTile.assistantProjectId,
      provider: sourceTile.provider,
      model: sourceTile.model,
      runtimeMode: sourceTile.runtimeMode,
      interactionMode: sourceTile.interactionMode,
      agentLabel: sourceTile.agentLabel,
      laneBinding: sourceTile.laneBinding,
    });
    const nextTile =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ]?.tiles[nextTileId];
    if (!nextTile || !api) return;

    api.addPanel({
      id: nextTile.id,
      title: nextTile.title,
      component: getDockComponentName(nextTile.type),
      params: getPanelParams(projectId, activeLaneId, nextTile.id),
      position: {
        referencePanel: sourceTileId,
        direction: "right",
      },
    });

    workbenchActions.setActiveTile(projectId, activeLaneId, nextTile.id);
    api.getPanel(nextTile.id)?.api.setActive();
  };

  const handleEdgeActivate = (edge: WorkbenchInsertionEdge) => {
    if (!projectId) return;
    if (!edgeInsertionArmedRef.current) return;

    const liveProject =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ];
    if (!liveProject) return;

    const nonObsoleteTiles = liveProject.order.filter((tileId) => {
      const tile = liveProject.tiles[tileId];
      return !isObsoleteWorkbenchTile(tile);
    });
    const loneVisibleTile =
      nonObsoleteTiles.length === 1 ? liveProject.tiles[nonObsoleteTiles[0]] : null;

    if (
      nonObsoleteTiles.length === 1 &&
      isSelectionTile(loneVisibleTile) &&
      loneVisibleTile.mode === "emptyState"
    ) {
      return;
    }

    const existingSelectionId = transientSelectionTileIdRef.current;
    const existingSelectionTile = existingSelectionId
      ? liveProject.tiles[existingSelectionId]
      : null;

    if (
      isSelectionTile(existingSelectionTile) &&
      existingSelectionTile.mode === "edgePreview" &&
      existingSelectionTile.edge === edge
    ) {
      retractSelectionTile(existingSelectionTile.id);
      return;
    }

    if (
      isSelectionTile(existingSelectionTile) &&
      (existingSelectionTile.mode === "edgePreview" || existingSelectionTile.mode === "seamPreview")
    ) {
      retractSelectionTile(existingSelectionTile.id);
    }

    const api = dockviewApiRef.current;
    const selectionTileId = workbenchActions.addTile(projectId, activeLaneId, "selection", {
      selectionMode: "edgePreview",
      selectionEdge: edge,
    });
    const nextTile =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ]?.tiles[selectionTileId];

    if (!api || !nextTile) return;

    api.addPanel({
      id: nextTile.id,
      title: nextTile.title,
      component: getDockComponentName(nextTile.type),
      params: getPanelParams(projectId, activeLaneId, nextTile.id),
      position: api.totalPanels > 0 ? { direction: EDGE_TO_DOCK_DIRECTION[edge] } : undefined,
    });

    transientSelectionTileIdRef.current = selectionTileId;
    workbenchActions.setActiveTile(projectId, activeLaneId, selectionTileId);
    api.getPanel(selectionTileId)?.api.setActive();
  };

  const handleSeamActivate = (referenceTileId: string, direction: SeamZone["direction"]) => {
    if (!projectId) return;
    if (!edgeInsertionArmedRef.current) return;

    const liveProject =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ];
    if (!liveProject) return;

    const existingSelectionId = transientSelectionTileIdRef.current;
    const existingSelectionTile = existingSelectionId
      ? liveProject.tiles[existingSelectionId]
      : null;

    if (
      isSelectionTile(existingSelectionTile) &&
      existingSelectionTile.mode === "seamPreview" &&
      existingSelectionTile.referenceTileId === referenceTileId &&
      existingSelectionTile.edge === SEAM_DIRECTION_TO_EDGE[direction]
    ) {
      retractSelectionTile(existingSelectionTile.id);
      return;
    }

    if (
      isSelectionTile(existingSelectionTile) &&
      (existingSelectionTile.mode === "edgePreview" || existingSelectionTile.mode === "seamPreview")
    ) {
      retractSelectionTile(existingSelectionTile.id);
    }

    const api = dockviewApiRef.current;
    const selectionTileId = workbenchActions.addTile(projectId, activeLaneId, "selection", {
      selectionMode: "seamPreview",
      selectionEdge: SEAM_DIRECTION_TO_EDGE[direction],
      selectionReferenceTileId: referenceTileId,
    });
    const nextTile =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ]?.tiles[selectionTileId];

    if (!api || !nextTile) return;

    api.addPanel({
      id: nextTile.id,
      title: nextTile.title,
      component: getDockComponentName(nextTile.type),
      params: getPanelParams(projectId, activeLaneId, nextTile.id),
      position: {
        referencePanel: referenceTileId,
        direction,
      },
    });

    transientSelectionTileIdRef.current = selectionTileId;
    workbenchActions.setActiveTile(projectId, activeLaneId, selectionTileId);
    api.getPanel(selectionTileId)?.api.setActive();
  };

  return (
    <WorkbenchDockRuntimeProvider
      projectId={projectId}
      laneId={activeLaneId}
      projectPath={activeWorkbenchPath}
      projectName={project?.name ?? null}
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
              onPointerLeave={() => {
                edgeInsertionArmedRef.current = false;
                setEdgeInsertionArmed(false);
              }}
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
                  onReady={(event: DockviewReadyEvent) => {
                    dockviewApiRef.current = event.api;
                    setDockviewReadyScopeKey(workbenchScopeKey ?? "workbench");

                    layoutSnapshotDebouncerRef.current?.cancel();
                    layoutSnapshotDebouncerRef.current = new Debouncer(
                      (layout: SerializedDockview) => {
                        workbenchActions.setLayoutSnapshot(projectId, activeLaneId, layout);
                      },
                      { wait: 400 },
                    );

                    const saveLayout = () => {
                      if (!projectId) return;
                      if (layoutSaveFrameRef.current !== null) {
                        cancelAnimationFrame(layoutSaveFrameRef.current);
                      }
                      layoutSaveFrameRef.current = requestAnimationFrame(() => {
                        layoutSaveFrameRef.current = null;
                        const snapshot = event.api.toJSON() as SerializedDockview;
                        layoutSnapshotDebouncerRef.current?.maybeExecute(snapshot);
                      });
                    };

                    const scheduleSeamZoneUpdate = () => {
                      if (seamZoneRafRef.current !== null) {
                        cancelAnimationFrame(seamZoneRafRef.current);
                      }
                      seamZoneRafRef.current = requestAnimationFrame(() => {
                        seamZoneRafRef.current = null;
                        const container = dockviewHostRef.current;
                        if (!container) {
                          setSeamZones([]);
                          return;
                        }
                        setSeamZones(computeSeamZones(event.api, container));
                      });
                    };

                    event.api.onDidLayoutChange(() => {
                      saveLayout();
                      scheduleSeamZoneUpdate();
                    });

                    event.api.onDidActivePanelChange((activePanel) => {
                      workbenchActions.setActiveTile(
                        projectId,
                        activeLaneId,
                        activePanel?.id ?? null,
                      );
                      scheduleSeamZoneUpdate();
                    });

                    event.api.onDidRemovePanel((panel) => {
                      const liveProject =
                        useProjectWorkbenchStore.getState().workbenches[
                          buildWorkbenchScopeKey(projectId, activeLaneId)
                        ];
                      const removedTile = liveProject?.tiles[panel.id];
                      if (transientSelectionTileIdRef.current === panel.id) {
                        transientSelectionTileIdRef.current = null;
                      }
                      if (removedTile?.type === "browser") {
                        void disposeBrowserTileModel(removedTile.id);
                      }
                      workbenchActions.removeTile(projectId, activeLaneId, panel.id);
                    });
                  }}
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

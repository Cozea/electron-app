import { Debouncer } from "@tanstack/react-pacer";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type {
  DockviewApi,
  DockviewReadyEvent,
  SerializedDockview,
} from "dockview";

import type { WorkbenchSelectionTile, WorkbenchTile } from "@/stores/useProjectWorkbenchStore";
import {
  buildWorkbenchScopeKey,
  type WorkbenchProjectState,
  type WorkbenchTileType,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { disposeBrowserTileModel } from "@/features/projects/browser/browserTileModel";
import {
  EDGE_TO_DOCK_DIRECTION,
  SEAM_DIRECTION_TO_EDGE,
  buildDefaultDockview,
  computeSeamZones,
  getDockComponentName,
  getPanelParams,
  isObsoleteWorkbenchTile,
  isSelectionTile,
  reconcilePanels,
  syncPanelTitles,
} from "@/features/projects/lib/workbenchDockview";
import type { WorkbenchInsertionEdge } from "@/features/projects/components/workbench/WorkbenchEdgeInsertion";
import type { SeamZone } from "@/features/projects/components/workbench/WorkbenchSeamInsertion";
import { writePersistedWorkbenchLayout } from "@/features/projects/lib/workbenchLayoutPersistence";

const EDGE_INSERTION_ARM_INSET = 28;

interface UseWorkbenchDockviewRuntimeInput {
  projectId: string | null;
  activeLaneId: string;
  projectPath: string | null;
  projectWorkbench: WorkbenchProjectState | null;
  workbenchScopeKey: string | null;
  isLayoutPersistenceReady: boolean;
  persistedLayout: SerializedDockview | null;
}

interface UseWorkbenchDockviewRuntimeResult {
  dockviewHostRef: React.RefObject<HTMLDivElement | null>;
  edgeInsertionArmed: boolean;
  seamZones: SeamZone[];
  getSelectionPreviewTile: (tileId: string) => WorkbenchSelectionTile | null;
  handleWorkbenchPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  handleWorkbenchPointerLeave: () => void;
  handleResolveSelectionTile: (
    selectionTileId: string,
    type: Extract<WorkbenchTileType, "assistantChat" | "browser" | "devServer" | "terminal">,
  ) => void;
  handleDuplicateAssistantTile: (sourceTileId: string) => void;
  handleEdgeActivate: (edge: WorkbenchInsertionEdge) => void;
  handleSeamActivate: (referenceTileId: string, direction: SeamZone["direction"]) => void;
  handleDockviewReady: (event: DockviewReadyEvent) => void;
}

function createRuntimeSelectionPreviewTile(input: {
  mode: Extract<WorkbenchSelectionTile["mode"], "edgePreview" | "seamPreview">;
  edge: WorkbenchSelectionTile["edge"];
  referenceTileId?: string | null;
}): WorkbenchSelectionTile {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `selection-preview-${crypto.randomUUID()}`
      : `selection-preview-${Date.now()}-${Math.round(Math.random() * 100_000)}`;

  return {
    id,
    type: "selection",
    title: "Add Tile",
    createdAt: Date.now(),
    mode: input.mode,
    edge: input.edge ?? null,
    referenceTileId: input.referenceTileId ?? null,
  };
}

export function useWorkbenchDockviewRuntime(
  input: UseWorkbenchDockviewRuntimeInput,
): UseWorkbenchDockviewRuntimeResult {
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
  const isDestroyingRef = useRef(false);
  const layoutResetKeyRef = useRef(input.projectWorkbench?.layoutResetKey ?? 0);
  const workbenchScopeKeyRef = useRef(input.workbenchScopeKey);
  const selectionPreviewTilesRef = useRef<Record<string, WorkbenchSelectionTile>>({});
  const [edgeInsertionArmed, setEdgeInsertionArmed] = useState(false);
  const [seamZones, setSeamZones] = useState<SeamZone[]>([]);
  const [dockviewReadyScopeKey, setDockviewReadyScopeKey] = useState<string | null>(null);
  const [selectionPreviewTiles, setSelectionPreviewTiles] = useState<
    Record<string, WorkbenchSelectionTile>
  >({});
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions);
  const previewTileIds = useMemo(() => new Set(Object.keys(selectionPreviewTiles)), [selectionPreviewTiles]);

  const updateSelectionPreviewTiles = useCallback(
    (
      updater:
        | Record<string, WorkbenchSelectionTile>
        | ((
            current: Record<string, WorkbenchSelectionTile>,
          ) => Record<string, WorkbenchSelectionTile>),
    ) => {
      setSelectionPreviewTiles((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        selectionPreviewTilesRef.current = next;
        return next;
      });
    },
    [],
  );

  const getLiveWorkbench = useCallback(() => {
    if (!input.projectId) {
      return null;
    }
    return (
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(input.projectId, input.activeLaneId)
      ] ?? null
    );
  }, [input.activeLaneId, input.projectId]);

  const getSelectionPreviewTile = useCallback((tileId: string): WorkbenchSelectionTile | null => {
    return selectionPreviewTilesRef.current[tileId] ?? null;
  }, []);

  const scheduleSeamZoneUpdate = useCallback(() => {
    if (seamZoneRafRef.current !== null) {
      cancelAnimationFrame(seamZoneRafRef.current);
    }
    seamZoneRafRef.current = requestAnimationFrame(() => {
      seamZoneRafRef.current = null;
      const container = dockviewHostRef.current;
      const api = dockviewApiRef.current;
      if (!container || !api) {
        setSeamZones([]);
        return;
      }
      setSeamZones(computeSeamZones(api, container));
    });
  }, []);

  const hydrateDockviewPanels = useCallback(
    (api: DockviewApi) => {
      if (!input.projectId || !input.projectWorkbench) {
        return;
      }

      api.clear();

      if (input.persistedLayout) {
        try {
          api.fromJSON(input.persistedLayout, { reuseExistingPanels: false });
          syncPanelTitles(api, input.projectWorkbench);
        } catch (error) {
          console.warn("[WorkbenchDockview] Failed to restore persisted layout", error);
        }
      }

      if (api.totalPanels === 0) {
        buildDefaultDockview(api, input.projectWorkbench, input.projectId, input.activeLaneId);
      }

      if (input.projectWorkbench.activeTileId) {
        api.getPanel(input.projectWorkbench.activeTileId)?.api.setActive();
      }

      syncPanelTitles(api, input.projectWorkbench);
      scheduleSeamZoneUpdate();
    },
    [
      input.activeLaneId,
      input.persistedLayout,
      input.projectId,
      input.projectWorkbench,
      scheduleSeamZoneUpdate,
    ],
  );

  const saveLayout = useCallback(() => {
    if (!input.projectId) return;
    if (Object.keys(selectionPreviewTilesRef.current).length > 0) {
      return;
    }
    if (layoutSaveFrameRef.current !== null) {
      cancelAnimationFrame(layoutSaveFrameRef.current);
    }
    layoutSaveFrameRef.current = requestAnimationFrame(() => {
      layoutSaveFrameRef.current = null;
      const api = dockviewApiRef.current;
      const scopeKey = workbenchScopeKeyRef.current;
      if (!api || !scopeKey) {
        return;
      }
      const snapshot = api.toJSON() as SerializedDockview;
      layoutSnapshotDebouncerRef.current?.maybeExecute(snapshot);
    });
  }, [input.projectId]);

  const retractSelectionTile = useCallback(
    (selectionTileId: string) => {
      const selectionTile =
        selectionPreviewTilesRef.current[selectionTileId] ??
        getLiveWorkbench()?.tiles[selectionTileId] ??
        null;

      if (
        !isSelectionTile(selectionTile) ||
        (selectionTile.mode !== "edgePreview" && selectionTile.mode !== "seamPreview")
      ) {
        return;
      }

      if ((dockviewApiRef.current?.totalPanels ?? 0) <= 1) {
        return;
      }

      if (transientSelectionTileIdRef.current === selectionTileId) {
        transientSelectionTileIdRef.current = null;
      }

      const panel = dockviewApiRef.current?.getPanel(selectionTileId);
      if (panel) {
        panel.api.close();
        return;
      }

      if (selectionPreviewTilesRef.current[selectionTileId]) {
        updateSelectionPreviewTiles((current) => {
          const next = { ...current };
          delete next[selectionTileId];
          return next;
        });
        return;
      }

      if (input.projectId) {
        workbenchActions.removeTile(input.projectId, input.activeLaneId, selectionTileId);
      }
    },
    [getLiveWorkbench, input.activeLaneId, input.projectId, updateSelectionPreviewTiles, workbenchActions],
  );

  useEffect(() => {
    layoutResetKeyRef.current = input.projectWorkbench?.layoutResetKey ?? 0;
    workbenchScopeKeyRef.current = input.workbenchScopeKey;
  }, [input.projectWorkbench?.layoutResetKey, input.workbenchScopeKey]);

  useEffect(() => {
    isDestroyingRef.current = false;
    return () => {
      isDestroyingRef.current = true;
    };
  }, [input.workbenchScopeKey]);

  useLayoutEffect(() => {
    return () => {
      // Reset runtime refs during the previous scope's cleanup so a newly-mounted
      // Dockview instance can't be clobbered by a late passive effect from the old one.
      dockviewApiRef.current = null;
      hydratedProjectKeyRef.current = null;
      lastReconciledOrderRef.current = null;
      lastReconciledTilesRef.current = null;
      transientSelectionTileIdRef.current = null;
      selectionPreviewTilesRef.current = {};
      edgeInsertionArmedRef.current = false;
      setSelectionPreviewTiles({});
      setSeamZones([]);
      setEdgeInsertionArmed(false);
      setDockviewReadyScopeKey(null);
    };
  }, [input.workbenchScopeKey]);

  useEffect(() => {
    const api = dockviewApiRef.current;
    if (
      !api ||
      !input.projectId ||
      !input.projectWorkbench ||
      !input.isLayoutPersistenceReady ||
      dockviewReadyScopeKey !== input.workbenchScopeKey
    ) {
      return;
    }

    const hydrationKey = `${input.projectId}:${input.activeLaneId}:${input.projectWorkbench.layoutResetKey}`;
    if (hydratedProjectKeyRef.current === hydrationKey) return;

    hydratedProjectKeyRef.current = hydrationKey;

    hydrateDockviewPanels(api);
  }, [
    dockviewReadyScopeKey,
    input.activeLaneId,
    input.isLayoutPersistenceReady,
    input.persistedLayout,
    input.projectId,
    input.projectWorkbench,
    input.workbenchScopeKey,
    hydrateDockviewPanels,
    scheduleSeamZoneUpdate,
  ]);

  useEffect(() => {
    const api = dockviewApiRef.current;
    if (
      !api ||
      !input.projectId ||
      !input.projectWorkbench ||
      dockviewReadyScopeKey !== input.workbenchScopeKey
    ) {
      return;
    }
    if (
      hydratedProjectKeyRef.current !==
      `${input.projectId}:${input.activeLaneId}:${input.projectWorkbench.layoutResetKey}`
    ) {
      return;
    }

    if (
      input.projectWorkbench.order === lastReconciledOrderRef.current &&
      input.projectWorkbench.tiles === lastReconciledTilesRef.current
    ) {
      return;
    }

    lastReconciledOrderRef.current = input.projectWorkbench.order;
    lastReconciledTilesRef.current = input.projectWorkbench.tiles;

    reconcilePanels(
      api,
      input.projectWorkbench,
      input.projectId,
      input.activeLaneId,
      undefined,
      previewTileIds,
    );

    if (input.projectWorkbench.activeTileId) {
      api.getPanel(input.projectWorkbench.activeTileId)?.api.setActive();
    }
    scheduleSeamZoneUpdate();
  }, [
    dockviewReadyScopeKey,
    input.activeLaneId,
    input.projectId,
    input.projectWorkbench,
    input.workbenchScopeKey,
    previewTileIds,
    scheduleSeamZoneUpdate,
  ]);

  useEffect(() => {
    const api = dockviewApiRef.current;
    if (
      !api ||
      !input.projectId ||
      !input.projectWorkbench ||
      dockviewReadyScopeKey !== input.workbenchScopeKey
    ) {
      return;
    }

    const hasRenderableTiles = input.projectWorkbench.order.some((tileId) => {
      const tile = input.projectWorkbench?.tiles[tileId];
      return tile && !isObsoleteWorkbenchTile(tile) && !previewTileIds.has(tileId);
    });

    if (!hasRenderableTiles || api.totalPanels > 0) {
      return;
    }

    hydrateDockviewPanels(api);
  }, [
    dockviewReadyScopeKey,
    hydrateDockviewPanels,
    input.projectId,
    input.projectWorkbench,
    input.workbenchScopeKey,
    previewTileIds,
  ]);

  useEffect(() => {
    return () => {
      layoutSnapshotDebouncerRef.current?.flush();
      layoutSnapshotDebouncerRef.current = null;
    };
  }, [input.workbenchScopeKey]);

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

  useEffect(() => {
    if (!dockviewReadyScopeKey) return;
    const host = dockviewHostRef.current;
    if (!host) return;

    const syncLayout = () => {
      const api = dockviewApiRef.current;
      if (!api) return;
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width <= 0 || height <= 0) return;
      api.layout(width, height);
    };

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(syncLayout);
    });
    ro.observe(host);
    requestAnimationFrame(syncLayout);
    return () => ro.disconnect();
  }, [dockviewReadyScopeKey, input.workbenchScopeKey]);

  const handleWorkbenchPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
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
  }, []);

  const handleResolveSelectionTile = useCallback(
    (
      selectionTileId: string,
      type: Extract<WorkbenchTileType, "assistantChat" | "browser" | "devServer" | "terminal">,
    ) => {
      if (!input.projectId) return;

      const api = dockviewApiRef.current;
      const liveProject = getLiveWorkbench();
      const selectionTile =
        selectionPreviewTilesRef.current[selectionTileId] ??
        liveProject?.tiles[selectionTileId] ??
        null;
      if (!api || !isSelectionTile(selectionTile)) return;

      const tileId =
        type === "devServer"
          ? workbenchActions.openSingletonTile(input.projectId, input.activeLaneId, "devServer")
          : workbenchActions.addTile(input.projectId, input.activeLaneId, type);
      const nextTile =
        useProjectWorkbenchStore.getState().workbenches[
          buildWorkbenchScopeKey(input.projectId, input.activeLaneId)
        ]?.tiles[tileId];
      if (!nextTile) return;

      api.addPanel({
        id: nextTile.id,
        title: nextTile.title,
        component: getDockComponentName(nextTile.type),
        params: getPanelParams(input.projectId, input.activeLaneId, nextTile.id),
        position: {
          referencePanel: selectionTileId,
          direction: "within",
        },
      });

      workbenchActions.setActiveTile(input.projectId, input.activeLaneId, nextTile.id);
      api.getPanel(nextTile.id)?.api.setActive();
      api.getPanel(selectionTileId)?.api.close();
      transientSelectionTileIdRef.current = null;
    },
    [getLiveWorkbench, input.activeLaneId, input.projectId, workbenchActions],
  );

  const handleDuplicateAssistantTile = useCallback(
    (sourceTileId: string) => {
      if (!input.projectId) return;

      const api = dockviewApiRef.current;
      const liveProject = getLiveWorkbench();
      const sourceTile = liveProject?.tiles[sourceTileId];
      if (!liveProject || !sourceTile || sourceTile.type !== "assistantChat") return;

      const nextTileId = workbenchActions.addTile(input.projectId, input.activeLaneId, "assistantChat", {
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
          buildWorkbenchScopeKey(input.projectId, input.activeLaneId)
        ]?.tiles[nextTileId];
      if (!nextTile || !api) return;

      api.addPanel({
        id: nextTile.id,
        title: nextTile.title,
        component: getDockComponentName(nextTile.type),
        params: getPanelParams(input.projectId, input.activeLaneId, nextTile.id),
        position: {
          referencePanel: sourceTileId,
          direction: "right",
        },
      });

      workbenchActions.setActiveTile(input.projectId, input.activeLaneId, nextTile.id);
      api.getPanel(nextTile.id)?.api.setActive();
    },
    [getLiveWorkbench, input.activeLaneId, input.projectId, workbenchActions],
  );

  const handleEdgeActivate = useCallback(
    (edge: WorkbenchInsertionEdge) => {
      if (!input.projectId) return;
      if (!edgeInsertionArmedRef.current) return;

      const liveProject = getLiveWorkbench();
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
        ? selectionPreviewTilesRef.current[existingSelectionId] ??
          liveProject.tiles[existingSelectionId] ??
          null
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
      const nextTile = createRuntimeSelectionPreviewTile({
        mode: "edgePreview",
        edge,
      });

      if (!api) return;

      updateSelectionPreviewTiles((current) => ({
        ...current,
        [nextTile.id]: nextTile,
      }));

      api.addPanel({
        id: nextTile.id,
        title: nextTile.title,
        component: getDockComponentName(nextTile.type),
        params: getPanelParams(input.projectId, input.activeLaneId, nextTile.id),
        position: api.totalPanels > 0 ? { direction: EDGE_TO_DOCK_DIRECTION[edge] } : undefined,
      });

      transientSelectionTileIdRef.current = nextTile.id;
      api.getPanel(nextTile.id)?.api.setActive();
      scheduleSeamZoneUpdate();
    },
    [getLiveWorkbench, input.activeLaneId, input.projectId, retractSelectionTile, scheduleSeamZoneUpdate, updateSelectionPreviewTiles],
  );

  const handleSeamActivate = useCallback(
    (referenceTileId: string, direction: SeamZone["direction"]) => {
      if (!input.projectId) return;
      if (!edgeInsertionArmedRef.current) return;

      const liveProject = getLiveWorkbench();
      if (!liveProject) return;

      const existingSelectionId = transientSelectionTileIdRef.current;
      const existingSelectionTile = existingSelectionId
        ? selectionPreviewTilesRef.current[existingSelectionId] ??
          liveProject.tiles[existingSelectionId] ??
          null
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
      const nextTile = createRuntimeSelectionPreviewTile({
        mode: "seamPreview",
        edge: SEAM_DIRECTION_TO_EDGE[direction],
        referenceTileId,
      });

      if (!api) return;

      updateSelectionPreviewTiles((current) => ({
        ...current,
        [nextTile.id]: nextTile,
      }));

      api.addPanel({
        id: nextTile.id,
        title: nextTile.title,
        component: getDockComponentName(nextTile.type),
        params: getPanelParams(input.projectId, input.activeLaneId, nextTile.id),
        position: {
          referencePanel: referenceTileId,
          direction,
        },
      });

      transientSelectionTileIdRef.current = nextTile.id;
      api.getPanel(nextTile.id)?.api.setActive();
      scheduleSeamZoneUpdate();
    },
    [getLiveWorkbench, input.activeLaneId, input.projectId, retractSelectionTile, scheduleSeamZoneUpdate, updateSelectionPreviewTiles],
  );

  const handleDockviewReady = useCallback(
    (event: DockviewReadyEvent) => {
      dockviewApiRef.current = event.api;
      setDockviewReadyScopeKey(input.workbenchScopeKey ?? "workbench");

      layoutSnapshotDebouncerRef.current?.cancel();
      layoutSnapshotDebouncerRef.current = new Debouncer(
        (layout: SerializedDockview) => {
          const scopeKey = workbenchScopeKeyRef.current;
          if (!scopeKey) return;
          writePersistedWorkbenchLayout(scopeKey, layoutResetKeyRef.current, layout);
        },
        { wait: 400 },
      );

      event.api.onDidLayoutChange(() => {
        saveLayout();
        scheduleSeamZoneUpdate();
      });

      event.api.onDidActivePanelChange((activePanel) => {
        if (!input.projectId) {
          return;
        }

        const activeId = activePanel?.id ?? null;
        if (activeId && selectionPreviewTilesRef.current[activeId]) {
          scheduleSeamZoneUpdate();
          return;
        }

        workbenchActions.setActiveTile(
          input.projectId,
          input.activeLaneId,
          activeId,
        );
        scheduleSeamZoneUpdate();
      });

      event.api.onDidRemovePanel((panel) => {
        if (isDestroyingRef.current) {
          return;
        }

        if (!input.projectId) {
          return;
        }

        if (transientSelectionTileIdRef.current === panel.id) {
          transientSelectionTileIdRef.current = null;
        }

        if (selectionPreviewTilesRef.current[panel.id]) {
          updateSelectionPreviewTiles((current) => {
            if (!current[panel.id]) {
              return current;
            }
            const next = { ...current };
            delete next[panel.id];
            return next;
          });
          saveLayout();
          scheduleSeamZoneUpdate();
          return;
        }

        const liveProject = getLiveWorkbench();
        const removedTile = liveProject?.tiles[panel.id] ?? null;
        if (removedTile?.type === "browser") {
          void window.electronAPI.workbenchSession
            .releaseBrowser({
              projectId: input.projectId,
              laneId: input.activeLaneId,
              tileId: panel.id,
            })
            .catch((error) => {
              console.warn("[WorkbenchSession] Failed to release browser for removed panel", error);
            });
          void disposeBrowserTileModel(panel.id).catch((error) => {
            console.warn("[WorkbenchBrowser] Failed to dispose browser model", error);
          });
        }
        if (removedTile?.type === "terminal") {
          void window.electronAPI.workbenchSession
            .releaseTerminal({
              projectId: input.projectId,
              laneId: input.activeLaneId,
              tileId: panel.id,
              close: true,
            })
            .then((result) => {
              if (result.terminalId) {
                useTerminalStore.getState().actions.removeTerminal(result.terminalId);
              }
            })
            .catch((error) => {
              console.warn("[WorkbenchSession] Failed to release terminal for removed panel", error);
            });
        }
        if (removedTile?.type === "devServer") {
          void window.electronAPI.workbenchSession
            .releaseBrowser({
              projectId: input.projectId,
              laneId: input.activeLaneId,
              tileId: panel.id,
            })
            .catch((error) => {
              console.warn("[WorkbenchSession] Failed to release dev-server browser surface", error);
            });
          void disposeBrowserTileModel(panel.id).catch((error) => {
            console.warn("[WorkbenchBrowser] Failed to dispose dev-server browser model", error);
          });
          void window.electronAPI.workbenchSession
            .setNativePreviewSession({
              projectId: input.projectId,
              laneId: input.activeLaneId,
              locator: null,
              stopPrevious: true,
            })
            .catch((error) => {
              console.warn("[WorkbenchSession] Failed to stop native preview for removed panel", error);
            });
          void window.electronAPI.workbenchSession
            .releaseTerminal({
              projectId: input.projectId,
              laneId: input.activeLaneId,
              tileId: panel.id,
              close: true,
            })
            .then((result) => {
              if (result.terminalId) {
                useTerminalStore.getState().actions.removeTerminal(result.terminalId);
              }
            })
            .catch((error) => {
              console.warn("[WorkbenchSession] Failed to release dev-server terminal for removed panel", error);
            });
        }

        workbenchActions.removeTile(input.projectId, input.activeLaneId, panel.id);
        saveLayout();
        scheduleSeamZoneUpdate();
      });
    },
    [
      getLiveWorkbench,
      input.activeLaneId,
      input.projectId,
      input.workbenchScopeKey,
      saveLayout,
      scheduleSeamZoneUpdate,
      updateSelectionPreviewTiles,
      workbenchActions,
    ],
  );

  return {
    dockviewHostRef,
    edgeInsertionArmed,
    seamZones,
    getSelectionPreviewTile,
    handleWorkbenchPointerMove,
    handleWorkbenchPointerLeave: () => {
      edgeInsertionArmedRef.current = false;
      setEdgeInsertionArmed(false);
    },
    handleResolveSelectionTile,
    handleDuplicateAssistantTile,
    handleEdgeActivate,
    handleSeamActivate,
    handleDockviewReady,
  };
}

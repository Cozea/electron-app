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
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { disposeBrowserTileModel } from "@/features/projects/browser/browserTileModel";
import {
  buildDefaultDockview,
  computeWorkbenchEdgeTargets,
  computeWorkbenchJunctionTargetsFromSeamTargets,
  computeWorkbenchSeamTargets,
  getDockComponentName,
  getPanelParams,
  isObsoleteWorkbenchTile,
  isSelectionTile,
  reconcilePanels,
  resolveWorkbenchInsertionIntent,
  syncPanelTitles,
  type WorkbenchEdgeTarget,
  type WorkbenchInsertionIntent,
  type WorkbenchJunctionTarget,
  type WorkbenchSeamTarget,
} from "@/features/projects/lib/workbenchDockview";
import type { WorkbenchSelectionLaunchRequest } from "@/features/projects/lib/workbenchSelectionLaunch";
import { writePersistedWorkbenchLayout } from "@/features/projects/lib/workbenchLayoutPersistence";

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
  edgeTargets: WorkbenchEdgeTarget[];
  junctionTargets: WorkbenchJunctionTarget[];
  seamTargets: WorkbenchSeamTarget[];
  getSelectionPreviewTile: (tileId: string) => WorkbenchSelectionTile | null;
  handleWorkbenchPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  handleWorkbenchPointerLeave: () => void;
  handleResolveSelectionTile: (
    selectionTileId: string,
    request: WorkbenchSelectionLaunchRequest,
  ) => void;
  handleDuplicateAssistantTile: (sourceTileId: string) => void;
  handleEdgeActivate: (targetId: string) => void;
  handleJunctionActivate: (targetId: string) => void;
  handleSeamActivate: (targetId: string) => void;
  handleDockviewReady: (event: DockviewReadyEvent) => void;
}

function createRuntimeSelectionPreviewTile(input: {
  intent: WorkbenchInsertionIntent;
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
    mode: input.intent.previewMode,
    edge: input.intent.edge ?? null,
    referenceTileId: input.intent.referenceTileId ?? null,
    adjacentTileId: input.intent.adjacentTileId ?? null,
    previewScope: input.intent.scope,
    previewTargetKind: input.intent.targetKind,
    previewTargetId: input.intent.targetId,
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
  const edgeTargetsRef = useRef<WorkbenchEdgeTarget[]>([]);
  const junctionTargetsRef = useRef<WorkbenchJunctionTarget[]>([]);
  const seamTargetsRef = useRef<WorkbenchSeamTarget[]>([]);
  const [edgeInsertionArmed, setEdgeInsertionArmed] = useState(false);
  const [edgeTargets, setEdgeTargets] = useState<WorkbenchEdgeTarget[]>([]);
  const [junctionTargets, setJunctionTargets] = useState<WorkbenchJunctionTarget[]>([]);
  const [seamTargets, setSeamTargets] = useState<WorkbenchSeamTarget[]>([]);
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

  const scheduleInsertionTargetUpdate = useCallback(() => {
    if (seamZoneRafRef.current !== null) {
      cancelAnimationFrame(seamZoneRafRef.current);
    }
    seamZoneRafRef.current = requestAnimationFrame(() => {
      seamZoneRafRef.current = null;
      const container = dockviewHostRef.current;
      const api = dockviewApiRef.current;
      if (!container || !api) {
        edgeTargetsRef.current = [];
        junctionTargetsRef.current = [];
        seamTargetsRef.current = [];
        setEdgeTargets([]);
        setJunctionTargets([]);
        setSeamTargets([]);
        return;
      }
      const nextEdgeTargets = computeWorkbenchEdgeTargets(api, container);
      const nextSeamTargets = computeWorkbenchSeamTargets(api, container);
      const nextJunctionTargets = computeWorkbenchJunctionTargetsFromSeamTargets(nextSeamTargets, {
        width: container.getBoundingClientRect().width,
        height: container.getBoundingClientRect().height,
      });
      edgeTargetsRef.current = nextEdgeTargets;
      junctionTargetsRef.current = nextJunctionTargets;
      seamTargetsRef.current = nextSeamTargets;
      setEdgeTargets(nextEdgeTargets);
      setJunctionTargets(nextJunctionTargets);
      setSeamTargets(nextSeamTargets);
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
      scheduleInsertionTargetUpdate();
    },
    [
      input.activeLaneId,
      input.persistedLayout,
      input.projectId,
      input.projectWorkbench,
      scheduleInsertionTargetUpdate,
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
        (
          selectionTile.mode !== "edgePreview" &&
          selectionTile.mode !== "seamPreview" &&
          selectionTile.mode !== "junctionPreview"
        )
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
      edgeTargetsRef.current = [];
      junctionTargetsRef.current = [];
      setSelectionPreviewTiles({});
      seamTargetsRef.current = [];
      setEdgeTargets([]);
      setJunctionTargets([]);
      setSeamTargets([]);
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
    scheduleInsertionTargetUpdate,
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
    scheduleInsertionTargetUpdate();
  }, [
    dockviewReadyScopeKey,
    input.activeLaneId,
    input.projectId,
    input.projectWorkbench,
    input.workbenchScopeKey,
    previewTileIds,
    scheduleInsertionTargetUpdate,
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

    edgeInsertionArmedRef.current = true;
    setEdgeInsertionArmed(true);
  }, []);

  const handleResolveSelectionTile = useCallback(
    (
      selectionTileId: string,
      request: WorkbenchSelectionLaunchRequest,
    ) => {
      if (!input.projectId) return;

      const api = dockviewApiRef.current;
      const liveProject = getLiveWorkbench();
      const selectionTile =
        selectionPreviewTilesRef.current[selectionTileId] ??
        liveProject?.tiles[selectionTileId] ??
        null;
      if (!api || !isSelectionTile(selectionTile)) return;

      const { type } = request
      const tileId =
        type === "devServer" || type === "mobileSimulator"
          ? workbenchActions.openSingletonTile(input.projectId, input.activeLaneId, type)
          : workbenchActions.addTile(
              input.projectId,
              input.activeLaneId,
              type,
              type === "assistantChat" && request.provider
                ? { provider: request.provider }
                : undefined,
            );
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

  const activateInsertionIntent = useCallback(
    (
      targetId: string,
      intent: WorkbenchInsertionIntent,
      options?: {
        allowEmptyWorkbench?: boolean;
      },
    ) => {
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

      if (isSelectionTile(existingSelectionTile) && existingSelectionTile.previewTargetId === targetId) {
        retractSelectionTile(existingSelectionTile.id);
        return;
      }

      if (
        isSelectionTile(existingSelectionTile) &&
        (
          existingSelectionTile.mode === "edgePreview" ||
          existingSelectionTile.mode === "seamPreview" ||
          existingSelectionTile.mode === "junctionPreview"
        )
      ) {
        retractSelectionTile(existingSelectionTile.id);
      }

      const api = dockviewApiRef.current;
      const nextTile = createRuntimeSelectionPreviewTile({
        intent,
      });

      if (!api) return;
      if (!options?.allowEmptyWorkbench && !api.getPanel(intent.referenceTileId)) return;
      if (options?.allowEmptyWorkbench && api.totalPanels > 0 && !api.getPanel(intent.referenceTileId)) return;

      updateSelectionPreviewTiles((current) => ({
        ...current,
        [nextTile.id]: nextTile,
      }));

      api.addPanel({
        id: nextTile.id,
        title: nextTile.title,
        component: getDockComponentName(nextTile.type),
        params: getPanelParams(input.projectId, input.activeLaneId, nextTile.id),
        position:
          api.totalPanels > 0
            ? intent.referenceGroupId
              ? {
                  referenceGroup: intent.referenceGroupId,
                  direction: intent.dockDirection,
                }
              : {
                  referencePanel: intent.referenceTileId,
                  direction: intent.dockDirection,
                }
            : undefined,
      });

      transientSelectionTileIdRef.current = nextTile.id;
      api.getPanel(nextTile.id)?.api.setActive();
      scheduleInsertionTargetUpdate();
    },
    [
      getLiveWorkbench,
      input.activeLaneId,
      input.projectId,
      retractSelectionTile,
      scheduleInsertionTargetUpdate,
      updateSelectionPreviewTiles,
    ],
  );

  const handleEdgeActivate = useCallback(
    (targetId: string) => {
      if (!input.projectId) return;
      if (!edgeInsertionArmedRef.current) return;
      const target = edgeTargetsRef.current.find((candidate) => candidate.id === targetId);
      if (!target) return;

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
      const intent = resolveWorkbenchInsertionIntent(target);
      activateInsertionIntent(target.id, intent, { allowEmptyWorkbench: true });
    },
    [activateInsertionIntent, getLiveWorkbench, input.projectId],
  );

  const handleSeamActivate = useCallback(
    (targetId: string) => {
      if (!input.projectId) return;
      if (!edgeInsertionArmedRef.current) return;
      const target = seamTargetsRef.current.find((candidate) => candidate.id === targetId);
      if (!target) return;

      const liveProject = getLiveWorkbench();
      if (!liveProject) return;
      const intent = resolveWorkbenchInsertionIntent(target);
      activateInsertionIntent(target.id, intent);
    },
    [activateInsertionIntent, getLiveWorkbench, input.projectId],
  );

  const handleJunctionActivate = useCallback(
    (targetId: string) => {
      if (!input.projectId) return;
      if (!edgeInsertionArmedRef.current) return;
      const target = junctionTargetsRef.current.find((candidate) => candidate.id === targetId);
      if (!target) return;

      const liveProject = getLiveWorkbench();
      if (!liveProject) return;

      const intent = resolveWorkbenchInsertionIntent(target);
      activateInsertionIntent(target.id, intent);
    },
    [activateInsertionIntent, getLiveWorkbench, input.projectId],
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
        scheduleInsertionTargetUpdate();
      });

      event.api.onDidActivePanelChange((activePanel) => {
        if (!input.projectId) {
          return;
        }

        const activeId = activePanel?.id ?? null;
        if (activeId && selectionPreviewTilesRef.current[activeId]) {
          scheduleInsertionTargetUpdate();
          return;
        }

        workbenchActions.setActiveTile(
          input.projectId,
          input.activeLaneId,
          activeId,
        );
        scheduleInsertionTargetUpdate();
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
          scheduleInsertionTargetUpdate();
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
        if (removedTile?.type === "devServer" || removedTile?.type === "mobileSimulator") {
          void window.electronAPI.workbenchSession
            .releaseBrowser({
              projectId: input.projectId,
              laneId: input.activeLaneId,
              tileId: panel.id,
            })
            .catch((error) => {
              console.warn("[WorkbenchSession] Failed to release runtime browser surface", error);
            });
          void disposeBrowserTileModel(panel.id).catch((error) => {
            console.warn("[WorkbenchBrowser] Failed to dispose runtime browser model", error);
          });
          if (removedTile.type === "mobileSimulator") {
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
          }
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
              console.warn("[WorkbenchSession] Failed to release runtime terminal for removed panel", error);
            });
        }

        workbenchActions.removeTile(input.projectId, input.activeLaneId, panel.id);
        saveLayout();
        scheduleInsertionTargetUpdate();
      });
    },
    [
      getLiveWorkbench,
      input.activeLaneId,
      input.projectId,
      input.workbenchScopeKey,
      saveLayout,
      scheduleInsertionTargetUpdate,
      updateSelectionPreviewTiles,
      workbenchActions,
    ],
  );

  return {
    dockviewHostRef,
    edgeInsertionArmed,
    edgeTargets,
    junctionTargets,
    seamTargets,
    getSelectionPreviewTile,
    handleWorkbenchPointerMove,
    handleWorkbenchPointerLeave: () => {
      edgeInsertionArmedRef.current = false;
      setEdgeInsertionArmed(false);
    },
    handleResolveSelectionTile,
    handleDuplicateAssistantTile,
    handleEdgeActivate,
    handleJunctionActivate,
    handleSeamActivate,
    handleDockviewReady,
  };
}

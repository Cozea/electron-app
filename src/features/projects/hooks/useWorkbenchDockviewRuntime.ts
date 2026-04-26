import { Debouncer } from "@tanstack/react-pacer";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DockviewApi,
  DockviewReadyEvent,
  SerializedDockview,
} from "dockview";

import type { WorkbenchSelectionTile, WorkbenchTile } from "@/stores/useProjectWorkbenchStore";
import {
  selectProjectWorkbench,
  type WorkbenchProjectState,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore";
import { useTerminalStore } from "@/stores/useTerminalStore";
import {
  buildDefaultDockview,
  getDockComponentName,
  getPanelParams,
  isObsoleteWorkbenchTile,
  isSelectionTile,
  reconcilePanels,
  syncPanelTitles,
} from "@/features/projects/lib/workbenchDockview";
import type { WorkbenchSelectionLaunchRequest } from "@/features/projects/lib/workbenchSelectionLaunch";
import { writePersistedWorkbenchLayout } from "@/features/projects/lib/workbenchLayoutPersistence";

function disposeBrowserTileModelDeferred(tileId: string) {
  return import("@/features/projects/browser/browserTileModel").then((module) =>
    module.disposeBrowserTileModel(tileId),
  );
}

interface UseWorkbenchDockviewRuntimeInput {
  projectId: string | null;
  activeLaneId: string;
  projectPath: string | null;
  workbenchSessionKey: string | null;
  projectWorkbench: WorkbenchProjectState | null;
  workbenchScopeKey: string | null;
  isLayoutPersistenceReady: boolean;
  persistedLayout: SerializedDockview | null;
}

interface UseWorkbenchDockviewRuntimeResult {
  dockviewHostRef: React.RefObject<HTMLDivElement | null>;
  getSelectionPreviewTile: (tileId: string) => WorkbenchSelectionTile | null;
  handleResolveSelectionTile: (
    selectionTileId: string,
    request: WorkbenchSelectionLaunchRequest,
  ) => void;
  handleDuplicateAssistantTile: (sourceTileId: string) => void;
  handleSplitTile: (sourceTileId: string, direction: "right" | "bottom" | "left" | "top") => void;
  handleDockviewReady: (event: DockviewReadyEvent) => void;
}

import { useTranslation } from "@/lib/i18n";

export function useWorkbenchDockviewRuntime(
  input: UseWorkbenchDockviewRuntimeInput,
): UseWorkbenchDockviewRuntimeResult {
  const { t } = useTranslation();
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
  const isDestroyingRef = useRef(false);
  const layoutResetKeyRef = useRef(input.projectWorkbench?.layoutResetKey ?? 0);
  const workbenchScopeKeyRef = useRef(input.workbenchScopeKey);
  const selectionPreviewTilesRef = useRef<Record<string, WorkbenchSelectionTile>>({});
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
    return selectProjectWorkbench(
      input.projectId,
      input.activeLaneId,
      input.projectPath,
    )(useProjectWorkbenchStore.getState());
  }, [input.activeLaneId, input.projectId, input.projectPath]);

  const getSelectionPreviewTile = useCallback((tileId: string): WorkbenchSelectionTile | null => {
    return selectionPreviewTilesRef.current[tileId] ?? null;
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
    },
    [
      input.activeLaneId,
      input.persistedLayout,
      input.projectId,
      input.projectWorkbench,
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
      setSelectionPreviewTiles({});
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
  }, [
    dockviewReadyScopeKey,
    input.activeLaneId,
    input.projectId,
    input.projectWorkbench,
    input.workbenchScopeKey,
    previewTileIds,
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

  const handleResolveSelectionTile = useCallback(
    (
      selectionTileId: string,
      request: WorkbenchSelectionLaunchRequest,
    ) => {
      if (!input.projectId) return;

      void (async () => {
        const api = dockviewApiRef.current;
        const liveProject = getLiveWorkbench();
        const selectionTile =
          selectionPreviewTilesRef.current[selectionTileId] ??
          liveProject?.tiles[selectionTileId] ??
          null;
        if (!api || !isSelectionTile(selectionTile) || !input.projectId) return;

        const { resolveWorkbenchSelectionLaunchRequest } = await import(
          "@/features/projects/lib/workbenchSelectionLaunch"
        );
        const resolvedLaunch = resolveWorkbenchSelectionLaunchRequest(request)
        const tileId =
          resolvedLaunch.action === "openSingletonTile"
            ? workbenchActions.openSingletonTile(
                input.projectId,
                input.activeLaneId,
                resolvedLaunch.tileType,
                resolvedLaunch.options,
                input.projectPath,
              )
            : workbenchActions.addTile(
                input.projectId,
                input.activeLaneId,
                resolvedLaunch.tileType,
                resolvedLaunch.options,
                input.projectPath,
              );
        const nextTile = getLiveWorkbench()?.tiles[tileId];
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

        workbenchActions.setActiveTile(
          input.projectId,
          input.activeLaneId,
          nextTile.id,
          input.projectPath,
        );
        api.getPanel(nextTile.id)?.api.setActive();
        api.getPanel(selectionTileId)?.api.close();
        transientSelectionTileIdRef.current = null;
      })();
    },
    [getLiveWorkbench, input.activeLaneId, input.projectId, input.projectPath, workbenchActions],
  );

  const handleDuplicateAssistantTile = useCallback(
    (sourceTileId: string) => {
      if (!input.projectId) return;

      const api = dockviewApiRef.current;
      const liveProject = getLiveWorkbench();
      const sourceTile = liveProject?.tiles[sourceTileId];
      if (!liveProject || !sourceTile || sourceTile.type !== "assistantChat") return;

      const nextTileId = workbenchActions.addTile(
        input.projectId,
        input.activeLaneId,
        "assistantChat",
        {
          title: `${sourceTile.title} Copy`,
          assistantProjectId: sourceTile.assistantProjectId,
          provider: sourceTile.provider,
          model: sourceTile.model,
          runtimeMode: sourceTile.runtimeMode,
          interactionMode: sourceTile.interactionMode,
          agentLabel: sourceTile.agentLabel,
          laneBinding: sourceTile.laneBinding,
        },
        input.projectPath,
      );
      const nextTile = getLiveWorkbench()?.tiles[nextTileId];
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

      workbenchActions.setActiveTile(
        input.projectId,
        input.activeLaneId,
        nextTile.id,
        input.projectPath,
      );
      api.getPanel(nextTile.id)?.api.setActive();
    },
    [getLiveWorkbench, input.activeLaneId, input.projectId, input.projectPath, workbenchActions],
  );

  const handleSplitTile = useCallback(
    (sourceTileId: string, direction: "right" | "bottom" | "left" | "top") => {
      if (!input.projectId) return;

      const api = dockviewApiRef.current;
      const liveProject = getLiveWorkbench();
      const sourceTile = liveProject?.tiles[sourceTileId];
      if (!liveProject || !sourceTile || !api) return;

      const nextTileId = workbenchActions.addTile(
        input.projectId,
        input.activeLaneId,
        "selection",
        {
          title: t("workbench.selection.addDevApp"),
        },
        input.projectPath,
      );
      
      const nextTile = getLiveWorkbench()?.tiles[nextTileId];
      if (!nextTile) return;

      const dockDirection =
        direction === "right" ? "right" :
        direction === "bottom" ? "below" :
        direction === "left" ? "left" : "above";

      api.addPanel({
        id: nextTile.id,
        title: nextTile.title,
        component: getDockComponentName(nextTile.type),
        params: getPanelParams(input.projectId, input.activeLaneId, nextTile.id),
        position: {
          referencePanel: sourceTileId,
          direction: dockDirection,
        },
      });

      workbenchActions.setActiveTile(
        input.projectId,
        input.activeLaneId,
        nextTile.id,
        input.projectPath,
      );
      api.getPanel(nextTile.id)?.api.setActive();
    },
    [getLiveWorkbench, input.activeLaneId, input.projectId, input.projectPath, workbenchActions],
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
      });

      event.api.onDidActivePanelChange((activePanel) => {
        if (!input.projectId) {
          return;
        }

        const activeId = activePanel?.id ?? null;
        if (activeId && selectionPreviewTilesRef.current[activeId]) {
          return;
        }

        workbenchActions.setActiveTile(
          input.projectId,
          input.activeLaneId,
          activeId,
          input.projectPath,
        );
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
          return;
        }

        const liveProject = getLiveWorkbench();
        const removedTile = liveProject?.tiles[panel.id] ?? null;
        if (removedTile?.type === "browser") {
          void window.electronAPI.workbenchSession
            .releaseBrowser({
              sessionKey: input.workbenchSessionKey,
              projectId: input.projectId,
              laneId: input.activeLaneId,
              tileId: panel.id,
            })
            .catch((error) => {
              console.warn("[WorkbenchSession] Failed to release browser for removed panel", error);
            });
          void disposeBrowserTileModelDeferred(panel.id).catch((error) => {
            console.warn("[WorkbenchBrowser] Failed to dispose browser model", error);
          });
        }
        if (removedTile?.type === "terminal") {
          void window.electronAPI.workbenchSession
            .releaseTerminal({
              sessionKey: input.workbenchSessionKey,
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
              sessionKey: input.workbenchSessionKey,
              projectId: input.projectId,
              laneId: input.activeLaneId,
              tileId: panel.id,
            })
            .catch((error) => {
              console.warn("[WorkbenchSession] Failed to release runtime browser surface", error);
            });
          void disposeBrowserTileModelDeferred(panel.id).catch((error) => {
            console.warn("[WorkbenchBrowser] Failed to dispose runtime browser model", error);
          });
          if (removedTile.type === "mobileSimulator") {
            void window.electronAPI.workbenchSession
              .setNativePreviewSession({
                sessionKey: input.workbenchSessionKey,
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
              sessionKey: input.workbenchSessionKey,
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

        workbenchActions.removeTile(
          input.projectId,
          input.activeLaneId,
          panel.id,
          input.projectPath,
        );
        saveLayout();
      });
    },
    [
      getLiveWorkbench,
      input.activeLaneId,
      input.projectId,
      input.projectPath,
      input.workbenchScopeKey,
      saveLayout,
      updateSelectionPreviewTiles,
      workbenchActions,
    ],
  );

  return {
    dockviewHostRef,
    getSelectionPreviewTile,
    handleResolveSelectionTile,
    handleDuplicateAssistantTile,
    handleSplitTile,
    handleDockviewReady,
  };
}

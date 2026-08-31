import { Debouncer } from "@tanstack/react-pacer";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DockviewApi, DockviewReadyEvent, SerializedDockview } from "dockview-react";

import type { WorkbenchSelectionTile, WorkbenchTile } from "@/stores/useProjectWorkbenchStore";
import {
  selectProjectWorkbench,
  type WorkbenchProjectState,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { useChangesSidebarStore } from "@/stores/useChangesSidebarStore";
import {
  applyWorkbenchDockviewPolicies,
  buildAddPanelOptions,
  buildDefaultDockview,
  getDockComponentName,
  getPanelConstraintsForTile,
  getPanelParams,
  getPanelRendererForTile,
  isObsoleteWorkbenchTile,
  isSelectionTile,
  reconcilePanels,
  syncPanelTitles,
} from "@/features/projects/lib/workbenchDockview";
import type { WorkbenchSelectionLaunchRequest } from "@/features/projects/lib/workbenchSelectionLaunch";
import {
  clearPersistedWorkbenchLayout,
  writePersistedWorkbenchLayout,
} from "@/features/projects/lib/workbenchLayoutPersistence";
import { CHANGES_TILE_MIN_WIDTH_COLLAPSED } from "@/features/projects/lib/changesTileSizing";
import { resolveProjectDevAppRuntimeTarget } from "@/features/projects/lib/projectDevAppRuntime";
import { releaseProjectDevAppRuntimeTarget } from "@/features/projects/lib/projectDevAppRuntimeLifecycle";
import {
  claimDevServerSurface,
  releaseDevServerSurfaceLease,
  registerDevServerSurfaceController,
  type DevServerSurfaceHandle,
} from "@/features/projects/devserver/devServerSurfaceController";

const CHANGES_PANEL_ID = "cozea-changes-panel";

function normalizeBrowserBackedPopouts(api: DockviewApi, workbench: WorkbenchProjectState): void {
  for (const panel of api.panels) {
    const tile = workbench.tiles[panel.id];
    const browserBacked =
      tile?.type === "browser" || tile?.type === "devServer" || tile?.type === "orgDevApp";
    if (browserBacked && panel.api.location.type === "popout") {
      panel.api.moveTo({ position: "right" });
    }
  }
}

function getPathFromDroppedFile(file: File): string | null {
  const maybePath = (file as File & { path?: unknown }).path;
  return typeof maybePath === "string" && maybePath.length > 0 ? maybePath : null;
}

function buildFileUrl(filePath: string): string {
  if (filePath.startsWith("/")) {
    return `file://${filePath
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`;
  }
  return `file://${encodeURI(filePath)}`;
}

// dockview drop events carry either a native OS drag or a pointer-based drag;
// only the former has a dataTransfer to read an external URL/file from.
function readNativeDataTransfer(nativeEvent: DragEvent | PointerEvent): DataTransfer | null {
  return "dataTransfer" in nativeEvent ? nativeEvent.dataTransfer : null;
}

function readDroppedBrowserTarget(dataTransfer: DataTransfer | null): {
  title: string;
  url: string;
} | null {
  if (!dataTransfer) return null;

  const uriList = dataTransfer.getData("text/uri-list")?.trim();
  if (uriList) {
    const firstUri = uriList.split(/\r?\n/).find((line) => line && !line.startsWith("#"));
    if (firstUri) {
      return { title: "Dropped URL", url: firstUri };
    }
  }

  const plainText = dataTransfer.getData("text/plain")?.trim();
  if (plainText && /^[a-z][a-z0-9+.-]*:/i.test(plainText)) {
    return { title: "Dropped URL", url: plainText };
  }

  const firstFile = Array.from(dataTransfer.files ?? [])[0];
  if (!firstFile) return null;

  const filePath = getPathFromDroppedFile(firstFile);
  if (!filePath) return null;

  return {
    title: firstFile.name || "Dropped File",
    url: buildFileUrl(filePath),
  };
}

interface UseWorkbenchDockviewRuntimeInput {
  projectId: string | null;
  activeLaneId: string;
  workspaceId: string | null;
  workbenchSessionKey: string | null;
  projectWorkbench: WorkbenchProjectState | null;
  workbenchScopeKey: string | null;
  isLayoutPersistenceReady: boolean;
  persistedLayout: SerializedDockview | null;
  isActive: boolean;
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
  // Suppresses panel-removal side effects (removeTile, terminal release,
  // layout save) while hydrateDockviewPanels programmatically rebuilds the
  // dock: api.clear() fires onDidRemovePanel per panel, and treating those as
  // user-closes wiped the workbench (tiles removed from the store and the
  // empty layout persisted) whenever hydration ran on a populated dock.
  const isHydratingRef = useRef(false);
  const isMigratingChangesPanelRef = useRef(false);
  const changesPanelRootHomeKeyRef = useRef<string | null>(null);
  const keyboardNavigationCleanupRef = useRef<(() => void) | null>(null);
  const layoutResetKeyRef = useRef(input.projectWorkbench?.layoutResetKey ?? 0);
  const workbenchScopeKeyRef = useRef(input.workbenchScopeKey);
  const isActiveRef = useRef(input.isActive);
  const wasActiveRef = useRef(input.isActive);
  const captureAndPersistLayoutRef = useRef<() => void>(() => {});
  const selectionPreviewTilesRef = useRef<Record<string, WorkbenchSelectionTile>>({});
  const [dockviewReadyScopeKey, setDockviewReadyScopeKey] = useState<string | null>(null);
  const [selectionPreviewTiles, setSelectionPreviewTiles] = useState<
    Record<string, WorkbenchSelectionTile>
  >({});
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions);
  const isChangesOpen = useChangesSidebarStore((state) => state.isOpen);
  const changesWidth = useChangesSidebarStore((state) => state.width);
  const changesMinWidth = useChangesSidebarStore((state) => state.minWidth);
  const closeChanges = useChangesSidebarStore((state) => state.actions.close);
  const previewTileIds = useMemo(
    () => new Set(Object.keys(selectionPreviewTiles)),
    [selectionPreviewTiles],
  );

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
      input.workspaceId,
    )(useProjectWorkbenchStore.getState());
  }, [input.activeLaneId, input.projectId, input.workspaceId]);

  const getSelectionPreviewTile = useCallback((tileId: string): WorkbenchSelectionTile | null => {
    return selectionPreviewTilesRef.current[tileId] ?? null;
  }, []);

  captureAndPersistLayoutRef.current = () => {
    const api = dockviewApiRef.current;
    const scopeKey = workbenchScopeKeyRef.current;
    if (!api || !scopeKey || isHydratingRef.current) {
      return;
    }
    if (Object.keys(selectionPreviewTilesRef.current).length > 0) {
      return;
    }
    writePersistedWorkbenchLayout(
      scopeKey,
      layoutResetKeyRef.current,
      api.toJSON() as SerializedDockview,
    );
  };

  const hydrateDockviewPanels = useCallback(
    (api: DockviewApi) => {
      if (!input.projectId || !input.projectWorkbench) {
        return;
      }

      isHydratingRef.current = true;
      try {
        // Keep-alive can re-enter hydration (store identity churn, hide/show)
        // with a live dock that already has the user's split tree. Clearing
        // here would rebuild from persisted JSON or `buildDefaultDockview`
        // (every tile `direction: "right"` → a row of columns).
        if (api.totalPanels > 0) {
          applyWorkbenchDockviewPolicies(api);
          if (input.projectWorkbench.activeTileId) {
            api.getPanel(input.projectWorkbench.activeTileId)?.api.setActive();
          }
          syncPanelTitles(api, input.projectWorkbench);
          return;
        }

        api.clear();

        if (input.persistedLayout) {
          try {
            api.fromJSON(input.persistedLayout, { reuseExistingPanels: false });
            normalizeBrowserBackedPopouts(api, input.projectWorkbench);
            syncPanelTitles(api, input.projectWorkbench);
          } catch (error) {
            console.warn("[WorkbenchDockview] Failed to restore persisted layout", error);
            if (input.workbenchScopeKey) {
              clearPersistedWorkbenchLayout(input.workbenchScopeKey);
            }
            api.clear();
          }
        }

        if (api.totalPanels === 0) {
          buildDefaultDockview(api, input.projectWorkbench, input.projectId, input.activeLaneId);
        } else {
          applyWorkbenchDockviewPolicies(api);
        }

        if (input.projectWorkbench.activeTileId) {
          api.getPanel(input.projectWorkbench.activeTileId)?.api.setActive();
        }

        syncPanelTitles(api, input.projectWorkbench);
      } finally {
        isHydratingRef.current = false;
      }
    },
    [
      input.activeLaneId,
      input.persistedLayout,
      input.projectId,
      input.projectWorkbench,
      input.workbenchScopeKey,
    ],
  );

  const saveLayout = useCallback(() => {
    if (!input.projectId) return;
    if (!isActiveRef.current) {
      // Hidden keep-alive sessions still receive dockview layout events.
      // Persisting those would overwrite the user's split with a degenerate
      // equal-column snapshot.
      return;
    }
    if (isHydratingRef.current) {
      // Mid-rebuild layouts are transient (possibly empty); persisting one
      // overwrites the user's real layout.
      return;
    }
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
    isActiveRef.current = input.isActive;
  }, [input.isActive, input.projectWorkbench?.layoutResetKey, input.workbenchScopeKey]);

  useLayoutEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = input.isActive;
    isActiveRef.current = input.isActive;
    if (wasActive && !input.isActive) {
      if (layoutSaveFrameRef.current !== null) {
        cancelAnimationFrame(layoutSaveFrameRef.current);
        layoutSaveFrameRef.current = null;
      }
      captureAndPersistLayoutRef.current();
    }
  }, [input.isActive]);

  useEffect(() => {
    isDestroyingRef.current = false;
    return () => {
      isDestroyingRef.current = true;
    };
  }, [input.workbenchScopeKey]);

  useLayoutEffect(() => {
    return () => {
      // Persist before dropping the API — the passive unmount flush otherwise
      // runs after this ref is already null, so the latest split is lost.
      captureAndPersistLayoutRef.current();
      // Reset runtime refs during the previous scope's cleanup so a newly-mounted
      // Dockview instance can't be clobbered by a late passive effect from the old one.
      dockviewApiRef.current = null;
      hydratedProjectKeyRef.current = null;
      lastReconciledOrderRef.current = null;
      lastReconciledTilesRef.current = null;
      transientSelectionTileIdRef.current = null;
      keyboardNavigationCleanupRef.current?.();
      keyboardNavigationCleanupRef.current = null;
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

    // Scope key (not project:lane) so a hydration against a transient boot
    // scope cannot mark the settled scope as already hydrated.
    const hydrationKey = `${input.workbenchScopeKey}:${input.projectWorkbench.layoutResetKey}`;
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
    const projectWorkbench = input.projectWorkbench;
    if (
      !api ||
      !input.projectId ||
      !projectWorkbench ||
      dockviewReadyScopeKey !== input.workbenchScopeKey
    ) {
      return;
    }

    let changesPanel = api.getPanel(CHANGES_PANEL_ID);
    if (!isChangesOpen) {
      changesPanel?.api.close();
      return;
    }

    const minimumWidth = Math.max(CHANGES_TILE_MIN_WIDTH_COLLAPSED, changesMinWidth);
    const changesPanelRootHomeKey = `${input.workbenchScopeKey}:${input.projectId}:${input.activeLaneId}:${projectWorkbench.layoutResetKey}`;
    if (changesPanel && changesPanelRootHomeKeyRef.current !== changesPanelRootHomeKey) {
      changesPanelRootHomeKeyRef.current = changesPanelRootHomeKey;
      isMigratingChangesPanelRef.current = true;
      try {
        changesPanel.api.close();
      } finally {
        isMigratingChangesPanelRef.current = false;
      }
      changesPanel = undefined;
    }

    if (changesPanel) {
      changesPanel.api.setConstraints({
        minimumWidth,
        minimumHeight: 260,
      });
      changesPanel.api.setActive();
      return;
    }

    if (api.totalPanels > 0) {
      api.addPanel({
        id: CHANGES_PANEL_ID,
        title: "Changes",
        component: "changes",
        renderer: "always",
        initialWidth: changesWidth,
        minimumWidth,
        minimumHeight: 260,
        params: getPanelParams(input.projectId, input.activeLaneId, CHANGES_PANEL_ID),
        floating: false,
        position: {
          direction: "right",
        },
      });
    } else {
      api.addPanel({
        id: CHANGES_PANEL_ID,
        title: "Changes",
        component: "changes",
        renderer: "always",
        initialWidth: changesWidth,
        minimumWidth,
        minimumHeight: 260,
        params: getPanelParams(input.projectId, input.activeLaneId, CHANGES_PANEL_ID),
      });
    }

    api.getPanel(CHANGES_PANEL_ID)?.api.setActive();
  }, [
    changesMinWidth,
    changesWidth,
    dockviewReadyScopeKey,
    input.activeLaneId,
    input.projectId,
    input.projectWorkbench?.layoutResetKey,
    input.workbenchScopeKey,
    isChangesOpen,
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
      `${input.workbenchScopeKey}:${input.projectWorkbench.layoutResetKey}`
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
    const scopeKey = input.workbenchScopeKey;
    if (!api || !scopeKey || !input.projectId || dockviewReadyScopeKey !== scopeKey) {
      return;
    }

    return registerDevServerSurfaceController(scopeKey, {
      ensureSurface: async (request): Promise<DevServerSurfaceHandle> => {
        const liveWorkbench = getLiveWorkbench();
        const liveApi = dockviewApiRef.current;
        if (!liveWorkbench || !liveApi) {
          throw new Error("The project workbench closed before the Dev Server surface was ready.");
        }

        const reusableTileIds = liveWorkbench.order.filter((tileId) => {
          const tile = liveWorkbench.tiles[tileId];
          return tile?.type === "devServer" && !tile.devAppId;
        });
        if (request.preferredTileId && reusableTileIds.includes(request.preferredTileId)) {
          reusableTileIds.splice(reusableTileIds.indexOf(request.preferredTileId), 1);
          reusableTileIds.unshift(request.preferredTileId);
        }
        let lease = request.forceNew
          ? null
          : claimDevServerSurface(reusableTileIds, request.ownerId);
        let created = false;
        let tileId = lease?.tileId ?? null;

        if (!lease || !tileId) {
          tileId = workbenchActions.addTile(
            request.projectId,
            request.laneId,
            "devServer",
            {
              title: "Dev Server",
              activate: false,
              agentManaged: true,
            },
            request.workspaceId,
          );
          lease = claimDevServerSurface([tileId], request.ownerId);
          created = true;
        }

        if (!lease || !tileId) {
          throw new Error("Unable to reserve a Dev Server surface for this agent.");
        }

        const nextWorkbench = getLiveWorkbench();
        const nextTile = nextWorkbench?.tiles[tileId];
        if (!nextTile || nextTile.type !== "devServer") {
          throw new Error("The reserved Dev Server surface is no longer available.");
        }

        let panel = liveApi.getPanel(tileId);
        if (!panel) {
          // addPanel(within) activates the new tab. Restore the requesting
          // assistant in this exact group, not Dockview's globally active
          // panel, which may belong to another tile group entirely.
          const previousActivePanelId = request.assistantTileId;
          const referencePanel = liveApi.getPanel(request.assistantTileId);
          panel = liveApi.addPanel({
            id: nextTile.id,
            title: nextTile.title,
            component: getDockComponentName(nextTile.type),
            params: getPanelParams(request.projectId, request.laneId, nextTile.id),
            renderer: getPanelRendererForTile(nextTile.type),
            ...getPanelConstraintsForTile(nextTile.type),
            ...(referencePanel
              ? {
                  position: {
                    referencePanel: referencePanel.id,
                    direction: "within" as const,
                  },
                }
              : {}),
          });

          if (!request.focus) {
            const previousPanel = liveApi.getPanel(previousActivePanelId);
            previousPanel?.api.setActive();
            workbenchActions.setActiveTile(
              request.projectId,
              request.laneId,
              previousPanel?.id ?? null,
              request.workspaceId,
            );
          }
        }

        if (request.focus) {
          panel?.api.setActive();
          workbenchActions.setActiveTile(
            request.projectId,
            request.laneId,
            tileId,
            request.workspaceId,
          );
        }

        return {
          scopeKey,
          tileId,
          leaseToken: lease.token,
          created,
          focused: Boolean(request.focus),
        };
      },
      focusSurface: (tileId) => {
        const panel = dockviewApiRef.current?.getPanel(tileId);
        if (!panel || !input.projectId) return false;
        panel.api.setActive();
        workbenchActions.setActiveTile(
          input.projectId,
          input.activeLaneId,
          tileId,
          input.workspaceId,
        );
        return true;
      },
    });
  }, [
    dockviewReadyScopeKey,
    getLiveWorkbench,
    input.activeLaneId,
    input.projectId,
    input.workbenchScopeKey,
    input.workspaceId,
    workbenchActions,
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
        layoutSaveFrameRef.current = null;
      }
      captureAndPersistLayoutRef.current();
      layoutSnapshotDebouncerRef.current?.flush();
    };
  }, []);

  const handleResolveSelectionTile = useCallback(
    (selectionTileId: string, request: WorkbenchSelectionLaunchRequest) => {
      if (!input.projectId) return;

      void (async () => {
        const api = dockviewApiRef.current;
        const liveProject = getLiveWorkbench();
        const selectionTile =
          selectionPreviewTilesRef.current[selectionTileId] ??
          liveProject?.tiles[selectionTileId] ??
          null;
        if (!api || !isSelectionTile(selectionTile) || !input.projectId) return;

        const { resolveWorkbenchSelectionLaunchRequest } =
          await import("@/features/projects/lib/workbenchSelectionLaunch");
        const resolvedLaunch = resolveWorkbenchSelectionLaunchRequest(request);
        const tileId =
          resolvedLaunch.action === "openSingletonTile"
            ? workbenchActions.openSingletonTile(
                input.projectId,
                input.activeLaneId,
                resolvedLaunch.tileType,
                resolvedLaunch.options,
                input.workspaceId,
              )
            : workbenchActions.addTile(
                input.projectId,
                input.activeLaneId,
                resolvedLaunch.tileType,
                resolvedLaunch.options,
                input.workspaceId,
              );
        const nextTile = getLiveWorkbench()?.tiles[tileId];
        if (!nextTile) return;

        api.addPanel({
          id: nextTile.id,
          title: nextTile.title,
          component: getDockComponentName(nextTile.type),
          params: getPanelParams(input.projectId, input.activeLaneId, nextTile.id),
          renderer: getPanelRendererForTile(nextTile.type),
          ...getPanelConstraintsForTile(nextTile.type),
          position: {
            referencePanel: selectionTileId,
            direction: "within",
          },
        });

        workbenchActions.setActiveTile(
          input.projectId,
          input.activeLaneId,
          nextTile.id,
          input.workspaceId,
        );
        api.getPanel(nextTile.id)?.api.setActive();
        api.getPanel(selectionTileId)?.api.close();
        transientSelectionTileIdRef.current = null;
      })();
    },
    [getLiveWorkbench, input.activeLaneId, input.projectId, input.workspaceId, workbenchActions],
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
          providerInstanceId: sourceTile.providerInstanceId,
          model: sourceTile.model,
          runtimeMode: sourceTile.runtimeMode,
          interactionMode: sourceTile.interactionMode,
          agentLabel: sourceTile.agentLabel,
          laneBinding: sourceTile.laneBinding,
        },
        input.workspaceId,
      );
      const nextTile = getLiveWorkbench()?.tiles[nextTileId];
      if (!nextTile || !api) return;

      api.addPanel({
        id: nextTile.id,
        title: nextTile.title,
        component: getDockComponentName(nextTile.type),
        params: getPanelParams(input.projectId, input.activeLaneId, nextTile.id),
        renderer: getPanelRendererForTile(nextTile.type),
        ...getPanelConstraintsForTile(nextTile.type),
        position: {
          referencePanel: sourceTileId,
          direction: "right",
        },
      });

      workbenchActions.setActiveTile(
        input.projectId,
        input.activeLaneId,
        nextTile.id,
        input.workspaceId,
      );
      api.getPanel(nextTile.id)?.api.setActive();
    },
    [getLiveWorkbench, input.activeLaneId, input.projectId, input.workspaceId, workbenchActions],
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
        input.workspaceId,
      );

      const nextTile = getLiveWorkbench()?.tiles[nextTileId];
      if (!nextTile) return;

      const dockDirection =
        direction === "right"
          ? "right"
          : direction === "bottom"
            ? "below"
            : direction === "left"
              ? "left"
              : "above";

      api.addPanel({
        id: nextTile.id,
        title: nextTile.title,
        component: getDockComponentName(nextTile.type),
        params: getPanelParams(input.projectId, input.activeLaneId, nextTile.id),
        renderer: getPanelRendererForTile(nextTile.type),
        ...getPanelConstraintsForTile(nextTile.type),
        position: {
          referencePanel: sourceTileId,
          direction: dockDirection,
        },
      });

      workbenchActions.setActiveTile(
        input.projectId,
        input.activeLaneId,
        nextTile.id,
        input.workspaceId,
      );
      api.getPanel(nextTile.id)?.api.setActive();
    },
    [getLiveWorkbench, input.activeLaneId, input.projectId, input.workspaceId, workbenchActions],
  );

  const handleDockviewReady = useCallback(
    (event: DockviewReadyEvent) => {
      dockviewApiRef.current = event.api;
      setDockviewReadyScopeKey(input.workbenchScopeKey ?? "workbench");
      if (import.meta.env.DEV && typeof window !== "undefined") {
        // Exposed for layout diagnostics (panel move/bounds verification).
        (window as unknown as Record<string, unknown>).__dockApi = event.api;
        (window as unknown as Record<string, unknown>).__dockReadyScope =
          input.workbenchScopeKey ?? "workbench";
      }

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

      event.api.onWillDragPanel((dragEvent) => {
        if (dragEvent.panel.api.component === "changes") {
          dragEvent.nativeEvent.preventDefault();
        }
      });

      event.api.onWillShowOverlay((overlayEvent) => {
        const isChangesGroup = overlayEvent.group?.panels.some(
          (panel) => panel.id === CHANGES_PANEL_ID,
        );
        if (isChangesGroup) {
          overlayEvent.preventDefault();
        }
      });

      event.api.onUnhandledDragOver((dragEvent) => {
        const dataTransfer = readNativeDataTransfer(dragEvent.nativeEvent);
        if (
          !dataTransfer?.types.includes("Files") &&
          !dataTransfer?.types.includes("text/uri-list") &&
          !dataTransfer?.types.includes("text/plain")
        ) {
          return;
        }
        dragEvent.accept();
      });

      event.api.onDidDrop((dropEvent) => {
        if (!input.projectId) return;
        const droppedTarget = readDroppedBrowserTarget(
          readNativeDataTransfer(dropEvent.nativeEvent),
        );
        if (!droppedTarget) return;

        const nextTileId = workbenchActions.addTile(
          input.projectId,
          input.activeLaneId,
          "browser",
          {
            title: droppedTarget.title,
            url: droppedTarget.url,
          },
          input.workspaceId,
        );
        const nextTile = getLiveWorkbench()?.tiles[nextTileId];
        if (!nextTile) return;

        const referenceGroup = dropEvent.group?.id;
        event.api.addPanel({
          id: nextTile.id,
          title: nextTile.title,
          component: getDockComponentName(nextTile.type),
          params: getPanelParams(input.projectId, input.activeLaneId, nextTile.id),
          renderer: getPanelRendererForTile(nextTile.type),
          ...getPanelConstraintsForTile(nextTile.type),
          position: referenceGroup
            ? {
                referenceGroup,
                direction: "within",
              }
            : {
                direction: "right",
              },
        });

        workbenchActions.setActiveTile(
          input.projectId,
          input.activeLaneId,
          nextTile.id,
          input.workspaceId,
        );
        event.api.getPanel(nextTile.id)?.api.setActive();
      });

      event.api.onDidOpenPopoutWindowFail(() => {
        console.warn("[WorkbenchDockview] Popout window could not be opened");
      });

      event.api.onDidAddPanel(() => {
        if (isHydratingRef.current || isDestroyingRef.current) return;
        applyWorkbenchDockviewPolicies(event.api);
      });

      const handleWorkbenchKeyDown = (keyboardEvent: KeyboardEvent) => {
        const target = keyboardEvent.target as HTMLElement | null;
        const isEditableTarget =
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.isContentEditable;
        if (isEditableTarget) return;

        if ((keyboardEvent.metaKey || keyboardEvent.ctrlKey) && keyboardEvent.altKey) {
          if (keyboardEvent.key === "ArrowRight") {
            keyboardEvent.preventDefault();
            event.api.moveToNext({ includePanel: true });
          } else if (keyboardEvent.key === "ArrowLeft") {
            keyboardEvent.preventDefault();
            event.api.moveToPrevious({ includePanel: true });
          }
        }
      };

      keyboardNavigationCleanupRef.current?.();
      window.addEventListener("keydown", handleWorkbenchKeyDown);
      keyboardNavigationCleanupRef.current = () => {
        window.removeEventListener("keydown", handleWorkbenchKeyDown);
      };

      event.api.onDidActivePanelChange((activePanelEvent) => {
        if (!input.projectId) {
          return;
        }

        const activeId = activePanelEvent.panel?.id ?? null;
        if (activeId && selectionPreviewTilesRef.current[activeId]) {
          return;
        }

        workbenchActions.setActiveTile(
          input.projectId,
          input.activeLaneId,
          activeId,
          input.workspaceId,
        );
      });

      event.api.onDidRemovePanel((panel) => {
        if (isDestroyingRef.current || isHydratingRef.current) {
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

        if (panel.id === CHANGES_PANEL_ID) {
          if (!isMigratingChangesPanelRef.current) {
            closeChanges();
          }
          saveLayout();
          return;
        }

        const liveProject = getLiveWorkbench();
        const removedTile = liveProject?.tiles[panel.id] ?? null;
        if (removedTile?.type === "devServer") {
          releaseDevServerSurfaceLease(panel.id);
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
              console.warn(
                "[WorkbenchSession] Failed to release terminal for removed panel",
                error,
              );
            });
        }
        if (removedTile?.type === "devServer" || removedTile?.type === "mobileSimulator") {
          const projectDevAppRuntime =
            removedTile.type === "devServer"
              ? resolveProjectDevAppRuntimeTarget(removedTile, {
                  projectId: input.projectId,
                  laneId: input.activeLaneId,
                  workspaceId: input.workspaceId,
                })
              : null;

          if (projectDevAppRuntime?.usesProjectDevAppSource) {
            void releaseProjectDevAppRuntimeTarget(projectDevAppRuntime, panel.id).catch(
              (error) => {
                console.warn("[ProjectDevApp] Failed to release removed source runtime", error);
              },
            );
          } else {
            void window.electronAPI.workbenchSession
              .releaseTerminal({
                sessionKey: input.workbenchSessionKey,
                projectId: input.projectId,
                laneId: input.activeLaneId,
                tileId: panel.id,
                close: removedTile.type !== "devServer",
              })
              .then(async (result) => {
                if (!result.terminalId) return;

                if (removedTile.type === "devServer") {
                  const detached = input.workspaceId
                    ? await window.electronAPI.devServer.detachSurface({
                        workspaceId: input.workspaceId,
                        laneId: input.activeLaneId,
                        terminalId: result.terminalId,
                      })
                    : { success: true, ownsRuntime: false };

                  if (!detached.ownsRuntime) {
                    await window.electronAPI.terminal.kill({ terminalId: result.terminalId });
                  }
                }

                useTerminalStore.getState().actions.removeTerminal(result.terminalId);
              })
              .catch((error) => {
                console.warn("[WorkbenchSession] Failed to release runtime terminal", error);
              });
          }
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
                console.warn(
                  "[WorkbenchSession] Failed to stop native preview for removed panel",
                  error,
                );
              });
          }
        }

        workbenchActions.removeTile(
          input.projectId,
          input.activeLaneId,
          panel.id,
          input.workspaceId,
        );

        if (event.api.totalPanels === 0 && !isDestroyingRef.current && !isHydratingRef.current) {
          const freshWorkbench = getLiveWorkbench();
          if (freshWorkbench && freshWorkbench.order.length > 0) {
            for (const tileId of freshWorkbench.order) {
              const tile = freshWorkbench.tiles[tileId];
              if (tile && !isObsoleteWorkbenchTile(tile)) {
                event.api.addPanel(
                  buildAddPanelOptions(event.api, tile, input.projectId, input.activeLaneId),
                );
              }
            }
            if (freshWorkbench.activeTileId) {
              event.api.getPanel(freshWorkbench.activeTileId)?.api.setActive();
            }
          }
        }

        saveLayout();
      });

      // Hydrate synchronously when the layout is already known (warm project
      // switches). Deferring to the post-commit effect lets the fresh dockview
      // paint a zero-panel frame, which flashes the watermark launcher over
      // the content area before the real tiles replace it.
      if (input.projectId && input.projectWorkbench && input.isLayoutPersistenceReady) {
        const hydrationKey = `${input.workbenchScopeKey}:${input.projectWorkbench.layoutResetKey}`;
        if (hydratedProjectKeyRef.current !== hydrationKey) {
          hydratedProjectKeyRef.current = hydrationKey;
          hydrateDockviewPanels(event.api);
        }
      }
    },
    [
      closeChanges,
      getLiveWorkbench,
      hydrateDockviewPanels,
      input.activeLaneId,
      input.isLayoutPersistenceReady,
      input.projectId,
      input.projectWorkbench,
      input.workspaceId,
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

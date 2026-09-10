import type { DockviewApi, DockviewPanelApi } from "dockview-react";
import { useEffect, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Globe02Icon as __GlobeHugeIcon,
  Refresh01Icon as __RefreshHugeIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { BrowserSurfaceBackendSlot } from "@/features/browser/BrowserSurfaceBackendSlot";
import { resolveBrowserPageError } from "@/features/browser/browserPageError";
import { browserSurfaceModels } from "@/features/browser/browserSurfaceModel";
import {
  browserSurfaceRuntimeTabId,
  canonicalBrowserWorkbenchSessionKey,
} from "@/features/browser/browserSurfaceIdentity";
import { useBrowserSurfaceFocusStore } from "@/features/browser/browserSurfaceFocusStore";
import { useBrowserSurfaceStateStore } from "@/features/browser/browserSurfaceStateStore";
import {
  resolveDockviewBrowserSurfaceNativeRadius,
  useDockviewBrowserSurfacePresentation,
} from "@/features/browser/useDockviewBrowserSurfaceLayer";
import { WorkbenchTileChrome } from "@/features/workbench/WorkbenchTileChrome";
import { useWorkbenchPanelActivityMode } from "@/features/workbench/useWorkbenchPanelActivityMode";
import { selectProjectWorkbench, useProjectWorkbenchStore } from "@/lib/workbenchStore";
import type { WorkbenchBrowserTile as WorkbenchBrowserTileRecord } from "@/lib/workbenchStore";
import type { BrowserSurfaceDescriptor } from "@shared/browserSurfaceTypes";

interface WorkbenchBrowserTileProps {
  projectId: string;
  laneId: string;
  tile: WorkbenchBrowserTileRecord;
  workspaceId: string | null;
  workbenchSessionKey: string | null;
  surfaceVisible: boolean;
  panelApi: DockviewPanelApi;
  containerApi: DockviewApi;
}

function BrowserStartState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-content-surface p-6 text-center">
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <HugeiconsIcon icon={__GlobeHugeIcon} className="size-4 shrink-0" />
        <span className="font-medium text-foreground">No page open</span>
      </div>
    </div>
  );
}

interface BrowserErrorStateProps {
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly onReload: () => void;
}

function BrowserErrorState({ title, description, url, onReload }: BrowserErrorStateProps) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-content-surface p-6 text-center">
      <div className="w-full max-w-xs space-y-2.5">
        <div className="flex items-center justify-center gap-2 text-sm">
          <HugeiconsIcon icon={__GlobeHugeIcon} className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="font-medium text-foreground whitespace-nowrap">{title}</h2>
        </div>
        {description ? (
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        ) : null}
        <p className="font-mono text-[11px] text-muted-foreground/70 truncate" title={url}>
          {url}
        </p>
        <div className="pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onReload}>
            <HugeiconsIcon icon={__RefreshHugeIcon} className="mr-1.5 size-3.5" />
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}

export function WorkbenchBrowserTile({
  projectId,
  laneId,
  tile,
  workspaceId,
  workbenchSessionKey,
  surfaceVisible: workbenchSurfaceVisible,
  panelApi,
  containerApi,
}: WorkbenchBrowserTileProps) {
  const actions = useProjectWorkbenchStore((state) => state.actions);
  const panelActivity = useWorkbenchPanelActivityMode(panelApi);
  const surfacePresentation = useDockviewBrowserSurfacePresentation(panelApi, containerApi);
  // Null while the workbench session is still resolving its key. The tile shell
  // renders anyway; only browser creation waits, because an identity minted from
  // a provisional key is a second browser for the same tile (INV-002).
  const canonicalSessionKey = canonicalBrowserWorkbenchSessionKey({ workbenchSessionKey });
  const runtimeTabId = browserSurfaceRuntimeTabId({
    projectId,
    laneId,
    workspaceId,
    workbenchSessionKey,
    tileId: tile.id,
    kind: "browser",
  });
  const descriptor = useMemo<BrowserSurfaceDescriptor | null>(
    () =>
      runtimeTabId && canonicalSessionKey
        ? {
            runtimeTabId,
            tileId: tile.id,
            workbenchSessionKey: canonicalSessionKey,
            kind: "browser",
            title: tile.title || "Browser",
            initialUrl: tile.url.trim() || null,
            storageScope: tile.storageScope ?? "workspace",
            workspaceId,
            laneId,
            runtimeGeneration: null,
          }
        : null,
    [
      canonicalSessionKey,
      laneId,
      runtimeTabId,
      tile.id,
      tile.storageScope,
      tile.title,
      tile.url,
      workspaceId,
    ],
  );
  // Which host renders this surface is decided by the migration ledger, inside
  // BrowserSurfaceBackendSlot, not here.
  const state = useBrowserSurfaceStateStore((store) =>
    runtimeTabId ? store.byTabId[runtimeTabId] : undefined,
  );
  const preview = window.desktopBridge?.preview;

  // A click into a native page moves focus inside Chromium without any DOM
  // event reaching the renderer, so Dockview cannot see it the way it sees a
  // click on DOM content. Main reports it, and the tile activates itself.
  const nativeFocused = useBrowserSurfaceFocusStore(
    (store) => runtimeTabId !== null && store.focusedRuntimeTabId === runtimeTabId,
  );
  useEffect(() => {
    if (nativeFocused && !panelApi.isActive) panelApi.setActive();
  }, [nativeFocused, panelApi]);

  useEffect(() => {
    if (!state || state.navStatus.kind !== "Success") return;
    actions.updateBrowserTile(
      projectId,
      laneId,
      tile.id,
      {
        url: state.navStatus.url,
        title: state.navStatus.title || tile.title || "Browser",
        favicon: state.favicon?.dataUrl ?? tile.favicon,
      },
      workspaceId,
    );
  }, [actions, laneId, projectId, state, tile.favicon, tile.id, tile.title, workspaceId]);

  useEffect(() => {
    // Component unmount is presentation lifecycle, not browser lifecycle. A
    // Dockview move, hidden keep-alive workbench, route switch, StrictMode
    // replay or parent remount must preserve the main-owned page. Only close it
    // when the persisted workbench model says the tile itself is really gone.
    if (!runtimeTabId) return;
    return () => {
      const closingRuntimeTabId = runtimeTabId;
      const closingTileId = tile.id;
      window.setTimeout(() => {
        const liveWorkbench = selectProjectWorkbench(
          projectId,
          laneId,
          workspaceId,
        )(useProjectWorkbenchStore.getState());
        if (liveWorkbench?.tiles[closingTileId]?.type === "browser") return;
        void browserSurfaceModels.close(closingRuntimeTabId).catch((error) => {
          console.warn("[BrowserSurface] Failed to close removed browser tile", error);
        });
      }, 0);
    };
  }, [laneId, projectId, runtimeTabId, tile.id, workspaceId]);

  const navStatus = state?.navStatus;
  const showStartState = !tile.url.trim() && (!navStatus || navStatus.kind === "Idle");
  const pageError = resolveBrowserPageError(state);
  const surfaceVisible =
    workbenchSurfaceVisible && panelActivity.visible && !showStartState && !pageError;
  const reload = () => {
    if (runtimeTabId && state?.webContentsId && preview) {
      void preview.refresh(runtimeTabId).catch(() => undefined);
    }
  };

  return (
    <div className="h-full min-h-0" data-workbench-browser-tile="true">
      <WorkbenchTileChrome
        title={tile.title || "Browser"}
        panelApi={panelApi}
        containerApi={containerApi}
        hideTitlePill
        tileType="browser"
      >
        <div className="relative h-full min-h-0 overflow-hidden bg-content-surface">
          {/* Withheld until identity is canonical: the shell renders, Chromium waits. */}
          {descriptor ? (
          <BrowserSurfaceBackendSlot
            descriptor={descriptor}
            visible={surfaceVisible}
            borderRadius={surfacePresentation.borderRadius}
            cornerRadius={resolveDockviewBrowserSurfaceNativeRadius(surfacePresentation.borderRadius)}
            stackingLayer={surfacePresentation.stackingLayer}
            subscribePositionChanges={surfacePresentation.subscribePositionChanges}
            className="absolute inset-0 size-full"
          />
          ) : null}
          {showStartState ? <BrowserStartState /> : null}
          {pageError?.kind === "transport" ? (
            <BrowserErrorState
              title="This page could not be reached"
              description={`${pageError.description} (${pageError.code})`}
              url={pageError.url}
              onReload={reload}
            />
          ) : null}
          {pageError?.kind === "http" ? (
            <BrowserErrorState
              title={`${pageError.diagnostic.statusCode} ${pageError.diagnostic.statusText || "HTTP error"}`}
              description="The server returned an empty error response."
              url={pageError.diagnostic.url}
              onReload={reload}
            />
          ) : null}
        </div>
      </WorkbenchTileChrome>
    </div>
  );
}

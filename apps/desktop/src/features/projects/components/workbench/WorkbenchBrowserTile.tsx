import type { DockviewApi, DockviewPanelApi } from "dockview-react";
import { useEffect, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Globe02Icon as __GlobeHugeIcon,
  Refresh01Icon as __RefreshHugeIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { BrowserSurfaceSlot } from "@/features/projects/browser/BrowserSurfaceSlot";
import { resolveBrowserPageError } from "@/features/projects/browser/browserPageError";
import {
  browserSurfaceRuntimeTabId,
  resolveBrowserWorkbenchSessionKey,
} from "@/features/projects/browser/browserSurfaceIdentity";
import { useBrowserSurfaceStateStore } from "@/features/projects/browser/browserSurfaceStateStore";
import { useHostedBrowserSurface } from "@/features/projects/browser/browserSurfaceRegistry";
import { useDockviewBrowserSurfacePresentation } from "@/features/projects/browser/useDockviewBrowserSurfaceLayer";
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome";
import { useWorkbenchPanelActivityMode } from "@/features/projects/components/workbench/useWorkbenchPanelActivityMode";
import { useProjectWorkbenchStore } from "@/stores/useProjectWorkbenchStore";
import type { WorkbenchBrowserTile as WorkbenchBrowserTileRecord } from "@/stores/useProjectWorkbenchStore";
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
      <div className="flex max-w-sm flex-col items-center gap-2">
        <div className="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-muted/45 text-muted-foreground">
          <HugeiconsIcon icon={__GlobeHugeIcon} className="size-5" />
        </div>
        <h2 className="text-sm font-medium text-foreground">No page open</h2>
        <p className="text-xs leading-5 text-muted-foreground">
          Search or enter a URL above to open it in this Browser tile.
        </p>
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
      <div className="flex max-w-lg flex-col items-center gap-3">
        <div className="space-y-1.5">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <div className="w-full max-w-md rounded-md border border-border/60 bg-muted/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          <span className="block truncate" title={url}>
            {url}
          </span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onReload}>
          <HugeiconsIcon icon={__RefreshHugeIcon} className="mr-1.5 size-3.5" />
          Reload
        </Button>
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
  const resolvedSessionKey = resolveBrowserWorkbenchSessionKey({
    projectId,
    laneId,
    workspaceId,
    workbenchSessionKey,
  });
  const runtimeTabId = browserSurfaceRuntimeTabId({
    projectId,
    laneId,
    workspaceId,
    workbenchSessionKey,
    tileId: tile.id,
    kind: "browser",
  });
  const descriptor = useMemo<BrowserSurfaceDescriptor>(
    () => ({
      runtimeTabId,
      tileId: tile.id,
      workbenchSessionKey: resolvedSessionKey,
      kind: "browser",
      title: tile.title || "Browser",
      initialUrl: tile.url.trim() || null,
      storageScope: tile.storageScope ?? "workspace",
      workspaceId,
      laneId,
      runtimeGeneration: null,
    }),
    [
      laneId,
      resolvedSessionKey,
      runtimeTabId,
      tile.id,
      tile.storageScope,
      tile.title,
      tile.url,
      workspaceId,
    ],
  );
  useHostedBrowserSurface(descriptor);
  const state = useBrowserSurfaceStateStore((store) => store.byTabId[runtimeTabId]);
  const preview = window.desktopBridge?.preview;

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

  const navStatus = state?.navStatus;
  const showStartState = !tile.url.trim() && (!navStatus || navStatus.kind === "Idle");
  const pageError = resolveBrowserPageError(state);
  const surfaceVisible =
    workbenchSurfaceVisible && panelActivity.visible && !showStartState && !pageError;
  const reload = () => {
    if (state?.webContentsId && preview) {
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
          <BrowserSurfaceSlot
            tabId={runtimeTabId}
            visible={surfaceVisible}
            borderRadius={surfacePresentation.borderRadius}
            stackingLayer={surfacePresentation.stackingLayer}
            className="absolute inset-0 size-full"
          />
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

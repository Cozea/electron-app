import type { DockviewApi, DockviewPanelApi } from "dockview-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon as __CloseHugeIcon,
  Globe02Icon as __GlobeHugeIcon,
  Refresh01Icon as __RefreshHugeIcon,
  Search01Icon as __SearchHugeIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrowserSurfaceSlot } from "@/features/projects/browser/BrowserSurfaceSlot";
import { BrowserSurfaceOverlays } from "@/features/projects/browser/BrowserSurfaceOverlays";
import { resolveBrowserPageError } from "@/features/projects/browser/browserPageError";
import { useBrowserFindUiStore } from "@/features/projects/browser/browserFindUiStore";
import {
  browserSurfaceRuntimeTabId,
  resolveBrowserWorkbenchSessionKey,
} from "@/features/projects/browser/browserSurfaceIdentity";
import { useBrowserSurfaceStateStore } from "@/features/projects/browser/browserSurfaceStateStore";
import { useHostedBrowserSurface } from "@/features/projects/browser/browserSurfaceRegistry";
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome";
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

function BrowserFindOverlay({ runtimeTabId }: { readonly runtimeTabId: string }) {
  const preview = window.desktopBridge?.preview;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const visible = useBrowserFindUiStore((store) => store.visibleByTabId[runtimeTabId] ?? false);
  const findState = useBrowserSurfaceStateStore((store) => store.byTabId[runtimeTabId]?.find);
  const [query, setQuery] = useState(findState?.query ?? "");

  useEffect(() => {
    if (!visible) return;
    setQuery(findState?.query ?? "");
    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [visible]);

  const close = () => {
    useBrowserFindUiStore.getState().setVisible(runtimeTabId, false);
    void preview?.stopFindInPage(runtimeTabId, "keepSelection").catch(() => undefined);
  };
  const find = (nextQuery: string, forward = true, findNext = false) => {
    setQuery(nextQuery);
    void preview?.findInPage(runtimeTabId, nextQuery, { forward, findNext }).catch(() => undefined);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      find(query, !event.shiftKey, true);
    }
  };

  if (!visible) return null;
  const matchLabel = findState?.matches
    ? `${findState.activeMatchOrdinal} of ${findState.matches}`
    : query.trim()
      ? "0 of 0"
      : "";

  return (
    <div className="absolute right-3 top-3 z-20 flex h-9 items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg">
      <HugeiconsIcon icon={__SearchHugeIcon} className="ml-1 size-3.5 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => find(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in page"
        className="h-7 w-48 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
        aria-label="Find in page"
      />
      <span className="min-w-12 text-center text-[11px] tabular-nums text-muted-foreground">
        {matchLabel}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={!query.trim()}
        onClick={() => find(query, false, true)}
        aria-label="Previous match"
      >
        ↑
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={!query.trim()}
        onClick={() => find(query, true, true)}
        aria-label="Next match"
      >
        ↓
      </Button>
      <Button type="button" variant="ghost" size="icon-xs" onClick={close} aria-label="Close find">
        <HugeiconsIcon icon={__CloseHugeIcon} className="size-3.5" />
      </Button>
    </div>
  );
}

function usePanelSurfaceVisibility(panelApi: DockviewPanelApi): boolean {
  const [visible, setVisible] = useState(() => panelApi.isActive && panelApi.isVisible);

  useEffect(() => {
    const update = () => setVisible(panelApi.isActive && panelApi.isVisible);
    const activeSubscription = panelApi.onDidActiveChange(update);
    const visibilitySubscription = panelApi.onDidVisibilityChange(update);
    update();
    return () => {
      activeSubscription.dispose();
      visibilitySubscription.dispose();
    };
  }, [panelApi]);

  return visible;
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
  const panelVisible = usePanelSurfaceVisibility(panelApi);
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
  const surfaceVisible = workbenchSurfaceVisible && panelVisible && !showStartState && !pageError;
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
          <BrowserFindOverlay runtimeTabId={runtimeTabId} />
          <BrowserSurfaceOverlays runtimeTabId={runtimeTabId} />
        </div>
      </WorkbenchTileChrome>
    </div>
  );
}

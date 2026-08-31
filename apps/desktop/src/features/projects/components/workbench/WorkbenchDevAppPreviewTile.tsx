import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DockviewApi, DockviewPanelApi } from "dockview-react";

import { BrowserSurfaceSlot } from "@/features/projects/browser/BrowserSurfaceSlot";
import {
  browserSurfaceRuntimeTabId,
  resolveBrowserWorkbenchSessionKey,
} from "@/features/projects/browser/browserSurfaceIdentity";
import { useHostedBrowserSurface } from "@/features/projects/browser/browserSurfaceRegistry";
import { useDockviewBrowserSurfacePresentation } from "@/features/projects/browser/useDockviewBrowserSurfaceLayer";
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome";
import { useWorkbenchPanelActivityMode } from "@/features/projects/components/workbench/useWorkbenchPanelActivityMode";
import {
  publishDevAppPreviewRuntime,
  releaseDevAppPreviewRuntime,
} from "@/features/projects/devapps/devAppPreviewRuntimeStore";
import type { WorkbenchDevAppPreviewTile as PreviewTileRecord } from "@/stores/useProjectWorkbenchStore";
import { Button } from "@/components/ui/button";
import type { BrowserSurfaceDescriptor } from "@shared/browserSurfaceTypes";
import { CAPABILITY_DESCRIPTIONS } from "@shared/devAppCapabilities";
import type { DevAppCapability } from "@shared/devAppCapabilities";
import type { DevAppPreviewStatus } from "@shared/devAppPreviewTypes";

/**
 * A DevApp under development, rendered exactly as an installed one would be.
 *
 * The tile renders the status the host produced and never assembles one of its own: what
 * an app is allowed to do, whether its package is valid, and whether it would publish are
 * all decided in main. That keeps this file a view — it cannot grant, approve, or mask
 * anything by being wrong.
 */

interface WorkbenchDevAppPreviewTileProps {
  projectId: string;
  laneId: string;
  tile: PreviewTileRecord;
  workspaceId: string | null;
  workbenchSessionKey: string | null;
  panelApi: DockviewPanelApi;
  containerApi: DockviewApi;
}

export function WorkbenchDevAppPreviewTile({
  projectId,
  laneId,
  tile,
  workspaceId,
  workbenchSessionKey,
  panelApi,
  containerApi,
}: WorkbenchDevAppPreviewTileProps) {
  const panelActivity = useWorkbenchPanelActivityMode(panelApi);
  const surfacePresentation = useDockviewBrowserSurfacePresentation(panelApi, containerApi);
  const [status, setStatus] = useState<DevAppPreviewStatus | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [hotReload, setHotReload] = useState(true);
  // State for rendering; a ref alongside it so unmount can close the preview it opened
  // even after the component has stopped re-rendering.
  const [sourceId, setSourceId] = useState<string | null>(null);
  const sourceIdRef = useRef<string | null>(null);
  const runtimeOwnerRef = useRef(Symbol(`devapp-preview:${tile.id}`));

  const preview = window.electronAPI?.devAppPreview;

  useEffect(() => {
    publishDevAppPreviewRuntime(runtimeOwnerRef.current, {
      tileId: tile.id,
      relativePath: tile.relativePath,
      status,
      hotReload,
      openError,
    });
  }, [hotReload, openError, status, tile.id, tile.relativePath]);

  useEffect(
    () => () => releaseDevAppPreviewRuntime(runtimeOwnerRef.current, tile.id),
    [tile.id],
  );

  // Opening is what assigns the source id, so the tile holds no location of its own.
  useEffect(() => {
    if (!preview || !workspaceId || !tile.relativePath) return;
    let cancelled = false;
    let openedSourceId: string | null = null;
    // React Strict Mode may overlap a superseded open with the active one. A lease per
    // effect attempt ensures cleanup for the older request cannot release the live tile.
    const leaseId = `${tile.id}_${crypto.randomUUID()}`;

    void preview
      .open({
        workspaceId,
        laneId,
        relativePath: tile.relativePath,
        leaseId,
      })
      .then((result) => {
        if (cancelled) {
          if (result.success && result.preview.status !== "invalid") {
            void preview
              .close({ sourceId: result.preview.sourceId, leaseId })
              .catch(() => undefined);
          }
          return;
        }
        if (!result.success) {
          setOpenError(result.error);
          return;
        }
        setOpenError(null);
        setHotReload(result.preview.hotReload);
        setStatus(result.preview);
        if (result.preview.status !== "invalid") {
          openedSourceId = result.preview.sourceId;
          sourceIdRef.current = result.preview.sourceId;
          setSourceId(result.preview.sourceId);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setOpenError(error instanceof Error ? error.message : "Could not open the preview.");
        }
      });

    return () => {
      cancelled = true;
      if (sourceIdRef.current === openedSourceId) {
        sourceIdRef.current = null;
        setSourceId(null);
      }
      if (openedSourceId) {
        void preview.close({ sourceId: openedSourceId, leaseId }).catch(() => undefined);
      }
    };
  }, [laneId, preview, tile.id, tile.relativePath, workspaceId]);

  // The host pushes a fresh status on every reload, crash, and preflight verdict.
  useEffect(() => {
    if (!preview) return;
    return preview.onStatus((payload) => {
      if (payload.sourceId === sourceIdRef.current) setStatus(payload.status);
    });
  }, [preview]);

  const approve = useCallback(() => {
    if (!preview || !sourceId || status?.status !== "needsApproval") return;
    setApprovalError(null);
    void preview
      .approve({ sourceId, approvalFingerprint: status.approvalFingerprint })
      .then((result) => {
        if (result.success) {
          setStatus(result.preview);
          return;
        }
        setApprovalError(result.error);
      })
      .catch((error: unknown) => {
        setApprovalError(error instanceof Error ? error.message : "Could not approve the preview.");
      });
  }, [preview, sourceId, status]);

  const running = status?.status === "running" ? status : null;
  const view = running?.view ?? null;

  // Both paths enter the shared T3 host. Built output uses the confined
  // development package protocol; framework previews use their declared URL.
  const surfaceUrl =
    view?.kind === "devServer" || view?.kind === "builtOutput" ? view.url : null;
  const sessionKey = resolveBrowserWorkbenchSessionKey({
    projectId,
    laneId,
    workspaceId,
    workbenchSessionKey,
  });

  // The generation is part of the identity, so a reload produces a new tab rather than
  // reusing one pointed at the old build.
  const runtimeTabId = useMemo(
    () =>
      sourceId && surfaceUrl
        ? browserSurfaceRuntimeTabId({
          projectId,
          laneId,
          workspaceId,
          workbenchSessionKey,
          tileId: tile.id,
          kind: "devAppPreview",
          runtimeGeneration: running?.reloadToken ?? 0,
        })
        : null,
    [
      laneId,
      projectId,
      running?.reloadToken,
      sourceId,
      surfaceUrl,
      tile.id,
      workbenchSessionKey,
      workspaceId,
    ],
  );

  const descriptor = useMemo<BrowserSurfaceDescriptor | null>(() => {
    if (!runtimeTabId || !surfaceUrl || !sourceId) return null;
    return {
      runtimeTabId,
      tileId: tile.id,
      workbenchSessionKey: sessionKey,
      kind: "devAppPreview",
      title: running?.name || tile.title,
      initialUrl: surfaceUrl,
      // Its own session. A preview never shares storage with a published app.
      storageScope: "devAppPreview",
      workspaceId,
      laneId,
      devSourceId: sourceId,
      // Changing this remounts the surface, which is how a reload reaches the view.
      runtimeGeneration: running?.reloadToken ?? 0,
    };
  }, [
    laneId,
    running?.name,
    running?.reloadToken,
    runtimeTabId,
    sessionKey,
    sourceId,
    surfaceUrl,
    tile.id,
    tile.title,
    workspaceId,
  ]);
  useHostedBrowserSurface(descriptor);

  return (
    <WorkbenchTileChrome
      title={running?.name || tile.title}
      tileType="devAppPreview"
      panelApi={panelApi}
      containerApi={containerApi}
      controls={<DevelopmentBadge status={status} hotReload={hotReload} />}
    >
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-content-surface">
        {openError ? (
          <PreviewMessage title="This DevApp could not be opened" detail={openError} />
        ) : status?.status === "invalid" ? (
          <PreviewDiagnostics status={status} />
        ) : status?.status === "needsApproval" ? (
          <PreviewApproval status={status} error={approvalError} onApprove={approve} />
        ) : running ? (
          <>
            {view?.kind === "unavailable" ? (
              <PreviewMessage title={view.reason} detail={view.fix ?? null} />
            ) : runtimeTabId ? (
              <BrowserSurfaceSlot
                tabId={runtimeTabId}
                visible={panelActivity.visible}
                borderRadius={surfacePresentation.borderRadius}
                stackingLayer={surfacePresentation.stackingLayer}
                subscribePositionChanges={surfacePresentation.subscribePositionChanges}
                className="absolute inset-0 size-full"
              />
            ) : <PreviewMessage title="Preparing the preview surface…" detail={null} />}
            <PreviewFooter status={running} />
          </>
        ) : (
          <PreviewMessage title="Opening…" detail={null} />
        )}
      </div>
    </WorkbenchTileChrome>
  );
}

function DevelopmentBadge({
  status,
  hotReload,
}: {
  status: DevAppPreviewStatus | null;
  hotReload: boolean;
}) {
  // Always shown, whatever the trust state. A development build is otherwise
  // indistinguishable from a published one, and the difference is the whole point.
  const badge = status && status.status !== "invalid" ? status.badge : null;
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="rounded-[4px] bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
        title={badge?.detail ?? "Unpublished code running from this project."}
      >
        {badge?.label ?? "Development"}
      </span>
      {hotReload ? null : (
        <span className="text-[10px] text-muted-foreground" title="Changes will not reload on their own.">
          no hot reload
        </span>
      )}
    </span>
  );
}

function PreviewMessage({ title, detail }: { title: string; detail: string | null }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}

function PreviewDiagnostics({
  status,
}: {
  status: Extract<DevAppPreviewStatus, { status: "invalid" }>;
}) {
  return (
    <div className="h-full overflow-auto p-6">
      <p className="text-sm font-medium text-foreground">This package cannot be loaded</p>
      <ul className="mt-3 space-y-3">
        {status.diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.code}-${index}`} className="space-y-1">
            <p className="text-xs font-medium text-foreground">{diagnostic.message}</p>
            {diagnostic.field ? (
              <p className="font-mono text-[11px] text-muted-foreground">{diagnostic.field}</p>
            ) : null}
            {diagnostic.fix ? (
              <p className="text-[11px] text-muted-foreground">{diagnostic.fix}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewApproval({
  status,
  error,
  onApprove,
}: {
  status: Extract<DevAppPreviewStatus, { status: "needsApproval" }>;
  error: string | null;
  onApprove: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {status.name} is asking for access
          </p>
          <p className="text-xs text-muted-foreground">{status.badge.detail}</p>
        </div>
        <ul className="space-y-1.5">
          {status.workerExecution ? (
            <li className="text-xs text-foreground">
              Run unpublished Node worker code from this project. Filesystem and process access
              are restricted, but network access is not OS-sandboxed.
            </li>
          ) : null}
          {status.requested.capabilities.map((capability) => (
            <li key={capability} className="text-xs text-foreground">
              {CAPABILITY_DESCRIPTIONS[capability as DevAppCapability] ?? capability}
            </li>
          ))}
          {status.requested.agentInvocable ? (
            <li className="text-xs text-foreground">
              Be used by agents without you watching
            </li>
          ) : null}
        </ul>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button size="sm" onClick={onApprove}>
          Allow for this session
        </Button>
        <p className="text-[11px] text-muted-foreground">
          This grant is not saved. It lapses when Cozea closes, and again whenever the app
          asks for more.
        </p>
      </div>
    </div>
  );
}

function PreviewFooter({
  status,
}: {
  status: Extract<DevAppPreviewStatus, { status: "running" }>;
}) {
  const blockers = status.preflight.diagnostics.filter((d) => d.severity === "blocker");
  const worker = status.worker;
  if (blockers.length === 0 && !worker?.lastError) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 border-t border-border bg-content-surface/95 px-3 py-2 backdrop-blur">
      {blockers.length > 0 ? (
        // Preflight runs continuously, so a project that has drifted out of publishable
        // shape says so here rather than at publish time.
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {blockers.length === 1
            ? blockers[0]!.message
            : `${blockers.length} problems would block publishing.`}
        </p>
      ) : null}
      {worker?.lastError ? (
        <p className="text-[11px] text-muted-foreground">
          Worker: {worker.lastError}
          {worker.restarts > 0 ? ` (restarted ${worker.restarts}×)` : ""}
        </p>
      ) : null}
    </div>
  );
}

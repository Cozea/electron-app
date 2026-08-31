import type {
  BrowserSurfaceDescriptor,
  CozeaBrowserSurfaceState,
  PreparedBrowserSurface,
} from "@shared/browserSurfaceTypes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { cn } from "@/lib/utils";

import { BrowserDeviceToolbar } from "./BrowserDeviceToolbar";
import { BrowserFindOverlay } from "./BrowserFindOverlay";
import { BrowserSurfaceOverlays } from "./BrowserSurfaceOverlays";
import { BrowserViewportResizeHandles } from "./BrowserViewportResizeHandles";
import {
  browserViewportSettingKey,
  resolveBrowserViewportLayout,
  resolveFittedBrowserViewport,
} from "./browserViewportLayout";
import { subscribeBrowserViewportChange } from "./browserViewportActions";
import { commitBrowserViewport, useBrowserViewportStore } from "./browserViewportStore";
import { resolveBrowserSurfacePanelRect, useBrowserSurfaceStore } from "./browserSurfaceStore";
import { useBrowserSurfaceStateStore } from "./browserSurfaceStateStore";
import { resolveHostedBrowserWebviewWrapperStyle } from "./hostedBrowserWebviewStyle";
import { APP_LAYERS } from "@/lib/appLayers";
import {
  INITIAL_WEBVIEW_CRASH_RECOVERY_STATE,
  planWebviewCrashRecovery,
  type WebviewCrashRecoveryState,
} from "./webviewCrashRecovery";
import { useBrowserViewportResize } from "./useBrowserViewportResize";
import { FILL_PREVIEW_VIEWPORT } from "./previewViewport";

interface ElectronWebview extends HTMLElement {
  src: string;
  partition: string;
  preload?: string;
  webpreferences?: string;
  getWebContentsId: () => number;
}

declare global {
  interface HTMLElementTagNameMap {
    webview: ElectronWebview;
  }
}

const pendingSurfaceOperations = new Map<string, Promise<void>>();

function enqueueSurfaceOperation(
  tabId: string,
  operation: () => Promise<void> | void,
): Promise<void> {
  const previous = pendingSurfaceOperations.get(tabId);
  const pending = previous
    ? previous.catch(() => undefined).then(operation)
    : Promise.resolve(operation());
  pendingSurfaceOperations.set(tabId, pending);
  void pending
    .finally(() => {
      if (pendingSurfaceOperations.get(tabId) === pending) pendingSurfaceOperations.delete(tabId);
    })
    .catch(() => undefined);
  return pending;
}

function stateUrl(state: CozeaBrowserSurfaceState | null): string | null {
  return state?.navStatus.kind === "Idle" ? null : (state?.navStatus.url ?? null);
}

export function HostedBrowserWebview({ descriptor }: { descriptor: BrowserSurfaceDescriptor }) {
  const preview = window.desktopBridge?.preview;
  const runtimeTabId = descriptor.runtimeTabId;
  const [initialSrc] = useState(() => descriptor.initialUrl ?? "about:blank");
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<ElectronWebview | null>(null);
  const crashRecoveryRef = useRef<WebviewCrashRecoveryState>(INITIAL_WEBVIEW_CRASH_RECOVERY_STATE);
  const latestUrlRef = useRef(descriptor.initialUrl);
  const readyRef = useRef<Promise<void>>(Promise.resolve());
  const [prepared, setPrepared] = useState<PreparedBrowserSurface | null>(null);
  const [webviewGeneration, setWebviewGeneration] = useState(0);
  const [recoverySrc, setRecoverySrc] = useState(initialSrc);
  const [aspectRatioLocked, setAspectRatioLocked] = useState(false);
  const surfaceState = useBrowserSurfaceStateStore((state) => state.byTabId[runtimeTabId] ?? null);
  const viewport =
    useBrowserViewportStore((state) => state.byTabId[runtimeTabId]) ?? FILL_PREVIEW_VIEWPORT;
  const presentation = useBrowserSurfaceStore(
    useShallow((state) => {
      const current = state.byTabId[runtimeTabId];
      return {
        content: current?.content ?? null,
        borderRadius: current?.borderRadius ?? "0",
        fitSourceContent: current?.fitSourceContent ?? false,
        fittedSourceContent: current?.fittedSourceContent ?? null,
        rect: resolveBrowserSurfacePanelRect(state.byTabId, runtimeTabId),
        stackingLayer: current?.stackingLayer ?? APP_LAYERS.browserDocked,
        visible: current?.visible ?? false,
      };
    }),
  );

  useEffect(() => {
    if (!preview) return;
    let disposed = false;
    crashRecoveryRef.current = INITIAL_WEBVIEW_CRASH_RECOVERY_STATE;
    const ready = enqueueSurfaceOperation(runtimeTabId, async () => {
      const initialDescriptor = descriptorRef.current;
      const next = await preview.prepareSurface(initialDescriptor);
      latestUrlRef.current = stateUrl(next.state) ?? initialDescriptor.initialUrl;
      if (!disposed) {
        useBrowserSurfaceStateStore.getState().apply(runtimeTabId, next.state);
        setPrepared(next);
      }
    });
    readyRef.current = ready;
    return () => {
      disposed = true;
      useBrowserSurfaceStateStore.getState().remove(runtimeTabId);
      useBrowserViewportStore.getState().remove(runtimeTabId);
      void enqueueSurfaceOperation(runtimeTabId, () => preview.releaseSurface(runtimeTabId)).catch(
        () => undefined,
      );
    };
  }, [preview, runtimeTabId]);

  useEffect(() => {
    if (!surfaceState) return;
    latestUrlRef.current = stateUrl(surfaceState) ?? latestUrlRef.current;
  }, [surfaceState]);

  useEffect(() => {
    if (!preview) return;
    void preview.setSurfaceActive(runtimeTabId, presentation.visible);
  }, [presentation.visible, preview, runtimeTabId]);

  const setWebviewRef = useCallback((node: HTMLElement | null) => {
    webviewRef.current = node as ElectronWebview | null;
    if (node && !node.hasAttribute("allowpopups")) node.setAttribute("allowpopups", "true");
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !prepared || !preview) return;
    let disposed = false;
    let recoveryTimeout: ReturnType<typeof setTimeout> | null = null;
    const register = () => {
      void (async () => {
        try {
          await readyRef.current;
          if (disposed || webviewRef.current !== webview) return;
          const webContentsId = webview.getWebContentsId();
          if (Number.isInteger(webContentsId) && webContentsId > 0) {
            await preview.registerWebview(runtimeTabId, webContentsId);
          }
        } catch {
          // did-attach and dom-ready retry registration while the guest settles.
        }
      })();
    };
    const recoverGuest = () => {
      if (disposed || recoveryTimeout !== null) return;
      const recovery = planWebviewCrashRecovery(crashRecoveryRef.current, Date.now());
      if (!recovery) return;
      crashRecoveryRef.current = recovery.state;
      recoveryTimeout = setTimeout(() => {
        recoveryTimeout = null;
        if (!disposed) {
          setRecoverySrc(latestUrlRef.current ?? initialSrc);
          setWebviewGeneration((generation) => generation + 1);
        }
      }, recovery.delayMs);
    };
    webview.addEventListener("did-attach", register);
    webview.addEventListener("dom-ready", register);
    webview.addEventListener("render-process-gone", recoverGuest);
    register();
    return () => {
      disposed = true;
      if (recoveryTimeout !== null) clearTimeout(recoveryTimeout);
      webview.removeEventListener("did-attach", register);
      webview.removeEventListener("dom-ready", register);
      webview.removeEventListener("render-process-gone", recoverGuest);
    };
  }, [initialSrc, prepared, preview, runtimeTabId, webviewGeneration]);

  const active = presentation.visible && presentation.rect !== null;
  const lastRect = presentation.rect;
  const zoomFactor = surfaceState?.zoomFactor ?? 1;
  const normalizedZoomFactor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const viewportWidth = viewport._tag === "fill" ? null : viewport.width;
  const viewportHeight = viewport._tag === "fill" ? null : viewport.height;
  const viewportAspectRatio =
    viewportWidth === null || viewportHeight === null ? null : viewportWidth / viewportHeight;
  const lockedAspectRatio =
    aspectRatioLocked && viewportAspectRatio !== null ? viewportAspectRatio : null;
  const handleAspectRatioChange = useCallback((aspectRatio: number | null) => {
    setAspectRatioLocked(aspectRatio !== null);
  }, []);
  const hiddenContentSize = presentation.content
    ? {
        width: presentation.content.width / presentation.content.scale,
        height: presentation.content.height / presentation.content.scale,
      }
    : null;
  const hiddenSize =
    viewport._tag !== "fill"
      ? {
          width: viewport.width * normalizedZoomFactor,
          height: viewport.height * normalizedZoomFactor,
        }
      : {
          width: hiddenContentSize?.width ?? lastRect?.width ?? 1280,
          height: hiddenContentSize?.height ?? lastRect?.height ?? 800,
        };
  const containerSize = active && lastRect ? lastRect : hiddenSize;
  const deviceToolbarVisible = active && viewport._tag !== "fill" && !presentation.fitSourceContent;
  const {
    activeDrag,
    commitViewportChange,
    effectiveViewport,
    handleResizeKeyDown,
    handleResizePointerDown,
    layout: viewportLayout,
  } = useBrowserViewportResize({
    tabId: runtimeTabId,
    viewport,
    zoomFactor,
    containerSize,
    deviceToolbarVisible,
    aspectRatio: lockedAspectRatio,
  });
  const fittedSourceViewport =
    presentation.fitSourceContent && lastRect
      ? resolveFittedBrowserViewport(
          viewport,
          presentation.fittedSourceContent,
          normalizedZoomFactor,
        )
      : null;
  const layout =
    fittedSourceViewport && lastRect
      ? resolveBrowserViewportLayout(lastRect, fittedSourceViewport, normalizedZoomFactor)
      : viewportLayout;

  useEffect(
    () =>
      subscribeBrowserViewportChange(runtimeTabId, (next) =>
        commitBrowserViewport(runtimeTabId, next),
      ),
    [runtimeTabId],
  );

  const syncContentPresentation = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    useBrowserSurfaceStore.getState().presentContent(runtimeTabId, {
      x: layout.viewportX,
      y: layout.viewportY,
      width: layout.viewportWidth,
      height: layout.viewportHeight,
      scale: layout.viewportScale,
      scrollLeft: wrapper.scrollLeft,
      scrollTop: wrapper.scrollTop,
    });
  }, [layout, runtimeTabId]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(syncContentPresentation);
    return () => window.cancelAnimationFrame(frameId);
  }, [syncContentPresentation]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    wrapper.scrollTo({ left: 0, top: 0 });
  }, [runtimeTabId, viewport._tag, viewportHeight, viewportWidth]);

  if (!prepared) return null;
  const wrapperStyle = resolveHostedBrowserWebviewWrapperStyle({
    active,
    borderRadius: presentation.borderRadius,
    stackingLayer: presentation.stackingLayer,
    rect: lastRect,
    hiddenSize,
  });

  return (
    <div
      ref={wrapperRef}
      className="fixed overflow-hidden bg-muted/35"
      style={{ ...wrapperStyle, overscrollBehavior: "contain" }}
      onScroll={syncContentPresentation}
      data-preview-viewport={runtimeTabId}
    >
      <div className="relative" style={{ width: layout.canvasWidth, height: layout.canvasHeight }}>
        {deviceToolbarVisible && effectiveViewport._tag !== "fill" ? (
          <BrowserDeviceToolbar
            setting={effectiveViewport}
            width={Math.max(1, Math.round(containerSize.width))}
            aspectRatio={lockedAspectRatio}
            onAspectRatioChange={handleAspectRatioChange}
            onChange={commitViewportChange}
          />
        ) : null}
        <webview
          key={webviewGeneration}
          ref={setWebviewRef}
          src={webviewGeneration === 0 ? initialSrc : recoverySrc}
          partition={prepared.config.partition}
          webpreferences={prepared.config.webPreferences}
          {...(prepared.config.preloadUrl ? { preload: prepared.config.preloadUrl } : {})}
          data-runtime-tab-id={runtimeTabId}
          data-preview-tab={runtimeTabId}
          data-preview-viewport-mode={effectiveViewport._tag}
          data-preview-viewport-key={browserViewportSettingKey(effectiveViewport)}
          data-preview-css-width={
            fittedSourceViewport
              ? fittedSourceViewport.width
              : effectiveViewport._tag === "fill"
                ? Math.max(1, Math.round(layout.viewportWidth / normalizedZoomFactor))
                : effectiveViewport.width
          }
          data-preview-css-height={
            fittedSourceViewport
              ? fittedSourceViewport.height
              : effectiveViewport._tag === "fill"
                ? Math.max(1, Math.round(layout.viewportHeight / normalizedZoomFactor))
                : effectiveViewport.height
          }
          aria-hidden={active ? undefined : true}
          className={cn(
            "absolute flex overflow-hidden bg-background",
            active && !layout.fillsPanel && "ring-1 ring-border/70 shadow-sm",
          )}
          style={{
            left: layout.viewportX,
            top: layout.viewportY,
            width: layout.viewportWidth / layout.viewportScale,
            height: layout.viewportHeight / layout.viewportScale,
            transform: layout.viewportScale < 1 ? `scale(${layout.viewportScale})` : undefined,
            transformOrigin: "top left",
          }}
        />
        {active && effectiveViewport._tag !== "fill" && !fittedSourceViewport ? (
          <>
            <BrowserViewportResizeHandles
              layout={layout}
              activeDirection={activeDrag?.direction ?? null}
              onPointerDown={handleResizePointerDown}
              onKeyDown={handleResizeKeyDown}
            />
            {activeDrag ? (
              <div
                className="pointer-events-none absolute z-40 -translate-x-1/2 rounded-md border border-border/80 bg-background/95 px-2 py-1 text-[11px] font-medium tabular-nums text-foreground shadow-md backdrop-blur-sm"
                style={{
                  left: layout.viewportX + layout.viewportWidth / 2,
                  top: layout.viewportY + 10,
                }}
                aria-hidden="true"
              >
                {activeDrag.width} × {activeDrag.height}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {active ? (
        <>
          {descriptor.kind === "browser" ? (
            <BrowserFindOverlay runtimeTabId={runtimeTabId} />
          ) : null}
          <BrowserSurfaceOverlays runtimeTabId={runtimeTabId} />
          <div
            className="pointer-events-none absolute inset-0 z-50 rounded-[inherit] ring-1 ring-inset ring-border/60"
            aria-hidden="true"
            data-browser-surface-frame
          />
        </>
      ) : null}
    </div>
  );
}

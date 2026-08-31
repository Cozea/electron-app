import type {
  BrowserSurfaceDescriptor,
  CozeaBrowserSurfaceState,
  PreparedBrowserSurface,
} from "@shared/browserSurfaceTypes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { resolveBrowserSurfacePanelRect, useBrowserSurfaceStore } from "./browserSurfaceStore";
import { useBrowserSurfaceStateStore } from "./browserSurfaceStateStore";
import { resolveHostedBrowserWebviewWrapperStyle } from "./hostedBrowserWebviewStyle";
import {
  INITIAL_WEBVIEW_CRASH_RECOVERY_STATE,
  planWebviewCrashRecovery,
  type WebviewCrashRecoveryState,
} from "./webviewCrashRecovery";

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
  const surfaceState = useBrowserSurfaceStateStore((state) => state.byTabId[runtimeTabId] ?? null);
  const presentation = useBrowserSurfaceStore(
    useShallow((state) => {
      const current = state.byTabId[runtimeTabId];
      return {
        cornerRadius: current?.cornerRadius ?? 0,
        rect: resolveBrowserSurfacePanelRect(state.byTabId, runtimeTabId),
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
      void enqueueSurfaceOperation(runtimeTabId, () => preview.releaseSurface(runtimeTabId)).catch(
        () => undefined,
      );
    };
  }, [preview, runtimeTabId]);

  useEffect(() => {
    if (!surfaceState) return;
    latestUrlRef.current = stateUrl(surfaceState) ?? latestUrlRef.current;
    setPrepared((current) => (current ? { ...current, state: surfaceState } : current));
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

  if (!prepared) return null;
  const active = presentation.visible && presentation.rect !== null;
  const wrapperStyle = resolveHostedBrowserWebviewWrapperStyle({
    active,
    cornerRadius: presentation.cornerRadius,
    rect: presentation.rect,
    hiddenSize: {
      width: presentation.rect?.width ?? 1280,
      height: presentation.rect?.height ?? 800,
    },
  });

  return (
    <div
      ref={wrapperRef}
      className="fixed overflow-hidden bg-background"
      style={wrapperStyle}
      data-preview-viewport={runtimeTabId}
    >
      <webview
        key={webviewGeneration}
        ref={setWebviewRef}
        src={webviewGeneration === 0 ? initialSrc : recoverySrc}
        partition={prepared.config.partition}
        webpreferences={prepared.config.webPreferences}
        {...(prepared.config.preloadUrl ? { preload: prepared.config.preloadUrl } : {})}
        data-runtime-tab-id={runtimeTabId}
        data-preview-tab={runtimeTabId}
        aria-hidden={active ? undefined : true}
        className="absolute inset-0 flex size-full overflow-hidden bg-background"
      />
    </div>
  );
}

import { useEffect } from "react";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { useBrowserPointerStore } from "./browserPointerStore";
import { useBrowserSurfaceStateStore } from "./browserSurfaceStateStore";

/**
 * Subscribes the renderer to main's browser-surface events.
 *
 * These serve every backend, so they must not live inside the renderer
 * `<webview>` host. That host is lazily mounted only when the legacy surface
 * registry has entries, and a native surface never registers there -- so
 * hosting these subscriptions inside it meant a native-backed tile received no
 * state at all and sat at "No page open" with no title, favicon or error,
 * however well its page had loaded.
 *
 * Mounted unconditionally, next to the host gate.
 */
export function BrowserSurfaceRuntimeBridge() {
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    const stopPointerEvents = preview.onPointerEvent((event) =>
      useBrowserPointerStore.getState().apply(event),
    );
    const stopStateEvents = preview.onSurfaceStateChange((runtimeTabId, state) =>
      useBrowserSurfaceStateStore.getState().apply(runtimeTabId, state),
    );
    return () => {
      stopPointerEvents();
      stopStateEvents();
    };
  }, []);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    let frameId: number | null = null;
    const publishTheme = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        void preview.setAnnotationTheme(readPreviewAnnotationTheme()).catch(() => undefined);
      });
    };
    publishTheme();
    const observer = new MutationObserver(publishTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => {
      observer.disconnect();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, []);

  return null;
}

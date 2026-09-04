import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { useBrowserPointerStore } from "./browserPointerStore";
import { useBrowserSurfaceRegistry } from "./browserSurfaceRegistry";
import { useBrowserSurfaceStateStore } from "./browserSurfaceStateStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { readPreviewAnnotationTheme } from "./annotationTheme";

export function ElectronBrowserHost() {
  const surfaces = useBrowserSurfaceRegistry(useShallow((state) => Object.values(state.byTabId)));

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

  if (!window.desktopBridge?.preview) return null;
  return (
    <div className="contents" data-electron-browser-host>
      {surfaces.map(({ descriptor }) => (
        <HostedBrowserWebview key={descriptor.runtimeTabId} descriptor={descriptor} />
      ))}
    </div>
  );
}

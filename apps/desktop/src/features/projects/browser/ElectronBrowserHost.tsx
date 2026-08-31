import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { useBrowserPointerStore } from "./browserPointerStore";
import { useBrowserSurfaceRegistry } from "./browserSurfaceRegistry";
import { useBrowserSurfaceStateStore } from "./browserSurfaceStateStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";

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

  if (!window.desktopBridge?.preview) return null;
  return (
    <div className="contents" data-electron-browser-host>
      {surfaces.map(({ descriptor }) => (
        <HostedBrowserWebview key={descriptor.runtimeTabId} descriptor={descriptor} />
      ))}
    </div>
  );
}

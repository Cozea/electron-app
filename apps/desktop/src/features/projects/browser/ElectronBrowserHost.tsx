import { useEffect } from "react";

import { useBrowserPointerStore } from "./browserPointerStore";
import { useBrowserSurfaceRegistry } from "./browserSurfaceRegistry";
import { HostedBrowserWebview } from "./HostedBrowserWebview";

export function ElectronBrowserHost() {
  const surfaces = useBrowserSurfaceRegistry((state) => Object.values(state.byTabId));

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onPointerEvent((event) => useBrowserPointerStore.getState().apply(event));
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

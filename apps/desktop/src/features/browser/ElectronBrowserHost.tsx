import { useShallow } from "zustand/react/shallow";

import { useBrowserSurfaceRegistry } from "./browserSurfaceRegistry";
import { HostedBrowserWebview } from "./HostedBrowserWebview";

export function ElectronBrowserHost() {
  const surfaces = useBrowserSurfaceRegistry(useShallow((state) => Object.values(state.byTabId)));

  // Surface state, pointer events and the annotation theme are published by
  // BrowserSurfaceRuntimeBridge. They serve every backend, and this host is
  // mounted only while the legacy registry has entries.
  if (!window.desktopBridge?.preview) return null;
  return (
    <div className="contents" data-electron-browser-host>
      {surfaces.map(({ descriptor }) => (
        <HostedBrowserWebview key={descriptor.runtimeTabId} descriptor={descriptor} />
      ))}
    </div>
  );
}

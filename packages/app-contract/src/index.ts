/**
 * @cozea/app-contract — the typed seam between the renderer and the backend.
 *
 * Entry points (import a specific one; this index only carries the small
 * bridge surface so nothing pulls the whole contract in by accident):
 *   @cozea/app-contract/desktopBridge   window.desktopBridge surface + status types
 *   @cozea/app-contract/electronApi     window.electronAPI (ElectronAPI) types
 *   @cozea/app-contract/desktopBootstrap window.cozeaBootstrap types
 *   @cozea/app-contract/browserSurface  browser surface IPC/types
 *
 * The electronApi / desktopBootstrap / browserSurface entries currently
 * re-export the modules in `shared/`; the files move into this package in a
 * later stage without changing any import path.
 */
export type * from "./desktopBridge"

import type { WebPreferences } from "electron";

/**
 * webPreferences for a main-owned browser `WebContentsView`.
 *
 * Electron-free so the posture is unit-testable without constructing a view,
 * mirroring the T3 fork's `WebviewPreferences` module.
 *
 * These are deliberately NOT a copy of the `<webview>` preferences. The guest
 * path runs `contextIsolation=false` because the annotation picker's preload
 * has to share `globalThis` with the page to read
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__` -- without it react-grab resolves every
 * pick to a null component name. That is a reviewed exception for one preload,
 * not the house default, so a native surface starts isolated and opts out
 * explicitly.
 */

/**
 * How a surface's preload shares scope with the page.
 *
 * - `isolated`: preload runs in its own world. The default, and the only
 *   posture safe for arbitrary third-party pages.
 * - `shared-world`: preload shares `globalThis` with the page. Required by the
 *   annotation picker, and permitted only alongside the OS sandbox.
 */
export type BrowserSurfacePreloadPosture = "isolated" | "shared-world";

export interface BrowserSurfaceWebPreferencesInput {
  readonly posture?: BrowserSurfacePreloadPosture;
  readonly preloadPath?: string | null;
}

/**
 * Raised rather than returning weakened preferences, because a silent downgrade
 * is exactly how this protection would be lost.
 */
export class UnsafeBrowserSurfacePreferencesError extends Error {}

export function browserSurfaceWebPreferences(
  input: BrowserSurfaceWebPreferencesInput = {},
): WebPreferences {
  const posture = input.posture ?? "isolated";
  const contextIsolation = posture === "isolated";

  // Without the OS sandbox, a preload sharing `globalThis` hands the page
  // `require`, and with it fs/child_process/IPC. The two settings are only ever
  // safe together, so they are decided in one place instead of at each call.
  const sandbox = true;

  if (!contextIsolation && !sandbox) {
    throw new UnsafeBrowserSurfacePreferencesError(
      "A shared-world preload requires the sandbox; refusing to build these preferences.",
    );
  }

  return {
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation,
    sandbox,
    // A browser surface never hosts a nested guest; the native host owns views.
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    // Focus is arbitrated by the host, not seized by whatever the page loads.
    focusOnNavigation: false,
    ...(input.preloadPath ? { preload: input.preloadPath } : {}),
  };
}

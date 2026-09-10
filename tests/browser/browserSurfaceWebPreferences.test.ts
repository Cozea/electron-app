import { describe, expect, it } from "vitest";

import {
  browserSurfaceWebPreferences,
  type BrowserSurfacePreloadPosture,
} from "../../apps/desktop/electron/services/browser/BrowserSurfaceWebPreferences";

/**
 * A native browser surface hosts arbitrary third-party pages, so these are
 * security settings rather than configuration. They are asserted directly so a
 * regression fails here rather than silently widening what a page can reach.
 */
describe("browserSurfaceWebPreferences", () => {
  it("isolates the preload by default", () => {
    const preferences = browserSurfaceWebPreferences();

    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.sandbox).toBe(true);
  });

  it("never grants Node access to a browser surface", () => {
    const preferences = browserSurfaceWebPreferences();

    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.nodeIntegrationInWorker).toBe(false);
    expect(preferences.nodeIntegrationInSubFrames).toBe(false);
  });

  it("keeps web security on and refuses nested guests", () => {
    const preferences = browserSurfaceWebPreferences();

    expect(preferences.webSecurity).toBe(true);
    expect(preferences.allowRunningInsecureContent).toBe(false);
    // Main owns native views; a surface must not be able to create its own.
    expect(preferences.webviewTag).toBe(false);
  });

  it("does not let a navigation seize focus from the workbench", () => {
    expect(browserSurfaceWebPreferences().focusOnNavigation).toBe(false);
  });

  it("keeps the sandbox on when the picker needs a shared-world preload", () => {
    const preferences = browserSurfaceWebPreferences({ posture: "shared-world" });

    // The picker's preload reads the page's React DevTools hook, so it shares
    // globalThis. The sandbox is what stops that sharing from also handing the
    // page `require`.
    expect(preferences.contextIsolation).toBe(false);
    expect(preferences.sandbox).toBe(true);
    expect(preferences.nodeIntegration).toBe(false);
  });

  it("attaches a preload only when one is supplied", () => {
    expect(browserSurfaceWebPreferences()).not.toHaveProperty("preload");
    expect(browserSurfaceWebPreferences({ preloadPath: "/tmp/preload.js" }).preload).toBe(
      "/tmp/preload.js",
    );
  });

  it("keeps the sandbox on for every posture", () => {
    const postures: ReadonlyArray<BrowserSurfacePreloadPosture> = ["isolated", "shared-world"];

    for (const posture of postures) {
      expect(browserSurfaceWebPreferences({ posture }).sandbox, posture).toBe(true);
    }
  });
});

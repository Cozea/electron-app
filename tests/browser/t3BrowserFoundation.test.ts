import { beforeEach, describe, expect, it } from "vitest";

import {
  acquireBrowserSurface,
  resolveBrowserSurfacePanelRect,
  useBrowserSurfaceStore,
} from "@/features/projects/browser/browserSurfaceStore";
import {
  HIDDEN_BROWSER_WEBVIEW_OFFSET,
  resolveHostedBrowserWebviewWrapperStyle,
} from "@/features/projects/browser/hostedBrowserWebviewStyle";
import {
  INITIAL_WEBVIEW_CRASH_RECOVERY_STATE,
  planWebviewCrashRecovery,
  WEBVIEW_CRASH_RECOVERY_WINDOW_MS,
} from "@/features/projects/browser/webviewCrashRecovery";

describe("pinned T3 browser host foundation", () => {
  beforeEach(() => useBrowserSurfaceStore.setState({ byTabId: {} }));

  it("gives the newest slot lease exclusive ownership and hides on release", () => {
    const staleLease = acquireBrowserSurface("tab");
    staleLease.present({ x: 0, y: 0, width: 500, height: 700 }, true);
    const liveRect = { x: 10, y: 20, width: 900, height: 640 };
    const liveLease = acquireBrowserSurface("tab");
    liveLease.present(liveRect, true);

    expect(staleLease.present({ x: 0, y: 0, width: 1, height: 1 }, true)).toBe(false);
    staleLease.release();
    expect(
      resolveBrowserSurfacePanelRect(useBrowserSurfaceStore.getState().byTabId, "tab"),
    ).toEqual(liveRect);

    liveLease.release();
    expect(useBrowserSurfaceStore.getState().byTabId.tab).toMatchObject({
      visible: false,
      owner: null,
    });
  });

  it("freezes source dimensions while a fitted presentation owns the slot", () => {
    const source = {
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
    };
    useBrowserSurfaceStore.getState().presentContent("tab", source);
    const lease = acquireBrowserSurface("tab", true);
    useBrowserSurfaceStore.getState().presentContent("tab", {
      ...source,
      width: 320,
      height: 180,
      scale: 0.25,
    });

    expect(useBrowserSurfaceStore.getState().byTabId.tab?.fittedSourceContent).toEqual(source);
    lease.release();
  });

  it("keeps hidden guests CSS-visible and physically offscreen for automation", () => {
    expect(
      resolveHostedBrowserWebviewWrapperStyle({
        active: false,
        rect: { x: 12, y: 34, width: 800, height: 600 },
        hiddenSize: { width: 393, height: 852 },
      }),
    ).toEqual({
      left: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      top: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      width: 393,
      height: 852,
      zIndex: -1,
      pointerEvents: "none",
      visibility: "visible",
    });
  });

  it("backs off crash replacement and resets after the upstream window", () => {
    const first = planWebviewCrashRecovery(INITIAL_WEBVIEW_CRASH_RECOVERY_STATE, 1000)!;
    const second = planWebviewCrashRecovery(first.state, 1100)!;
    const third = planWebviewCrashRecovery(second.state, 1200)!;

    expect([first.delayMs, second.delayMs, third.delayMs]).toEqual([250, 500, 1000]);
    expect(planWebviewCrashRecovery(third.state, 1300)).toBeNull();
    expect(
      planWebviewCrashRecovery(third.state, 1000 + WEBVIEW_CRASH_RECOVERY_WINDOW_MS),
    ).toMatchObject({ delayMs: 250, state: { attempts: 1 } });
  });
});

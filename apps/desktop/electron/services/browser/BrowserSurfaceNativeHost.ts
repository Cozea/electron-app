import type { BrowserWindow } from "electron";

import type { BrowserSurfaceDescriptor } from "../../../../../shared/browserSurfaceTypes";
import type { BrowserSurfaceSessionRegistry } from "./BrowserSurfaceSessionRegistry";
import type { BrowserSurfacePreloadPosture } from "./BrowserSurfaceWebPreferences";
import { BrowserSurfaceView, type BrowserSurfaceBounds } from "./BrowserSurfaceView";

/**
 * The single owner of native browser views (INV-001).
 *
 * One live view per `runtimeTabId` (INV-003): `ensureSurface` reconciles a
 * repeat call instead of creating a second Chromium browser, which is what
 * makes a tile survive presentation churn without giving React browser
 * lifetime authority.
 */

/** Registers a native surface's contents with T3 automation. */
export interface BrowserSurfaceAutomationBinder {
  /** Vouch for contents main created, then attach them to the tab. */
  attach(runtimeTabId: string, webContentsId: number): Promise<void>;
  /** Withdraw the vouch so a recycled WebContents id inherits no trust. */
  detach(webContentsId: number): Promise<void>;
}

export interface BrowserSurfaceNativeHostOptions {
  readonly sessions: BrowserSurfaceSessionRegistry;
  readonly getWindow: () => BrowserWindow | null;
  readonly automation?: BrowserSurfaceAutomationBinder | null;
  readonly resolvePreload?: (descriptor: BrowserSurfaceDescriptor) => string | null;
  /**
   * Override the preload-world policy. The current T3 preview preloads are
   * annotation-picker preloads and require shared-world to see the page's React
   * DevTools hook; a future keyboard-only or other isolated preload must opt
   * back to `isolated` explicitly here rather than inheriting that parity rule.
   */
  readonly resolvePreloadPosture?: (
    descriptor: BrowserSurfaceDescriptor,
  ) => BrowserSurfacePreloadPosture;
  /**
   * Full logical teardown owner. A renderer reload invalidates runtime ids, so
   * the service above this host must close T3/descriptor/native state together.
   */
  readonly onRendererInvalidated?: () => Promise<void>;
}

function sameOrder(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class BrowserSurfaceNativeHost {
  private readonly surfaces = new Map<string, BrowserSurfaceView>();
  private readonly options: BrowserSurfaceNativeHostOptions;
  private readonly watchedRenderers = new WeakSet<Electron.WebContents>();
  private rendererInvalidation: Promise<void> | null = null;
  private lastAppliedOrder: ReadonlyArray<string> = [];

  constructor(options: BrowserSurfaceNativeHostOptions) {
    this.options = options;
  }

  /**
   * A full renderer document replacement destroys renderer runtime identity.
   * Main notices it because a crashed/reloaded renderer cannot be trusted to
   * announce cleanup itself. The owner service performs the complete logical +
   * native teardown; this host falls back to native-only cleanup only in unit
   * isolation where no higher-level callback is supplied.
   */
  private watchHostRenderer(window: BrowserWindow): void {
    const contents = window.webContents;
    if (this.watchedRenderers.has(contents)) return;
    this.watchedRenderers.add(contents);

    const invalidate = () => {
      if (this.rendererInvalidation) return;
      const operation = (this.options.onRendererInvalidated?.() ?? this.releaseAll()).finally(() => {
        if (this.rendererInvalidation === operation) this.rendererInvalidation = null;
      });
      this.rendererInvalidation = operation;
      void operation.catch((error) => {
        console.warn("[BrowserSurfaceNativeHost] Renderer invalidation cleanup failed", error);
      });
    };

    contents.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) invalidate();
    });
    contents.on("render-process-gone", invalidate);
  }

  has(runtimeTabId: string): boolean {
    return this.surfaces.has(runtimeTabId);
  }

  get(runtimeTabId: string): BrowserSurfaceView | undefined {
    return this.surfaces.get(runtimeTabId);
  }

  /** Every live surface, for inventory and shutdown. */
  list(): ReadonlyArray<BrowserSurfaceView> {
    return Array.from(this.surfaces.values());
  }

  /**
   * The surface for a descriptor, creating it only if absent.
   *
   * A descriptor arriving twice for one `runtimeTabId` returns the existing
   * view rather than replacing it, so a renderer remount cannot silently
   * discard a live page and its session state.
   */
  async ensureSurface(descriptor: BrowserSurfaceDescriptor): Promise<BrowserSurfaceView> {
    const existing = this.surfaces.get(descriptor.runtimeTabId);
    if (existing && !existing.isDisposed) return existing;

    const window = this.options.getWindow();
    if (window && !window.isDestroyed()) this.watchHostRenderer(window);
    if (!window || window.isDestroyed()) {
      throw new Error("Cannot create a browser surface without a live window.");
    }

    const preloadPath = this.options.resolvePreload?.(descriptor) ?? null;
    const posture =
      this.options.resolvePreloadPosture?.(descriptor) ??
      // Current native product surfaces receive the same T3 picker preloads as
      // the legacy webview path. Those preloads require page-world access for
      // component-aware picks. Bare/shadow test surfaces remain isolated.
      (preloadPath ? "shared-world" : "isolated");
    const view = new BrowserSurfaceView({
      runtimeTabId: descriptor.runtimeTabId,
      descriptor,
      session: this.options.sessions.resolve(descriptor),
      window,
      preloadPath,
      posture,
    });
    this.surfaces.set(descriptor.runtimeTabId, view);

    if (this.options.automation) {
      try {
        await this.options.automation.attach(descriptor.runtimeTabId, view.webContentsId);
      } catch (cause) {
        // Attachment may have failed after a trust vouch was created. Revoke
        // best-effort before Chromium can recycle the id, then destroy the
        // unusable view. `detach` is deliberately idempotent.
        this.surfaces.delete(descriptor.runtimeTabId);
        await this.options.automation.detach(view.webContentsId).catch(() => undefined);
        view.dispose();
        throw cause;
      }
    }
    return view;
  }

  async releaseSurface(runtimeTabId: string): Promise<void> {
    const view = this.surfaces.get(runtimeTabId);
    if (!view) return;
    this.surfaces.delete(runtimeTabId);
    this.lastAppliedOrder = [];
    const webContentsId = view.isDisposed ? null : view.webContentsId;

    let detachError: unknown = null;
    if (webContentsId !== null && this.options.automation) {
      try {
        // Revoke before closing the WebContents so an id that Chromium reuses
        // cannot inherit a native-browser vouch even for a brief interval.
        await this.options.automation.detach(webContentsId);
      } catch (error) {
        detachError = error;
      }
    }

    view.dispose();
    if (detachError) throw detachError;
  }

  layoutSurface(runtimeTabId: string, bounds: BrowserSurfaceBounds, borderRadius = 0): void {
    this.surfaces.get(runtimeTabId)?.layout(bounds, borderRadius);
  }

  setSurfaceVisible(runtimeTabId: string, visible: boolean): void {
    this.surfaces.get(runtimeTabId)?.setVisible(visible);
  }

  setSurfaceOccluded(runtimeTabId: string, occluded: boolean): void {
    this.surfaces.get(runtimeTabId)?.setOccluded(occluded);
  }

  /**
   * Apply one canonical back-to-front order to overlapping surfaces.
   * The final id is front-most. Re-adding an unchanged order would churn the
   * native child list for no visual effect, so it is suppressed here.
   */
  setSurfaceOrder(orderedRuntimeTabIds: ReadonlyArray<string>): void {
    const uniqueLive = orderedRuntimeTabIds.filter(
      (runtimeTabId, index) =>
        orderedRuntimeTabIds.indexOf(runtimeTabId) === index && this.surfaces.has(runtimeTabId),
    );
    if (sameOrder(this.lastAppliedOrder, uniqueLive)) return;
    this.lastAppliedOrder = [...uniqueLive];
    for (const runtimeTabId of uniqueLive) {
      this.surfaces.get(runtimeTabId)?.bringToFront();
    }
  }

  focusSurface(runtimeTabId: string): void {
    this.surfaces.get(runtimeTabId)?.focus();
  }

  async releaseAll(): Promise<void> {
    for (const runtimeTabId of Array.from(this.surfaces.keys())) {
      try {
        await this.releaseSurface(runtimeTabId);
      } catch {
        // Continue releasing remaining native children during shutdown/reload.
      }
    }
  }
}

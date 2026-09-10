import type { BrowserWindow } from "electron";

import type { BrowserSurfaceDescriptor } from "../../../../../shared/browserSurfaceTypes";
import type { BrowserSurfaceSessionRegistry } from "./BrowserSurfaceSessionRegistry";
import { BrowserSurfaceView, type BrowserSurfaceBounds } from "./BrowserSurfaceView";

/**
 * The single owner of native browser views (INV-001).
 *
 * One live view per `runtimeTabId` (INV-003): `ensureSurface` reconciles a
 * repeat call instead of creating a second Chromium browser, which is what
 * makes a tile survive unmount, move and re-mount.
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
}

export class BrowserSurfaceNativeHost {
  private readonly surfaces = new Map<string, BrowserSurfaceView>();
  private readonly options: BrowserSurfaceNativeHostOptions;
  private readonly watchedRenderers = new WeakSet<Electron.WebContents>();

  constructor(options: BrowserSurfaceNativeHostOptions) {
    this.options = options;
  }

  /**
   * Drop every surface when the window's renderer document goes away.
   *
   * A `runtimeTabId` exists only in renderer memory, and a reloaded renderer
   * mints fresh ones, so it can neither name nor release the surfaces it asked
   * for before the reload. Those views stay parented to the window and keep
   * painting over the workbench, and closing the tile that used to own one
   * releases the surface created after the reload instead.
   *
   * Main owns these browsers (INV-001), so noticing the renderer leave is
   * main's job rather than something to trust the renderer to announce -- a
   * crashed renderer never gets to announce anything at all.
   */
  private watchHostRenderer(window: BrowserWindow): void {
    const contents = window.webContents;
    if (this.watchedRenderers.has(contents)) return;
    this.watchedRenderers.add(contents);

    contents.on("did-start-navigation", (details) => {
      // Same-document navigation keeps the renderer's memory, and with it every
      // runtimeTabId, so the surfaces are still owned and must not be dropped.
      if (details.isMainFrame && !details.isSameDocument) void this.releaseAll();
    });
    contents.on("render-process-gone", () => {
      void this.releaseAll();
    });
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
   * view rather than replacing it, so a React remount cannot silently discard a
   * live page and its session state.
   */
  async ensureSurface(descriptor: BrowserSurfaceDescriptor): Promise<BrowserSurfaceView> {
    const existing = this.surfaces.get(descriptor.runtimeTabId);
    if (existing && !existing.isDisposed) return existing;

    const window = this.options.getWindow();
    if (window && !window.isDestroyed()) this.watchHostRenderer(window);
    if (!window || window.isDestroyed()) {
      // Explicit failure rather than a surface that exists but never paints
      // (INV-013).
      throw new Error("Cannot create a browser surface without a live window.");
    }

    const view = new BrowserSurfaceView({
      runtimeTabId: descriptor.runtimeTabId,
      descriptor,
      session: this.options.sessions.resolve(descriptor),
      window,
      preloadPath: this.options.resolvePreload?.(descriptor) ?? null,
    });
    this.surfaces.set(descriptor.runtimeTabId, view);

    if (this.options.automation) {
      try {
        await this.options.automation.attach(descriptor.runtimeTabId, view.webContentsId);
      } catch (cause) {
        // A surface T3 cannot drive is not a usable surface; do not leave a
        // half-registered view behind.
        this.surfaces.delete(descriptor.runtimeTabId);
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
    const webContentsId = view.isDisposed ? null : view.webContentsId;
    view.dispose();
    if (webContentsId !== null && this.options.automation) {
      await this.options.automation.detach(webContentsId);
    }
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
   * Apply a front-to-back order to overlapping surfaces.
   *
   * Ordering is expressed by re-adding children back-to-front, because that is
   * what actually reorders native views; CSS cannot (INV-011).
   */
  setSurfaceOrder(orderedRuntimeTabIds: ReadonlyArray<string>): void {
    for (const runtimeTabId of orderedRuntimeTabIds) {
      this.surfaces.get(runtimeTabId)?.bringToFront();
    }
  }

  focusSurface(runtimeTabId: string): void {
    this.surfaces.get(runtimeTabId)?.focus();
  }

  async releaseAll(): Promise<void> {
    for (const runtimeTabId of Array.from(this.surfaces.keys())) {
      await this.releaseSurface(runtimeTabId);
    }
  }
}

import type { BrowserSurfaceBounds } from "@shared/browserSurfaceLayout";
import type { BrowserSurfaceDescriptor } from "@shared/browserSurfaceTypes";

import { BrowserSurfaceLayoutScheduler } from "./browserSurfaceLayoutScheduler";

/**
 * Renderer-side handle on a main-owned browser surface.
 *
 * Identity is `runtimeTabId`, not the React tree (INV-002). A model outlives
 * the components that reference it, so a tile unmounting and remounting -- a
 * Dockview move, a tab switch, a parent rerender -- reuses the same live
 * browser instead of destroying and recreating Chromium.
 *
 * The model's existence does not mean the surface is visible. Visibility is
 * stated separately, so a model can exist for a tile that is currently on a
 * hidden Dockview tab.
 */

/** Just the main-process calls a model needs. Injected so tests need no IPC. */
export interface NativeBrowserSurfaceBridge {
  /**
   * Register the descriptor with main, which validates it and resolves its
   * session. Creating a native view for an unprepared surface fails, so this
   * runs first.
   */
  prepareSurface: (descriptor: BrowserSurfaceDescriptor) => Promise<unknown>;
  ensureNativeSurface: (tabId: string) => Promise<void>;
  releaseNativeSurface: (tabId: string) => Promise<void>;
  layoutNativeSurface: (tabId: string, bounds: BrowserSurfaceBounds) => Promise<void>;
  setNativeSurfaceVisible: (tabId: string, visible: boolean) => Promise<void>;
  setNativeSurfaceOccluded: (tabId: string, occluded: boolean) => Promise<void>;
  setNativeSurfaceOrder: (orderedTabIds: ReadonlyArray<string>) => Promise<void>;
  focusNativeSurface: (tabId: string) => Promise<void>;
}

export class BrowserSurfaceModel {
  readonly runtimeTabId: string;
  private descriptor: BrowserSurfaceDescriptor;
  private readonly bridge: NativeBrowserSurfaceBridge;
  private readonly owners = new Set<symbol>();
  private ensured: Promise<void> | null = null;
  private released = false;
  private visible = false;
  private occluded = false;
  private lastBounds: BrowserSurfaceBounds | null = null;

  constructor(descriptor: BrowserSurfaceDescriptor, bridge: NativeBrowserSurfaceBridge) {
    this.runtimeTabId = descriptor.runtimeTabId;
    this.descriptor = descriptor;
    this.bridge = bridge;
  }

  get ownerCount(): number {
    return this.owners.size;
  }

  get isReleased(): boolean {
    return this.released;
  }

  get currentDescriptor(): BrowserSurfaceDescriptor {
    return this.descriptor;
  }

  /** Latest rectangle published to main, for diagnostics and tests. */
  get publishedBounds(): BrowserSurfaceBounds | null {
    return this.lastBounds;
  }

  addOwner(owner: symbol): void {
    this.owners.add(owner);
  }

  removeOwner(owner: symbol): void {
    this.owners.delete(owner);
  }

  updateDescriptor(descriptor: BrowserSurfaceDescriptor): void {
    this.descriptor = descriptor;
  }

  /**
   * Create the native surface, exactly once.
   *
   * The promise is cached rather than the boolean result, so concurrent
   * callers during mount await the same creation instead of racing into two
   * `ensureSurface` calls.
   */
  ensure(): Promise<void> {
    if (this.released) return Promise.resolve();
    this.ensured ??= (async () => {
      // Preparation carries the descriptor validation and session resolution
      // that the legacy host used to perform, so it must happen on this path
      // too rather than only when a `<webview>` announces itself.
      await this.bridge.prepareSurface(this.descriptor);
      await this.bridge.ensureNativeSurface(this.runtimeTabId);
    })().catch((error: unknown) => {
      // Clear the cache so a later attempt can retry rather than inheriting a
      // permanently rejected promise.
      this.ensured = null;
      throw error;
    });
    return this.ensured;
  }

  /** Publish a rectangle. Callers deduplicate; this records what was sent. */
  layout(bounds: BrowserSurfaceBounds): void {
    if (this.released) return;
    this.lastBounds = bounds;
    void this.bridge.layoutNativeSurface(this.runtimeTabId, bounds);
  }

  setVisible(visible: boolean): void {
    if (this.released || this.visible === visible) return;
    this.visible = visible;
    void this.bridge.setNativeSurfaceVisible(this.runtimeTabId, visible);
  }

  setOccluded(occluded: boolean): void {
    if (this.released || this.occluded === occluded) return;
    this.occluded = occluded;
    void this.bridge.setNativeSurfaceOccluded(this.runtimeTabId, occluded);
  }

  focus(): void {
    if (this.released) return;
    void this.bridge.focusNativeSurface(this.runtimeTabId);
  }

  /** Destroy the native surface. Only the registry should call this. */
  async destroy(): Promise<void> {
    if (this.released) return;
    this.released = true;
    this.ensured = null;
    await this.bridge.releaseNativeSurface(this.runtimeTabId);
  }
}

/**
 * The set of live models.
 *
 * Release is deferred by a macrotask because React unmounts the old subtree
 * before mounting the new one during a Dockview move. Destroying on the
 * synchronous unmount would tear down Chromium and lose the page every time a
 * tile changed groups.
 */
export class BrowserSurfaceModelRegistry {
  private readonly models = new Map<string, BrowserSurfaceModel>();
  private readonly pendingRelease = new Map<string, ReturnType<typeof setTimeout>>();
  private bridge: NativeBrowserSurfaceBridge;
  private readonly defer: (callback: () => void) => ReturnType<typeof setTimeout>;
  private readonly cancelDefer: (handle: ReturnType<typeof setTimeout>) => void;

  constructor(
    bridge: NativeBrowserSurfaceBridge,
    schedule?: {
      defer: (callback: () => void) => ReturnType<typeof setTimeout>;
      cancel: (handle: ReturnType<typeof setTimeout>) => void;
    },
  ) {
    this.bridge = bridge;
    this.defer = schedule?.defer ?? ((callback) => setTimeout(callback, 0));
    this.cancelDefer = schedule?.cancel ?? ((handle) => clearTimeout(handle));
  }

  setBridge(bridge: NativeBrowserSurfaceBridge): void {
    this.bridge = bridge;
  }

  get(runtimeTabId: string): BrowserSurfaceModel | undefined {
    return this.models.get(runtimeTabId);
  }

  size(): number {
    return this.models.size;
  }

  /** Take a reference, creating the model if this is the first owner. */
  acquire(descriptor: BrowserSurfaceDescriptor, owner: symbol): BrowserSurfaceModel {
    const pending = this.pendingRelease.get(descriptor.runtimeTabId);
    if (pending !== undefined) {
      // Reclaimed within the same tick: the tile moved, it did not close.
      this.cancelDefer(pending);
      this.pendingRelease.delete(descriptor.runtimeTabId);
    }

    let model = this.models.get(descriptor.runtimeTabId);
    if (!model || model.isReleased) {
      model = new BrowserSurfaceModel(descriptor, this.bridge);
      this.models.set(descriptor.runtimeTabId, model);
    } else {
      model.updateDescriptor(descriptor);
    }
    model.addOwner(owner);
    return model;
  }

  /** Drop a reference. The surface survives until the last owner is gone. */
  release(runtimeTabId: string, owner: symbol): void {
    const model = this.models.get(runtimeTabId);
    if (!model) return;
    model.removeOwner(owner);
    if (model.ownerCount > 0) return;

    const handle = this.defer(() => {
      this.pendingRelease.delete(runtimeTabId);
      const candidate = this.models.get(runtimeTabId);
      // Someone may have reclaimed it while the release was queued.
      if (!candidate || candidate.ownerCount > 0) return;
      this.models.delete(runtimeTabId);
      void candidate.destroy();
    });
    this.pendingRelease.set(runtimeTabId, handle);
  }

  /** Apply a back-to-front order to overlapping surfaces. */
  setOrder(orderedRuntimeTabIds: ReadonlyArray<string>): void {
    void this.bridge.setNativeSurfaceOrder(orderedRuntimeTabIds);
  }

  /** Tear everything down, for window close. */
  async destroyAll(): Promise<void> {
    for (const handle of this.pendingRelease.values()) this.cancelDefer(handle);
    this.pendingRelease.clear();
    const models = Array.from(this.models.values());
    this.models.clear();
    await Promise.all(models.map((model) => model.destroy()));
  }
}

/**
 * Bridge backed by the preload API.
 *
 * Resolved per call rather than captured, because the bridge is absent when the
 * renderer runs outside Electron (tests, storybook) and capturing it at module
 * scope would throw on import. A missing bridge is a no-op: without a main
 * process there is no native surface to place.
 */
const preloadBridge: NativeBrowserSurfaceBridge = {
  prepareSurface: async (descriptor) => await window.desktopBridge?.preview?.prepareSurface(descriptor),
  ensureNativeSurface: async (tabId) =>
    await window.desktopBridge?.preview?.ensureNativeSurface(tabId),
  releaseNativeSurface: async (tabId) =>
    await window.desktopBridge?.preview?.releaseNativeSurface(tabId),
  layoutNativeSurface: async (tabId, bounds) =>
    await window.desktopBridge?.preview?.layoutNativeSurface(tabId, bounds),
  setNativeSurfaceVisible: async (tabId, visible) =>
    await window.desktopBridge?.preview?.setNativeSurfaceVisible(tabId, visible),
  setNativeSurfaceOccluded: async (tabId, occluded) =>
    await window.desktopBridge?.preview?.setNativeSurfaceOccluded(tabId, occluded),
  setNativeSurfaceOrder: async (orderedTabIds) =>
    await window.desktopBridge?.preview?.setNativeSurfaceOrder(orderedTabIds),
  focusNativeSurface: async (tabId) =>
    await window.desktopBridge?.preview?.focusNativeSurface(tabId),
};

export const browserSurfaceModels = new BrowserSurfaceModelRegistry(preloadBridge);

export { BrowserSurfaceLayoutScheduler };

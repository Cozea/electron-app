import type { BrowserSurfaceBounds } from "@shared/browserSurfaceLayout";
import type { BrowserSurfaceDescriptor } from "@shared/browserSurfaceTypes";

import { BrowserSurfaceLayoutScheduler } from "./browserSurfaceLayoutScheduler";

/**
 * Renderer-side handle on a main-owned browser surface.
 *
 * Identity is `runtimeTabId`, not the React tree (INV-002). The model is only
 * a presentation proxy: losing every React/Dockview owner means the surface is
 * no longer being presented, not that its main-owned Chromium lifetime ended.
 * Workbench/session policy and explicit tile close own destruction.
 */

/** Just the main-process calls a model needs. Injected so tests need no IPC. */
export interface NativeBrowserSurfaceBridge {
  /**
   * Register/reconcile the descriptor with main. This operation is required to
   * be idempotent for an already-live warm surface: remounting its presentation
   * must not navigate or recreate the browser.
   */
  prepareSurface: (descriptor: BrowserSurfaceDescriptor) => Promise<unknown>;
  ensureNativeSurface: (tabId: string) => Promise<void>;
  /** Full logical + native close. Presentation release must never call this. */
  closeSurface: (tabId: string) => Promise<void>;
  layoutNativeSurface: (tabId: string, bounds: BrowserSurfaceBounds) => Promise<void>;
  setNativeSurfaceVisible: (tabId: string, visible: boolean) => Promise<void>;
  setNativeSurfaceOccluded: (tabId: string, occluded: boolean) => Promise<void>;
  /** Ordered back-to-front; the final id is the front-most native surface. */
  setNativeSurfaceOrder: (orderedTabIds: ReadonlyArray<string>) => Promise<void>;
  focusNativeSurface: (tabId: string) => Promise<void>;
}

export class BrowserSurfaceModel {
  readonly runtimeTabId: string;
  private descriptor: BrowserSurfaceDescriptor;
  private readonly bridge: NativeBrowserSurfaceBridge;
  private readonly owners = new Set<symbol>();
  private ensured: Promise<void> | null = null;
  private ready = false;
  private closed = false;
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

  get isClosed(): boolean {
    return this.closed;
  }

  get currentDescriptor(): BrowserSurfaceDescriptor {
    return this.descriptor;
  }

  /** Latest rectangle published by this presentation proxy. */
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
   * Attach this renderer model to the main-owned surface, exactly once per
   * model instance.
   *
   * A route round-trip may create a fresh renderer model for an already-live
   * surface. `prepareSurface` + `ensureNativeSurface` therefore have to be
   * idempotent in main and must return the existing page without navigating it.
   *
   * Explicit close is allowed to race an in-flight attach. We check `closed`
   * after every await and issue a full close again if necessary so a late
   * creation cannot resurrect a surface after its tile was removed.
   */
  ensure(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.ensured ??= (async () => {
      await this.bridge.prepareSurface(this.descriptor);
      if (this.closed) {
        await this.bridge.closeSurface(this.runtimeTabId);
        return;
      }

      await this.bridge.ensureNativeSurface(this.runtimeTabId);
      if (this.closed) {
        await this.bridge.closeSurface(this.runtimeTabId);
        return;
      }

      this.ready = true;
      this.flushDesiredState();
    })().catch((error: unknown) => {
      this.ready = false;
      this.ensured = null;
      throw error;
    });
    return this.ensured;
  }

  /**
   * Publish a rectangle. Recorded before readiness because the slot measures
   * synchronously while main creation is asynchronous; the settled rectangle
   * is flushed exactly once after attach completes.
   */
  layout(bounds: BrowserSurfaceBounds): void {
    if (this.closed) return;
    this.lastBounds = bounds;
    if (!this.ready) return;
    void this.bridge.layoutNativeSurface(this.runtimeTabId, bounds);
  }

  setVisible(visible: boolean): void {
    if (this.closed || this.visible === visible) return;
    this.visible = visible;
    if (!this.ready) return;
    void this.bridge.setNativeSurfaceVisible(this.runtimeTabId, visible);
  }

  /** Presentation disappeared; keep runtime alive but take native pixels off screen. */
  detachPresentation(): void {
    this.setVisible(false);
  }

  setOccluded(occluded: boolean): void {
    if (this.closed || this.occluded === occluded) return;
    this.occluded = occluded;
    if (!this.ready) return;
    void this.bridge.setNativeSurfaceOccluded(this.runtimeTabId, occluded);
  }

  /** Hand main only the latest state stated while creation was in flight. */
  private flushDesiredState(): void {
    if (this.closed || !this.ready) return;
    if (this.lastBounds) {
      void this.bridge.layoutNativeSurface(this.runtimeTabId, this.lastBounds);
    }
    if (this.visible) void this.bridge.setNativeSurfaceVisible(this.runtimeTabId, true);
    if (this.occluded) void this.bridge.setNativeSurfaceOccluded(this.runtimeTabId, true);
  }

  focus(): void {
    if (this.closed) return;
    void this.bridge.focusNativeSurface(this.runtimeTabId);
  }

  /**
   * Explicitly end the surface lifetime. This is used for a real tile/session
   * close, never for a React unmount or route backgrounding.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.visible = false;
    this.occluded = false;
    this.ensured = null;
    await this.bridge.closeSurface(this.runtimeTabId);
  }
}

/**
 * Renderer presentation models keyed by stable runtime id.
 *
 * A last-owner release is deliberately non-destructive. It hides the native
 * view and evicts only the renderer proxy after one macrotask. That one-tick
 * grace keeps Dockview moves cheap; longer route absences may discard the
 * proxy while the main-owned browser stays warm and is reattached later.
 */
export class BrowserSurfaceModelRegistry {
  private readonly models = new Map<string, BrowserSurfaceModel>();
  private readonly pendingEviction = new Map<string, ReturnType<typeof setTimeout>>();
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

  /** Take a presentation reference, creating only the renderer proxy if needed. */
  acquire(descriptor: BrowserSurfaceDescriptor, owner: symbol): BrowserSurfaceModel {
    const pending = this.pendingEviction.get(descriptor.runtimeTabId);
    if (pending !== undefined) {
      this.cancelDefer(pending);
      this.pendingEviction.delete(descriptor.runtimeTabId);
    }

    let model = this.models.get(descriptor.runtimeTabId);
    if (!model || model.isClosed) {
      model = new BrowserSurfaceModel(descriptor, this.bridge);
      this.models.set(descriptor.runtimeTabId, model);
    } else {
      model.updateDescriptor(descriptor);
    }
    model.addOwner(owner);
    return model;
  }

  /**
   * Drop a presentation reference. No browser lifetime ends here.
   *
   * When the last owner disappears, hide immediately and evict only the local
   * proxy after a macrotask. Main/session policy remains authoritative for the
   * live browser runtime.
   */
  release(runtimeTabId: string, owner: symbol): void {
    const model = this.models.get(runtimeTabId);
    if (!model) return;
    model.removeOwner(owner);
    if (model.ownerCount > 0) return;

    model.detachPresentation();
    const handle = this.defer(() => {
      this.pendingEviction.delete(runtimeTabId);
      const candidate = this.models.get(runtimeTabId);
      if (!candidate || candidate.ownerCount > 0) return;
      this.models.delete(runtimeTabId);
    });
    this.pendingEviction.set(runtimeTabId, handle);
  }

  /** Explicit tile/session close. This is the only destructive registry operation. */
  async close(runtimeTabId: string): Promise<void> {
    const pending = this.pendingEviction.get(runtimeTabId);
    if (pending !== undefined) {
      this.cancelDefer(pending);
      this.pendingEviction.delete(runtimeTabId);
    }
    const model = this.models.get(runtimeTabId);
    this.models.delete(runtimeTabId);
    if (model) {
      await model.close();
      return;
    }
    // A presentation model may already have been evicted while the main-owned
    // surface stayed warm. A later explicit close still has to reach main.
    await this.bridge.closeSurface(runtimeTabId);
  }

  /** Apply one canonical back-to-front order to overlapping surfaces. */
  setOrder(orderedRuntimeTabIds: ReadonlyArray<string>): void {
    void this.bridge.setNativeSurfaceOrder(orderedRuntimeTabIds);
  }

  /** Explicit renderer shutdown helper; not used for route/background teardown. */
  async destroyAll(): Promise<void> {
    for (const handle of this.pendingEviction.values()) this.cancelDefer(handle);
    this.pendingEviction.clear();
    const models = Array.from(this.models.values());
    this.models.clear();
    await Promise.all(models.map((model) => model.close()));
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
  closeSurface: async (tabId) => await window.desktopBridge?.preview?.releaseSurface(tabId),
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

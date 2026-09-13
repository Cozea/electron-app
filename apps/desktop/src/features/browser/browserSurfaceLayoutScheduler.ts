import {
  sameBrowserSurfaceBounds,
  type BrowserSurfaceBounds,
} from "@shared/browserSurfaceLayout";

/**
 * Coalesces layout measurement to one publish per animation frame per surface.
 *
 * Several sources can dirty the same surface in one frame -- a ResizeObserver,
 * a Dockview layout change and a window resize all fire for a single drag --
 * and each one measuring synchronously means repeated forced reflow and
 * repeated IPC for a rectangle that only ends up mattering once.
 *
 * Measurement happens inside the frame callback rather than at mark time, so
 * the value read is the settled one rather than an intermediate.
 */
export interface BrowserSurfaceLayoutSchedulerOptions {
  /** Measure the surface now, or return null when it cannot be measured. */
  readonly measure: () => BrowserSurfaceBounds | null;
  /** Publish a changed rectangle. Never called with an unchanged one. */
  readonly publish: (bounds: BrowserSurfaceBounds) => void;
  readonly requestFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

export class BrowserSurfaceLayoutScheduler {
  private readonly options: BrowserSurfaceLayoutSchedulerOptions;
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private frame: number | null = null;
  private lastPublished: BrowserSurfaceBounds | null = null;
  private disposed = false;

  constructor(options: BrowserSurfaceLayoutSchedulerOptions) {
    this.options = options;
    this.requestFrame =
      options.requestFrame ?? ((callback) => globalThis.requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => globalThis.cancelAnimationFrame(handle));
  }

  /** Note that the surface may have moved. Cheap, and safe to call often. */
  markDirty(): void {
    if (this.disposed || this.frame !== null) return;
    this.frame = this.requestFrame(() => {
      this.frame = null;
      this.flush();
    });
  }

  /**
   * Measure and publish immediately, bypassing the frame.
   *
   * Used for the first layout so a surface is not invisible for a frame, and
   * the deduplication still applies.
   */
  flush(): void {
    if (this.disposed) return;
    const bounds = this.options.measure();
    if (bounds === null) return;
    if (sameBrowserSurfaceBounds(this.lastPublished, bounds)) return;
    this.lastPublished = bounds;
    this.options.publish(bounds);
  }

  /** The rectangle main was last told about, for diagnostics and tests. */
  get published(): BrowserSurfaceBounds | null {
    return this.lastPublished;
  }

  get hasPendingFrame(): boolean {
    return this.frame !== null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== null) {
      this.cancelFrame(this.frame);
      this.frame = null;
    }
  }
}

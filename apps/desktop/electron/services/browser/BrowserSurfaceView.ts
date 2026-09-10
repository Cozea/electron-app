import { type BrowserWindow, type Session, WebContentsView } from "electron";

import type { BrowserSurfaceDescriptor } from "../../../../../shared/browserSurfaceTypes";
import {
  browserSurfaceWebPreferences,
  type BrowserSurfacePreloadPosture,
} from "./BrowserSurfaceWebPreferences";

/**
 * One main-owned native browser surface.
 *
 * Identity is `runtimeTabId`, never the DOM (INV-002): a tile unmounting,
 * moving between Dockview groups, or toggling visibility must not produce a
 * second Chromium browser. Lifetime and visibility are therefore separate --
 * hiding sets the view invisible, only disposal destroys it (INV-004).
 */

/** Native pixel rectangle, already converted from CSS by the caller. */
export interface BrowserSurfaceBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserSurfaceViewOptions {
  readonly runtimeTabId: string;
  readonly descriptor: BrowserSurfaceDescriptor;
  readonly session: Session;
  readonly window: BrowserWindow;
  readonly preloadPath?: string | null;
  readonly posture?: BrowserSurfacePreloadPosture;
}

/**
 * Initial rectangle. On-screen and non-zero rather than empty, because a view
 * that first lays out at 0x0 can leave the compositor without a valid surface
 * on some platforms and then paint nothing once it is finally sized. The view
 * stays invisible until the renderer supplies real bounds, so this is never
 * seen.
 */
const INITIAL_BOUNDS: BrowserSurfaceBounds = { x: 0, y: 0, width: 1024, height: 768 };

function sameBounds(a: BrowserSurfaceBounds | null, b: BrowserSurfaceBounds): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export class BrowserSurfaceView {
  readonly runtimeTabId: string;
  readonly descriptor: BrowserSurfaceDescriptor;
  readonly view: WebContentsView;

  private currentWindow: BrowserWindow;
  private wantsVisibility = false;
  private hasBeenLaidOut = false;
  private occluded = false;
  private disposed = false;
  private lastBounds: BrowserSurfaceBounds | null = null;

  constructor(options: BrowserSurfaceViewOptions) {
    this.runtimeTabId = options.runtimeTabId;
    this.descriptor = options.descriptor;
    this.currentWindow = options.window;

    this.view = new WebContentsView({
      webPreferences: {
        ...browserSurfaceWebPreferences({
          ...(options.posture ? { posture: options.posture } : {}),
          ...(options.preloadPath ? { preloadPath: options.preloadPath } : {}),
        }),
        session: options.session,
      },
    });

    this.view.setBounds({ ...INITIAL_BOUNDS });
    this.view.setVisible(false);
    this.currentWindow.contentView.addChildView(this.view);
  }

  /** The exact contents T3 automates, so the agent drives what the user sees. */
  get webContentsId(): number {
    return this.view.webContents.id;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Whether the native view is currently drawn. */
  get isVisible(): boolean {
    return !this.disposed && this.view.getVisible();
  }

  /** True once the renderer has published a real rectangle at least once. */
  get isLaidOut(): boolean {
    return this.hasBeenLaidOut;
  }

  getBounds(): BrowserSurfaceBounds | null {
    return this.lastBounds;
  }

  /**
   * Apply a rectangle measured by the renderer.
   *
   * Unchanged rectangles are dropped here as well as renderer-side, since a
   * repeated `setBounds` still crosses into the compositor.
   */
  layout(bounds: BrowserSurfaceBounds, borderRadius = 0): void {
    if (this.disposed) return;
    if (sameBounds(this.lastBounds, bounds)) return;

    this.lastBounds = { ...bounds };
    this.view.setBorderRadius(borderRadius);
    this.view.setBounds({ ...bounds });
    this.hasBeenLaidOut = true;
    this.reconcileVisibility();
  }

  /** Record intent. Whether the view actually draws is reconciled. */
  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.wantsVisibility = visible;
    this.reconcileVisibility();
  }

  /**
   * Mark the surface covered by an application overlay.
   *
   * A native view cannot be layered beneath DOM with z-index (INV-009), so an
   * overlapping overlay hides it outright rather than drawing over it.
   */
  setOccluded(occluded: boolean): void {
    if (this.disposed) return;
    this.occluded = occluded;
    this.reconcileVisibility();
  }

  /**
   * Raise above sibling native views. Dockview's floating order is visual
   * order, and for native children only re-adding establishes it (INV-011).
   */
  bringToFront(): void {
    if (this.disposed) return;
    this.currentWindow.contentView.addChildView(this.view);
  }

  /** Move to another window, for a tile torn out into a floating window. */
  moveToWindow(window: BrowserWindow): void {
    if (this.disposed || window === this.currentWindow) return;
    this.currentWindow.contentView.removeChildView(this.view);
    this.currentWindow = window;
    window.contentView.addChildView(this.view);
    this.reconcileVisibility();
  }

  focus(): void {
    if (this.disposed || this.view.webContents.isDestroyed()) return;
    this.view.webContents.focus();
  }

  async loadUrl(url: string): Promise<void> {
    if (this.disposed) return;
    await this.view.webContents.loadURL(url);
  }

  /**
   * Visibility is derived, never assigned directly: a surface draws only when
   * it is wanted, has real bounds, and nothing is covering it. Laying out
   * before the first real rectangle is what would flash the initial 1024x768.
   */
  private reconcileVisibility(): void {
    const shouldDraw = this.wantsVisibility && this.hasBeenLaidOut && !this.occluded;
    if (this.view.getVisible() !== shouldDraw) this.view.setVisible(shouldDraw);
  }

  /**
   * Destroy the surface. Idempotent, because crash recovery and explicit
   * release can both reach it.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.view.setVisible(false);
    if (!this.currentWindow.isDestroyed()) {
      this.currentWindow.contentView.removeChildView(this.view);
    }
    // Electron 41 destroys a WebContentsView's contents through the contents
    // themselves; the old BrowserView removal-destroys-it behavior does not
    // apply here, so an un-closed view would leak a live renderer process.
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close();
    }
  }
}

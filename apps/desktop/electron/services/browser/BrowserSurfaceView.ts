import { type BrowserWindow, type Session, WebContentsView } from "electron";

import type {
  BrowserSurfaceDescriptor,
  BrowserSurfacePlaceholder,
} from "../../../../../shared/browserSurfaceTypes";
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
  /** Keyboard focus entered (true) or left (false) this surface's contents. */
  readonly onFocusChange?: (focused: boolean) => void;
}

/**
 * JPEG, because a placeholder is looked at for the length of a menu or dialog,
 * not inspected: a lossless capture of a large page costs several times the
 * bytes over IPC for no visible difference.
 */
const PLACEHOLDER_JPEG_QUALITY = 80;

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
  private lastBorderRadius: number | null = null;

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

    // Chromium moves keyboard focus between sibling views by itself when the
    // user clicks one, and no DOM event tells the renderer. These do.
    const onFocusChange = options.onFocusChange;
    if (onFocusChange) {
      this.view.webContents.on("focus", () => onFocusChange(true));
      this.view.webContents.on("blur", () => onFocusChange(false));
    }
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
   * Apply native presentation state measured by the renderer.
   *
   * Bounds and radius are deduplicated independently. A floating/docked chrome
   * transition can change corner radius without moving the rectangle, and that
   * update must still reach the native view.
   */
  layout(bounds: BrowserSurfaceBounds, borderRadius = 0): void {
    if (this.disposed) return;
    const boundsChanged = !sameBounds(this.lastBounds, bounds);
    const radiusChanged = this.lastBorderRadius !== borderRadius;
    if (!boundsChanged && !radiusChanged) return;

    if (radiusChanged) {
      this.lastBorderRadius = borderRadius;
      this.view.setBorderRadius(borderRadius);
    }
    if (boundsChanged) {
      this.lastBounds = { ...bounds };
      this.view.setBounds({ ...bounds });
    }
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
   * A still of what the surface is showing, for the DOM placeholder that stands
   * in while application UI covers it.
   *
   * The capture is requested synchronously, before this returns, so a caller
   * that hides the view immediately afterwards still captures the frame the
   * user was looking at. Null when the surface is not on screen, because a
   * capture of a view that was never drawn is not a picture of anything.
   */
  capturePlaceholder(): Promise<BrowserSurfacePlaceholder | null> {
    if (this.disposed || this.view.webContents.isDestroyed() || !this.view.getVisible()) {
      return Promise.resolve(null);
    }
    return this.view.webContents.capturePage().then(
      (image) =>
        image.isEmpty()
          ? null
          : {
              dataUrl: `data:image/jpeg;base64,${image.toJPEG(PLACEHOLDER_JPEG_QUALITY).toString("base64")}`,
              capturedAt: Date.now(),
            },
      // Torn down mid-capture: there is no still to offer, and the slot's
      // neutral placeholder is the honest fallback.
      () => null,
    );
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
    if (this.view.getVisible() === shouldDraw) return;
    if (!shouldDraw) this.releaseFocusToWindow();
    this.view.setVisible(shouldDraw);
  }

  /**
   * Hand keyboard focus back to the workbench before leaving the screen.
   *
   * Hidden contents keep focus otherwise, so keystrokes would go on landing in
   * a page the user can no longer see -- including underneath a modal that
   * should own them. Focus moves first and the view hides second, so there is
   * no interval in which nothing visible has focus.
   */
  private releaseFocusToWindow(): void {
    const contents = this.view.webContents;
    if (contents.isDestroyed() || !contents.isFocused()) return;
    if (!this.currentWindow.isDestroyed()) this.currentWindow.webContents.focus();
  }

  /**
   * Destroy the surface. Idempotent, because crash recovery and explicit
   * release can both reach it.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.releaseFocusToWindow();
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

/**
 * The native layout contract between the renderer and Electron main.
 *
 * The renderer measures a DOM placeholder and publishes the rectangle the
 * native view should occupy. It deliberately carries no renderer-only state:
 * scroll offsets, React keys and store revisions are not part of where a
 * browser sits on screen, and including them would make every unrelated
 * renderer change look like a layout change.
 */

/** Where a native browser surface sits, in CSS pixels within its window. */
export interface BrowserSurfaceBounds {
  /** Which window the surface belongs to, so a torn-out tile reparents. */
  readonly windowId: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * Window zoom the renderer believes is applied, for diagnostics only.
   *
   * Main does not scale by this. An isolated renderer cannot read Electron's
   * zoom factor, and geometry supplied by the renderer should not decide where
   * a native view lands regardless; main reads `webContents.getZoomFactor()`
   * on the window it owns.
   */
  readonly hostZoomFactor?: number;
  readonly cornerRadius: number;
  /** Front-to-back position among overlapping surfaces; higher is nearer. */
  readonly nativeOrder: number;
  /** Device-emulation scale, when the surface renders a scaled viewport. */
  readonly emulation?: { readonly scale: number };
}

/**
 * Whether two rectangles are the same to main.
 *
 * Used before IPC, so an unchanged rectangle never leaves the renderer: a
 * resize drag produces a frame's worth of measurements whose values are
 * frequently identical, and each send would otherwise cross a process boundary
 * and touch the compositor.
 */
export function sameBrowserSurfaceBounds(
  a: BrowserSurfaceBounds | null,
  b: BrowserSurfaceBounds | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.windowId === b.windowId &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    (a.hostZoomFactor ?? 1) === (b.hostZoomFactor ?? 1) &&
    a.cornerRadius === b.cornerRadius &&
    a.nativeOrder === b.nativeOrder &&
    (a.emulation?.scale ?? null) === (b.emulation?.scale ?? null)
  );
}

/**
 * Convert a measured CSS rectangle into the integer rectangle main applies.
 *
 * Edges are rounded and the size derived from them. Rounding position and size
 * independently puts the right edge at `round(x) + round(width)`, which is not
 * `round(x + width)`, so a tile at a fractional offset -- the normal case once
 * panel splits divide unevenly -- leaves a one-pixel seam against its
 * neighbour.
 */
export function toNativeRect(rect: {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}): { x: number; y: number; width: number; height: number } {
  const x = Math.round(rect.left);
  const y = Math.round(rect.top);
  return {
    x,
    y,
    // A zero-height view can be left without a compositor surface, so clamp.
    width: Math.max(1, Math.round(rect.right) - x),
    height: Math.max(1, Math.round(rect.bottom) - y),
  };
}

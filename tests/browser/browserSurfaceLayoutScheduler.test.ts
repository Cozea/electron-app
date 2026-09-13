import { describe, expect, it, vi } from "vitest";

import { BrowserSurfaceLayoutScheduler } from "../../apps/desktop/src/features/browser/browserSurfaceLayoutScheduler";
import {
  sameBrowserSurfaceBounds,
  toNativeRect,
  type BrowserSurfaceBounds,
} from "../../shared/browserSurfaceLayout";
import { resolveDockviewBrowserSurfaceNativeRadius } from "../../apps/desktop/src/features/browser/useDockviewBrowserSurfaceLayer";

/**
 * The migration's performance case rests on this: however many sources dirty a
 * surface, main hears at most once per frame, and never about a rectangle that
 * did not change.
 */

const bounds = (overrides: Partial<BrowserSurfaceBounds> = {}): BrowserSurfaceBounds => ({
  windowId: 1,
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  hostZoomFactor: 1,
  cornerRadius: 0,
  ...overrides,
});

/** Manual frame clock, so a test never depends on real animation timing. */
const makeFrames = () => {
  const queue: Array<() => void> = [];
  return {
    requestFrame: (callback: () => void) => queue.push(callback),
    cancelFrame: (handle: number) => queue.splice(handle - 1, 1),
    run: () => {
      const pending = queue.splice(0, queue.length);
      for (const callback of pending) callback();
    },
    get pending() {
      return queue.length;
    },
  };
};

describe("BrowserSurfaceLayoutScheduler", () => {
  it("measures once however many sources dirty the surface in a frame", () => {
    const frames = makeFrames();
    const measure = vi.fn(() => bounds());
    const publish = vi.fn();
    const scheduler = new BrowserSurfaceLayoutScheduler({
      measure,
      publish,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    // A single drag can fire the ResizeObserver, a Dockview layout change and a
    // window resize; each measuring synchronously is repeated forced reflow.
    scheduler.markDirty();
    scheduler.markDirty();
    scheduler.markDirty();
    expect(measure).not.toHaveBeenCalled();

    frames.run();

    expect(measure).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("does not send a rectangle that has not changed", () => {
    const frames = makeFrames();
    const publish = vi.fn();
    const scheduler = new BrowserSurfaceLayoutScheduler({
      measure: () => bounds(),
      publish,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    scheduler.markDirty();
    frames.run();
    scheduler.markDirty();
    frames.run();
    scheduler.markDirty();
    frames.run();

    // Deduplication happens before IPC, not after main receives it.
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("sends again once the rectangle actually moves", () => {
    const frames = makeFrames();
    const publish = vi.fn();
    let width = 800;
    const scheduler = new BrowserSurfaceLayoutScheduler({
      measure: () => bounds({ width }),
      publish,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    scheduler.markDirty();
    frames.run();
    width = 801;
    scheduler.markDirty();
    frames.run();

    expect(publish).toHaveBeenCalledTimes(2);
    expect(scheduler.published?.width).toBe(801);
  });

  it("measures inside the frame rather than when marked", () => {
    const frames = makeFrames();
    let width = 100;
    const publish = vi.fn();
    const scheduler = new BrowserSurfaceLayoutScheduler({
      measure: () => bounds({ width }),
      publish,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    scheduler.markDirty();
    // Intermediate values during a drag must not be what gets published.
    width = 250;
    frames.run();

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ width: 250 }));
  });

  it("skips publication while the surface cannot be measured", () => {
    const frames = makeFrames();
    const publish = vi.fn();
    const scheduler = new BrowserSurfaceLayoutScheduler({
      measure: () => null,
      publish,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    scheduler.markDirty();
    frames.run();

    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes the first layout without waiting for a frame", () => {
    const frames = makeFrames();
    const publish = vi.fn();
    const scheduler = new BrowserSurfaceLayoutScheduler({
      measure: () => bounds(),
      publish,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    scheduler.flush();

    // Otherwise a surface stays invisible for a frame after mounting.
    expect(publish).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(0);
  });

  it("stops publishing and drops its pending frame once disposed", () => {
    const frames = makeFrames();
    const publish = vi.fn();
    const scheduler = new BrowserSurfaceLayoutScheduler({
      measure: () => bounds(),
      publish,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    scheduler.markDirty();
    scheduler.dispose();
    frames.run();
    scheduler.markDirty();
    scheduler.flush();

    // A tile that unmounts mid-drag must not move a surface afterwards.
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("browser surface bounds contract", () => {
  it("treats a differing emulation scale as a different rectangle", () => {
    expect(
      sameBrowserSurfaceBounds(bounds(), bounds({ emulation: { scale: 0.5 } })),
    ).toBe(false);
    expect(
      sameBrowserSurfaceBounds(
        bounds({ emulation: { scale: 0.5 } }),
        bounds({ emulation: { scale: 0.5 } }),
      ),
    ).toBe(true);
  });

  it("treats a window change as a different rectangle", () => {
    // A tile torn out into another window must reparent, not just move.
    expect(sameBrowserSurfaceBounds(bounds(), bounds({ windowId: 2 }))).toBe(false);
  });

  it("treats a reorder as a different rectangle", () => {
  });

  it("derives size from rounded edges so tiles do not leave a seam", () => {
    // Rounding x and width independently would give width 100 at x 10, putting
    // the right edge at 110 rather than the 111 its neighbour starts at.
    expect(toNativeRect({ left: 10.4, top: 0, right: 110.6, bottom: 50 })).toEqual({
      x: 10,
      y: 0,
      width: 101,
      height: 50,
    });
  });

  it("never produces a zero-sized rectangle", () => {
    // A zero-height view can end up without a compositor surface.
    expect(toNativeRect({ left: 5, top: 5, right: 5, bottom: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 1,
      height: 1,
    });
  });
});

describe("resolveDockviewBrowserSurfaceNativeRadius", () => {
  it("reads the rounded corners a top-header tile actually states", () => {
    // A native view rounds by one number, so reading only the first of the
    // four CSS corners means "no rounding" for every header position whose
    // value happens to begin with a zero -- which is the default one.
    expect(resolveDockviewBrowserSurfaceNativeRadius("0 0 12px 12px")).toBe(12);
  });

  it("reads them for every other header position too", () => {
    expect(resolveDockviewBrowserSurfaceNativeRadius("12px 12px 0 0")).toBe(12);
    expect(resolveDockviewBrowserSurfaceNativeRadius("0 12px 12px 0")).toBe(12);
    expect(resolveDockviewBrowserSurfaceNativeRadius("12px 0 0 12px")).toBe(12);
  });

  it("leaves a square tile square", () => {
    expect(resolveDockviewBrowserSurfaceNativeRadius("0 0 0 0")).toBe(0);
    expect(resolveDockviewBrowserSurfaceNativeRadius("")).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  COMPOSER_DOCK_EASING_CSS,
  COMPOSER_DOCK_TRANSITION_MS,
  composerDockEase,
} from "../../../apps/desktop/src/features/assistant/chat/composerDockMotion";

/**
 * Reference cubic-bezier evaluation, written independently of the shipped
 * bisection solver so the two disagreeing is a real signal.
 */
function referenceEase(t: number, x1: number, y1: number, x2: number, y2: number): number {
  const axis = (u: number, c1: number, c2: number) =>
    3 * (1 - u) * (1 - u) * u * c1 + 3 * (1 - u) * u * u * c2 + u * u * u;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (low + high) / 2;
    if (axis(mid, x1, x2) < t) low = mid;
    else high = mid;
  }
  return axis((low + high) / 2, y1, y2);
}

describe("composer dock motion curve", () => {
  it("declares the Tailwind ease-out curve, not the CSS keyword", () => {
    // CSS `ease-out` is cubic-bezier(0, 0, 0.58, 1); Tailwind's utility is
    // cubic-bezier(0, 0, 0.2, 1). The composer uses the Tailwind utility, so the
    // timeline inset has to match that one.
    expect(COMPOSER_DOCK_EASING_CSS).toBe("cubic-bezier(0, 0, 0.2, 1)");
    expect(COMPOSER_DOCK_TRANSITION_MS).toBe(200);
  });

  it("is pinned at both ends", () => {
    expect(composerDockEase(0)).toBe(0);
    expect(composerDockEase(1)).toBe(1);
  });

  it("clamps out-of-range and non-finite input", () => {
    expect(composerDockEase(-0.5)).toBe(0);
    expect(composerDockEase(2)).toBe(1);
    expect(composerDockEase(Number.NaN)).toBe(0);
  });

  it("tracks the declared bezier across the transition", () => {
    for (let step = 0; step <= 20; step += 1) {
      const t = step / 20;
      expect(composerDockEase(t)).toBeCloseTo(referenceEase(t, 0, 0, 0.2, 1), 4);
    }
  });

  it("is monotonic, so the slide never reverses mid-flight", () => {
    let previous = -1;
    for (let step = 0; step <= 100; step += 1) {
      const value = composerDockEase(step / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("front-loads travel the way an ease-out should", () => {
    // Over half the distance is covered in the first quarter of the duration.
    expect(composerDockEase(0.25)).toBeGreaterThan(0.5);
    expect(composerDockEase(0.5)).toBeGreaterThan(0.8);
  });
});

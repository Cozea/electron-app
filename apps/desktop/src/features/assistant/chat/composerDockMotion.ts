/**
 * One curve for the docked composer's hover reveal.
 *
 * The composer expands and the timeline slides up by the same distance, so they
 * have to travel on the same duration AND the same easing. Keeping the CSS
 * timing function and the JS scroll interpolation in one module is what stops
 * them drifting apart: the CSS keyword `ease-out` is cubic-bezier(0, 0, .58, 1)
 * while Tailwind's `ease-out` utility is cubic-bezier(0, 0, .2, 1), and mixing
 * the two is invisible in review but very visible on screen.
 */

export const COMPOSER_DOCK_TRANSITION_MS = 200;

const CONTROL_X1 = 0;
const CONTROL_Y1 = 0;
const CONTROL_X2 = 0.2;
const CONTROL_Y2 = 1;

export const COMPOSER_DOCK_EASING_CSS = `cubic-bezier(${CONTROL_X1}, ${CONTROL_Y1}, ${CONTROL_X2}, ${CONTROL_Y2})`;

function bezierAxis(u: number, control1: number, control2: number): number {
  const inverse = 1 - u;
  return 3 * inverse * inverse * u * control1 + 3 * inverse * u * u * control2 + u * u * u;
}

/**
 * Evaluate the shared timing function at normalised time `t`.
 *
 * Bisection rather than Newton: the curve is only solved a handful of times per
 * frame and a fixed iteration count keeps the result deterministic across
 * platforms, which matters because the value is compared against a CSS
 * transition running on the same frame.
 */
export function composerDockEase(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (t >= 1) return 1;

  let low = 0;
  let high = 1;
  let u = t;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const x = bezierAxis(u, CONTROL_X1, CONTROL_X2);
    if (Math.abs(x - t) < 1e-5) break;
    if (x < t) {
      low = u;
    } else {
      high = u;
    }
    u = (low + high) / 2;
  }

  return bezierAxis(u, CONTROL_Y1, CONTROL_Y2);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

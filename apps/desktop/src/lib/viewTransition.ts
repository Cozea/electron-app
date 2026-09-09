import { flushSync } from "react-dom"

/**
 * Run a state update as a View Transition.
 *
 * The browser snapshots the old and new DOM and cross-fades between them,
 * morphing any element that carries the same `view-transition-name` across both.
 * That is what makes it the right tool for switches where the markup is
 * *replaced* rather than moved -- list to grid, or one category's apps to
 * another's -- which layout projection cannot relate, because the old and new
 * elements are different components.
 *
 * `flushSync` is required, not incidental: the callback has to leave the DOM in
 * its final state before it returns, and React would otherwise batch the update
 * until after the snapshot had been taken.
 *
 * Falls back to a plain synchronous update when the API is unavailable or the
 * viewer asked for reduced motion, so callers never branch.
 */

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function startViewTransition(update: () => void): void {
  if (
    typeof document === "undefined"
    || typeof document.startViewTransition !== "function"
    || prefersReducedMotion()
  ) {
    update()
    return
  }

  // Starting a transition while one is running skips the one in flight. That is
  // the wanted behaviour here -- a second switch should supersede the first
  // rather than queue behind it.
  document.startViewTransition(() => {
    flushSync(update)
  })
}

/**
 * A per-item transition name, so the same app morphs between its list row and
 * its grid cell instead of cross-fading as two unrelated boxes.
 *
 * Names must be unique within a document or the browser aborts the transition
 * outright, so this is only safe while one surface renders a given app once.
 */
export function devAppViewTransitionName(appId: string): string {
  return `devapp-${appId.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}

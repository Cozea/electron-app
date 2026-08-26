/**
 * BackgroundPolicy-lite (Track D): pause expensive refresh while the window is
 * hidden or a surface (tile/panel) is not active. Full server BackgroundPolicy
 * lands later with the substrate rebase — this is the renderer-side demand gate.
 */

export type DocumentVisibility = "visible" | "hidden" | "prerender"

export interface BackgroundPolicyOptions {
  /** When false, the surface (tile/panel) is not visible — skip refresh. */
  surfaceActive?: boolean
  /** Pause when the document is hidden. Default true. */
  pauseWhenDocumentHidden?: boolean
}

export function isBackgroundRefreshAllowed(
  options: BackgroundPolicyOptions = {},
  visibilityState: DocumentVisibility = "visible",
): boolean {
  if (options.surfaceActive === false) {
    return false
  }

  const pauseWhenHidden = options.pauseWhenDocumentHidden !== false
  if (pauseWhenHidden && visibilityState === "hidden") {
    return false
  }

  return true
}

export function readDocumentVisibility(): DocumentVisibility {
  if (typeof document === "undefined") {
    return "visible"
  }
  return document.visibilityState === "hidden" ? "hidden" : "visible"
}

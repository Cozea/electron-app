/**
 * Native presentation overrides for the unified modal system.
 *
 * Modal kinds listed here support rendering as a native OS dialog
 * (`window.electronAPI.dialog.showMessageBox`) instead of the React
 * modal. Flip a kind to `"native"` to switch every call site at once —
 * no per-call-site changes needed.
 *
 * Only kinds in `NativeCapableModalKind` may go native. Rich modals
 * (forms, lists, wide content, status) are React-only by design.
 */
export type NativeCapableModalKind = "confirm" | "destructive-confirm";

export type ModalPresentation = "react" | "native";

export const MODAL_PRESENTATION: Record<NativeCapableModalKind, ModalPresentation> = {
  confirm: "react",
  "destructive-confirm": "react",
};

/**
 * True when `kind` is flipped to native AND a native dialog bridge is
 * available (Electron renderer). Falls back to React everywhere else,
 * including tests and non-Electron surfaces.
 */
export function isNativeModalPresentation(kind: NativeCapableModalKind): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.electronAPI?.dialog?.showMessageBox !== "function") return false;
  return MODAL_PRESENTATION[kind] === "native";
}

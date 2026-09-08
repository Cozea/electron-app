export type DesktopInteractionKind =
  | "native-window-resize"
  | "native-window-move"
  | "sidebar-resize"
  | "dockview-sash"
  | "dockview-floating"
  | "changes-sidebar-resize"
  | "browser-viewport-resize"

export type NativeDesktopInteractionKind =
  | "native-window-resize"
  | "native-window-move"

export interface NativeDesktopInteractionChange {
  kind: NativeDesktopInteractionKind
  active: boolean
}

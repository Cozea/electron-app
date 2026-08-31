/**
 * Global presentation layers shared by the renderer-wide browser host,
 * Dockview, and body-portaled application UI.
 *
 * Component-local stacking should remain relative to its own layer. Add a
 * value here only when two independent renderer roots must be ordered.
 */
export const APP_LAYERS = {
  browserDocked: 30,
  dockviewFloatBase: 1_000,
  dockviewDropTarget: 8_000,
  dialog: 9_000,
  menu: 9_100,
  tooltip: 9_200,
  toast: 9_300,
} as const;

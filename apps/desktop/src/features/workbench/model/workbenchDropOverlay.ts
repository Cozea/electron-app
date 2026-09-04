type WorkbenchDropOverlayKind = "tab" | "header_space" | "content" | "edge";
type WorkbenchDropPosition = "top" | "bottom" | "left" | "right" | "center";

interface WorkbenchPanelDragData {
  viewId: string;
  groupId: string;
  panelId: string | null;
  tabGroupId?: string;
}

interface WorkbenchDropOverlayTarget {
  dragData: WorkbenchPanelDragData | undefined;
  targetViewId: string;
  targetGroupId: string | undefined;
  targetPanelCount: number;
  kind: WorkbenchDropOverlayKind;
  position: WorkbenchDropPosition;
}

/**
 * Dockview offers every in-instance content target before its drop handler decides
 * whether moving there would do anything. Keep the preview aligned with the drop:
 * suppress only self-targets Dockview later rejects, while retaining meaningful
 * same-group edge splits for tabs from multi-panel groups.
 */
export function shouldSuppressNoOpSelfDropOverlay({
  dragData,
  targetViewId,
  targetGroupId,
  targetPanelCount,
  kind,
  position,
}: WorkbenchDropOverlayTarget): boolean {
  if (
    kind !== "content" ||
    !dragData ||
    dragData.viewId !== targetViewId ||
    dragData.groupId !== targetGroupId
  ) {
    return false;
  }

  if (position === "center") {
    return true;
  }

  const isEntireGroupDrag = dragData.panelId === null && !dragData.tabGroupId;
  if (isEntireGroupDrag) {
    return true;
  }

  return dragData.panelId !== null && targetPanelCount <= 1;
}

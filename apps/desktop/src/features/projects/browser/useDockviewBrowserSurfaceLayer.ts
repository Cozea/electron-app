import type { DockviewApi, DockviewPanelApi } from "dockview-react";
import { useLayoutEffect, useState } from "react";

import { APP_LAYERS } from "@/lib/appLayers";

export function resolveDockviewBrowserSurfaceLayer(
  locationType: DockviewPanelApi["location"]["type"],
  ariaLevel: string | null,
): number {
  if (locationType !== "floating") return APP_LAYERS.browserDocked;
  const parsedLevel = Number.parseInt(ariaLevel ?? "", 10);
  const floatingLevel = Number.isFinite(parsedLevel) ? Math.max(0, parsedLevel) : 0;
  return APP_LAYERS.dockviewFloatBase + floatingLevel * 2;
}

function readPanelLayer(panelApi: DockviewPanelApi): number {
  if (panelApi.location.type !== "floating") return APP_LAYERS.browserDocked;

  let ancestor: HTMLElement | null = panelApi.group.element;
  while (ancestor && !ancestor.hasAttribute("aria-level")) {
    ancestor = ancestor.parentElement;
  }

  return resolveDockviewBrowserSurfaceLayer(
    panelApi.location.type,
    ancestor?.getAttribute("aria-level") ?? null,
  );
}

/**
 * Mirrors Dockview's public floating-window order into the renderer-wide
 * browser host. Dockview publishes the order as `aria-level`; its own z-index
 * ladder advances by two for each level, leaving the intervening layer free
 * for content hosted outside the Dockview DOM tree.
 */
export function useDockviewBrowserSurfaceLayer(
  panelApi: DockviewPanelApi,
  containerApi: DockviewApi,
): number {
  const [layer, setLayer] = useState(() => readPanelLayer(panelApi));

  useLayoutEffect(() => {
    const update = () => setLayer(readPanelLayer(panelApi));
    const subscriptions = [
      panelApi.onDidGroupChange(update),
      panelApi.onDidLocationChange(update),
      containerApi.onDidActiveGroupChange(update),
      containerApi.onDidAddGroup(update),
      containerApi.onDidRemoveGroup(update),
      containerApi.onDidLayoutChange(update),
    ];
    update();
    return () => subscriptions.forEach((subscription) => subscription.dispose());
  }, [containerApi, panelApi]);

  return layer;
}

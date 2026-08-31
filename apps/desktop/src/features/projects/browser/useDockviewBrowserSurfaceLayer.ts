import type { DockviewApi, DockviewPanelApi } from "dockview-react";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";

import { APP_LAYERS } from "@/lib/appLayers";

const DOCKVIEW_TILE_RADIUS = "12px";

interface DockviewBrowserSurfaceVisualPresentation {
  readonly borderRadius: string;
  readonly stackingLayer: number;
}

export interface DockviewBrowserSurfacePresentation extends DockviewBrowserSurfaceVisualPresentation {
  readonly subscribePositionChanges: (listener: () => void) => () => void;
}

export function resolveDockviewBrowserSurfaceLayer(
  locationType: DockviewPanelApi["location"]["type"],
  ariaLevel: string | null,
): number {
  if (locationType !== "floating") return APP_LAYERS.browserDocked;
  const parsedLevel = Number.parseInt(ariaLevel ?? "", 10);
  const floatingLevel = Number.isFinite(parsedLevel) ? Math.max(0, parsedLevel) : 0;
  return APP_LAYERS.dockviewFloatBase + floatingLevel * 2;
}

export function resolveDockviewBrowserSurfaceBorderRadius(
  headerPosition: ReturnType<DockviewPanelApi["group"]["api"]["getHeaderPosition"]>,
): string {
  switch (headerPosition) {
    case "bottom":
      return `${DOCKVIEW_TILE_RADIUS} ${DOCKVIEW_TILE_RADIUS} 0 0`;
    case "left":
      return `0 ${DOCKVIEW_TILE_RADIUS} ${DOCKVIEW_TILE_RADIUS} 0`;
    case "right":
      return `${DOCKVIEW_TILE_RADIUS} 0 0 ${DOCKVIEW_TILE_RADIUS}`;
    case "top":
    default:
      return `0 0 ${DOCKVIEW_TILE_RADIUS} ${DOCKVIEW_TILE_RADIUS}`;
  }
}

function readPanelPresentation(
  panelApi: DockviewPanelApi,
): DockviewBrowserSurfaceVisualPresentation {
  const borderRadius = resolveDockviewBrowserSurfaceBorderRadius(
    panelApi.group.api.getHeaderPosition(),
  );
  if (panelApi.location.type !== "floating") {
    return { borderRadius, stackingLayer: APP_LAYERS.browserDocked };
  }

  let ancestor: HTMLElement | null = panelApi.group.element;
  while (ancestor && !ancestor.hasAttribute("aria-level")) {
    ancestor = ancestor.parentElement;
  }

  return {
    borderRadius,
    stackingLayer: resolveDockviewBrowserSurfaceLayer(
      panelApi.location.type,
      ancestor?.getAttribute("aria-level") ?? null,
    ),
  };
}

/**
 * Mirrors Dockview's public floating-window order into the renderer-wide
 * browser host. Dockview publishes the order as `aria-level`; its own z-index
 * ladder advances by two for each level, leaving the intervening layer free
 * for content hosted outside the Dockview DOM tree.
 */
export function useDockviewBrowserSurfacePresentation(
  panelApi: DockviewPanelApi,
  containerApi: DockviewApi,
): DockviewBrowserSurfacePresentation {
  const [presentation, setPresentation] = useState(() => readPanelPresentation(panelApi));
  const subscribePositionChanges = useCallback(
    (listener: () => void) => {
      const subscriptions = [
        containerApi.onDidFloatingGroupBoundsChange((event) => {
          if (event.element.contains(panelApi.group.element)) listener();
        }),
        containerApi.onDidLayoutChange(listener),
      ];
      return () => subscriptions.forEach((subscription) => subscription.dispose());
    },
    [containerApi, panelApi],
  );

  useLayoutEffect(() => {
    const update = () => {
      const next = readPanelPresentation(panelApi);
      setPresentation((current) =>
        current.borderRadius === next.borderRadius && current.stackingLayer === next.stackingLayer
          ? current
          : next,
      );
    };
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

  return useMemo(
    () => ({ ...presentation, subscribePositionChanges }),
    [presentation, subscribePositionChanges],
  );
}

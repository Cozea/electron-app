import { useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface } from "./browserSurfaceStore";
import { APP_LAYERS } from "@/lib/appLayers";
import { registerGeometryTask } from "@/lib/desktopInteraction/geometryScheduler";

export interface BrowserSurfaceSlotProps {
  readonly tabId: string;
  readonly visible: boolean;
  readonly borderRadius?: string;
  readonly stackingLayer?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
  readonly subscribePositionChanges?: (listener: () => void) => () => void;
}

export function BrowserSurfaceSlot({
  tabId,
  visible,
  borderRadius = "0",
  stackingLayer = APP_LAYERS.browserDocked,
  layoutVersion,
  className,
  fitSourceContent = false,
  subscribePositionChanges,
}: BrowserSurfaceSlotProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const presentationRef = useRef({ visible, borderRadius, stackingLayer });
  const invalidateRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let lease = acquireBrowserSurface(tabId, fitSourceContent);

    const geometryTask = registerGeometryTask({
      name: `browser-surface:${tabId}`,
      read: () => {
        const el = elementRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
          nonZero: rect.width > 0 && rect.height > 0,
        };
      },
      write: (measurement) => {
        const presentation = presentationRef.current;
        const nextRect = {
          x: measurement.x,
          y: measurement.y,
          width: measurement.width,
          height: measurement.height,
        };
        const presented = lease.present(
          nextRect,
          presentation.visible && measurement.nonZero,
          presentation.borderRadius,
          presentation.stackingLayer,
        );
        if (presentation.visible && !presented) {
          lease.release();
          lease = acquireBrowserSurface(tabId, fitSourceContent);
          lease.present(
            nextRect,
            measurement.nonZero,
            presentation.borderRadius,
            presentation.stackingLayer,
          );
        }
      },
    });

    const invalidate = () => geometryTask.invalidate();
    invalidateRef.current = invalidate;
    invalidate();

    const observer = new ResizeObserver(invalidate);
    observer.observe(element);
    window.addEventListener("scroll", invalidate, true);
    const unsubscribePositionChanges = subscribePositionChanges?.(invalidate);

    return () => {
      unsubscribePositionChanges?.();
      observer.disconnect();
      window.removeEventListener("scroll", invalidate, true);
      geometryTask.dispose();
      if (invalidateRef.current === invalidate) invalidateRef.current = null;
      lease.release();
    };
  }, [fitSourceContent, subscribePositionChanges, tabId]);

  useLayoutEffect(() => {
    presentationRef.current = { visible, borderRadius, stackingLayer };
    invalidateRef.current?.();
  }, [borderRadius, layoutVersion, stackingLayer, visible]);

  return <div ref={elementRef} className={className} data-browser-surface-slot={tabId} />;
}

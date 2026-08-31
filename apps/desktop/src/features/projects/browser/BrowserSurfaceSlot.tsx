import { useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface } from "./browserSurfaceStore";
import { APP_LAYERS } from "@/lib/appLayers";

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
  const updateRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let lease = acquireBrowserSurface(tabId, fitSourceContent);
    const update = () => {
      const rect = element.getBoundingClientRect();
      const presentation = presentationRef.current;
      const nextRect = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      };
      const presented = lease.present(
        nextRect,
        presentation.visible && rect.width > 0 && rect.height > 0,
        presentation.borderRadius,
        presentation.stackingLayer,
      );
      if (presentation.visible && !presented) {
        lease.release();
        lease = acquireBrowserSurface(tabId, fitSourceContent);
        lease.present(
          nextRect,
          rect.width > 0 && rect.height > 0,
          presentation.borderRadius,
          presentation.stackingLayer,
        );
      }
    };
    let frameId: number | null = null;
    const scheduleUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        update();
      });
    };
    updateRef.current = update;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const unsubscribePositionChanges = subscribePositionChanges?.(scheduleUpdate);
    return () => {
      unsubscribePositionChanges?.();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      if (updateRef.current === update) updateRef.current = null;
      lease.release();
    };
  }, [fitSourceContent, subscribePositionChanges, tabId]);

  useLayoutEffect(() => {
    presentationRef.current = { visible, borderRadius, stackingLayer };
    updateRef.current?.();
  }, [borderRadius, layoutVersion, stackingLayer, visible]);

  return <div ref={elementRef} className={className} data-browser-surface-slot={tabId} />;
}

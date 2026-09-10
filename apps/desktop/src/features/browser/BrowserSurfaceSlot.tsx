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
      // Round the edges and derive the size from them. Rounding x and width
      // independently puts the right edge at `round(x) + round(width)`, which is
      // not `round(x + width)` -- so a tile at a fractional x (the normal case
      // with fractional panel splits) left a systematic one-pixel seam between
      // the guest content and the tile behind it.
      const left = Math.round(rect.left);
      const top = Math.round(rect.top);
      const nextRect = {
        x: left,
        y: top,
        width: Math.max(1, Math.round(rect.right) - left),
        height: Math.max(1, Math.round(rect.bottom) - top),
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
    // Every trigger below fires once per frame while the user drags. The
    // ResizeObserver and the window resize listener both fire for a window
    // resize, so the uncoalesced version did two synchronous layout reads and
    // two store writes per slot per frame; the capture-phase scroll listener
    // fires for every scroll anywhere in the app.
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(element);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    const unsubscribePositionChanges = subscribePositionChanges?.(scheduleUpdate);
    return () => {
      unsubscribePositionChanges?.();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
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

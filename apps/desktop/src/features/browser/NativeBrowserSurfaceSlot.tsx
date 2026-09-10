import { useEffect, useLayoutEffect, useRef } from "react";

import type { BrowserSurfaceBounds } from "@shared/browserSurfaceLayout";
import { toNativeRect } from "@shared/browserSurfaceLayout";
import type { BrowserSurfaceDescriptor } from "@shared/browserSurfaceTypes";

import { BrowserSurfaceLayoutScheduler } from "./browserSurfaceLayoutScheduler";
import { browserSurfaceModels, type BrowserSurfaceModel } from "./browserSurfaceModel";

/**
 * Where a main-owned browser surface sits in the workbench.
 *
 * Renders an ordinary empty `<div>`. The native view is not a child of it and
 * cannot be styled by it -- the div exists purely to be measured, so the
 * surface follows normal layout without the renderer owning any pixels.
 *
 * The measured rectangle deliberately never reaches a store. It changes every
 * frame during a drag, and routing it through shared state would rerender
 * unrelated components at animation frequency just to move a native view.
 */

export interface NativeBrowserSurfaceSlotProps {
  readonly descriptor: BrowserSurfaceDescriptor;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  /** Front-to-back position among overlapping surfaces; higher is nearer. */
  readonly nativeOrder?: number;
  readonly className?: string;
  /** Layout sources outside this element, such as Dockview panel movement. */
  readonly subscribePositionChanges?: (listener: () => void) => () => void;
  readonly onModelReady?: (model: BrowserSurfaceModel) => void;
}

export function NativeBrowserSurfaceSlot({
  descriptor,
  visible,
  cornerRadius = 0,
  nativeOrder = 0,
  className,
  subscribePositionChanges,
  onModelReady,
}: NativeBrowserSurfaceSlotProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const ownerRef = useRef<symbol | null>(null);
  ownerRef.current ??= Symbol("native-browser-surface-slot");
  // Read inside measurement without making them effect dependencies: a corner
  // radius change should move the surface on the next frame, not re-run the
  // whole lifecycle and re-acquire the model.
  const presentationRef = useRef({ cornerRadius, nativeOrder });
  presentationRef.current = { cornerRadius, nativeOrder };

  const modelRef = useRef<BrowserSurfaceModel | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    const owner = ownerRef.current;
    if (!element || !owner) return;

    const model = browserSurfaceModels.acquire(descriptor, owner);
    modelRef.current = model;
    onModelReady?.(model);
    void model.ensure();

    const scheduler = new BrowserSurfaceLayoutScheduler({
      measure: (): BrowserSurfaceBounds | null => {
        const rect = element.getBoundingClientRect();
        // A collapsed slot is not a rectangle worth sending; visibility, not a
        // degenerate size, is how a surface is taken off screen.
        if (rect.width <= 0 || rect.height <= 0) return null;
        const { cornerRadius: radius, nativeOrder: order } = presentationRef.current;
        return {
          windowId: 0,
          ...toNativeRect(rect),
          cornerRadius: radius,
          nativeOrder: order,
        };
      },
      publish: (bounds) => model.layout(bounds),
    });

    const markDirty = () => scheduler.markDirty();
    // Measure synchronously on mount so the surface is placed before its first
    // paint rather than a frame later.
    scheduler.flush();

    const observer = new ResizeObserver(markDirty);
    observer.observe(element);
    window.addEventListener("resize", markDirty);
    const unsubscribePositionChanges = subscribePositionChanges?.(markDirty);

    return () => {
      unsubscribePositionChanges?.();
      observer.disconnect();
      window.removeEventListener("resize", markDirty);
      scheduler.dispose();
      modelRef.current = null;
      browserSurfaceModels.release(descriptor.runtimeTabId, owner);
    };
    // Re-running on identity, not on every descriptor object: a new descriptor
    // for the same surface updates in place rather than recreating the browser.
  }, [descriptor.runtimeTabId, subscribePositionChanges]);

  useEffect(() => {
    modelRef.current?.updateDescriptor(descriptor);
  }, [descriptor]);

  // Visibility is stated separately from layout so a surface on a hidden
  // Dockview tab keeps its bounds and its page while not being drawn.
  useEffect(() => {
    modelRef.current?.setVisible(visible);
  }, [visible]);

  return <div ref={elementRef} className={className} data-native-browser-surface="" />;
}

import { useEffect, useLayoutEffect, useRef } from "react";

import type { BrowserSurfaceBounds } from "@shared/browserSurfaceLayout";
import { toNativeRect } from "@shared/browserSurfaceLayout";
import type { BrowserSurfaceDescriptor } from "@shared/browserSurfaceTypes";

import { BrowserSurfaceLayoutScheduler } from "./browserSurfaceLayoutScheduler";
import { browserSurfaceModels, type BrowserSurfaceModel } from "./browserSurfaceModel";
import { browserSurfaceOcclusion, useBrowserSurfaceOcclusion } from "./browserSurfaceOcclusion";
import { useBrowserSurfaceStateStore } from "./browserSurfaceStateStore";

/**
 * Where a main-owned browser surface sits in the workbench.
 *
 * Renders an ordinary `<div>`. The native view is not a child of it and cannot
 * be styled by it -- the div exists to be measured, so the surface follows
 * normal layout without the renderer owning any of the page's pixels.
 *
 * The one thing it does draw is the placeholder: while application UI covers
 * the surface, the live view is off screen and a still of the page sits here
 * instead, underneath that UI in ordinary CSS order (INV-009).
 *
 * The measured rectangle deliberately never reaches a store. It changes every
 * frame during a drag, and routing it through shared state would rerender
 * unrelated components at animation frequency just to move a native view.
 */

/**
 * How long a page is left to settle after it finishes navigating, or comes
 * back on screen, before its still is refreshed.
 */
const PLACEHOLDER_SETTLE_MS = 400;

export interface NativeBrowserSurfaceSlotProps {
  readonly descriptor: BrowserSurfaceDescriptor;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  readonly className?: string;
  /** Layout sources outside this element, such as Dockview panel movement. */
  readonly subscribePositionChanges?: (listener: () => void) => () => void;
  /**
   * The element whose ancestry says where the surface sits in Dockview. The
   * slot itself cannot say: always-rendered panels draw outside their group.
   */
  readonly resolveLayoutAnchor?: () => HTMLElement | null;
  readonly onModelReady?: (model: BrowserSurfaceModel) => void;
}

export function NativeBrowserSurfaceSlot({
  descriptor,
  visible,
  cornerRadius = 0,
  className,
  subscribePositionChanges,
  resolveLayoutAnchor,
  onModelReady,
}: NativeBrowserSurfaceSlotProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const ownerRef = useRef<symbol | null>(null);
  ownerRef.current ??= Symbol("native-browser-surface-slot");
  // Read inside measurement without making it an effect dependency: a corner
  // radius change should move the surface on the next layout signal, not re-run
  // the whole lifecycle and re-acquire the model.
  const presentationRef = useRef({ cornerRadius, resolveLayoutAnchor });
  presentationRef.current = { cornerRadius, resolveLayoutAnchor };

  const modelRef = useRef<BrowserSurfaceModel | null>(null);
  const occlusion = useBrowserSurfaceOcclusion(descriptor.runtimeTabId);
  const settledUrl = useBrowserSurfaceStateStore((store) => {
    const status = store.byTabId[descriptor.runtimeTabId]?.navStatus;
    return status?.kind === "Success" ? status.url : null;
  });

  useLayoutEffect(() => {
    const element = elementRef.current;
    const owner = ownerRef.current;
    if (!element || !owner) return;

    const model = browserSurfaceModels.acquire(descriptor, owner);
    modelRef.current = model;
    onModelReady?.(model);
    void model.ensure();
    // Registered before the first measurement, so the first rectangle is
    // already checked against whatever covers it.
    const unregisterOcclusion = browserSurfaceOcclusion.register(
      descriptor.runtimeTabId,
      element,
      model,
      { resolveLayoutAnchor: () => presentationRef.current.resolveLayoutAnchor?.() ?? null },
    );

    const scheduler = new BrowserSurfaceLayoutScheduler({
      measure: (): BrowserSurfaceBounds | null => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
          windowId: 0,
          ...toNativeRect(rect),
          cornerRadius: presentationRef.current.cornerRadius,
        };
      },
      publish: (bounds) => {
        model.layout(bounds);
        // The surface moved or resized, so what covers it may have changed.
        browserSurfaceOcclusion.scheduleRecompute();
      },
    });

    // Dockview position signals can arrive several times for one logical move,
    // so retain frame coalescing there. ResizeObserver and window resize fire
    // after layout has already changed; deferring them through another rAF put
    // the native view an avoidable frame behind the DOM edge during continuous
    // resize (D3), so those authoritative size signals flush immediately.
    const markPositionDirty = () => scheduler.markDirty();
    const flushSize = () => scheduler.flush();

    // Measure synchronously on mount so the surface is placed before its first
    // paint rather than a frame later.
    scheduler.flush();

    const observer = new ResizeObserver(flushSize);
    observer.observe(element);
    window.addEventListener("resize", flushSize);
    const unsubscribePositionChanges = subscribePositionChanges?.(markPositionDirty);

    return () => {
      unsubscribePositionChanges?.();
      observer.disconnect();
      window.removeEventListener("resize", flushSize);
      scheduler.dispose();
      unregisterOcclusion();
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

  // Take a still while nothing covers the page, so the first overlay to arrive
  // swaps to a current picture at once instead of a blank. Bounded: one capture
  // per navigation or return to the screen, never a polling loop (plan 13.3).
  useEffect(() => {
    if (!visible || settledUrl === null) return;
    const timer = window.setTimeout(
      () => browserSurfaceOcclusion.refreshPlaceholder(descriptor.runtimeTabId),
      PLACEHOLDER_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [descriptor.runtimeTabId, settledUrl, visible]);

  return (
    <div ref={elementRef} className={className} data-native-browser-surface="">
      {occlusion.blocked ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden bg-content-surface"
          // The native view rounds every corner by one radius, so the still
          // standing in for it does the same.
          style={{ borderRadius: cornerRadius }}
          data-native-browser-placeholder={occlusion.reason ?? ""}
        >
          {occlusion.placeholder ? (
            <img
              src={occlusion.placeholder.dataUrl}
              alt=""
              draggable={false}
              className="size-full select-none object-fill"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

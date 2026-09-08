import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { registerGeometryTask } from "@/lib/desktopInteraction/geometryScheduler";

export function AppOverlayPortal({ children }: { readonly children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export interface AnchoredAppOverlayPortalProps {
  readonly anchor: HTMLElement | null;
  readonly children: ReactNode;
  readonly className?: string;
  readonly inset?: number;
}

/**
 * Places a custom, tile-scoped overlay in the same body portal/layer system as
 * dialogs and menus. This is reserved for UI that must preserve a tile's live
 * bounds, such as the keyboard split chooser.
 */
export function AnchoredAppOverlayPortal({
  anchor,
  children,
  className,
  inset = 0,
}: AnchoredAppOverlayPortalProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;

    const task = registerGeometryTask<{
      left: number;
      top: number;
      width: number;
      height: number;
      borderRadius: string;
    }>({
      name: "anchored-app-overlay",
      read: () => {
        if (!anchor.isConnected) return null;
        const next = anchor.getBoundingClientRect();
        return {
          left: next.left + inset,
          top: next.top + inset,
          width: Math.max(0, next.width - inset * 2),
          height: Math.max(0, next.height - inset * 2),
          borderRadius: window.getComputedStyle(anchor).borderRadius || "12px",
        };
      },
      write: (measurement) => {
        const overlay = overlayRef.current;
        if (!overlay) return;
        overlay.style.left = `${measurement.left}px`;
        overlay.style.top = `${measurement.top}px`;
        overlay.style.width = `${measurement.width}px`;
        overlay.style.height = `${measurement.height}px`;
        overlay.style.borderRadius = measurement.borderRadius;
      },
    });

    const invalidate = () => task.invalidate();
    invalidate();

    const observer = new ResizeObserver(invalidate);
    observer.observe(anchor);
    window.addEventListener("scroll", invalidate, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", invalidate, true);
      task.dispose();
    };
  }, [anchor, inset]);

  if (!anchor) return null;
  return (
    <AppOverlayPortal>
      <div
        ref={overlayRef}
        className={cn("fixed z-[var(--cozea-layer-dialog)]", className)}
        data-app-anchored-overlay
      >
        {children}
      </div>
    </AppOverlayPortal>
  );
}

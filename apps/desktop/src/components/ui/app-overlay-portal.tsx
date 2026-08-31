import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export function AppOverlayPortal({ children }: { readonly children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

interface AnchoredOverlayRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly borderRadius: CSSProperties["borderRadius"];
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
  const [rect, setRect] = useState<AnchoredOverlayRect | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setRect(null);
      return;
    }

    let frameId: number | null = null;
    const update = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const next = anchor.getBoundingClientRect();
        setRect({
          left: next.left + inset,
          top: next.top + inset,
          width: Math.max(0, next.width - inset * 2),
          height: Math.max(0, next.height - inset * 2),
          borderRadius: window.getComputedStyle(anchor).borderRadius || "12px",
        });
      });
    };

    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    update();

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, inset]);

  if (!rect) return null;
  return (
    <AppOverlayPortal>
      <div
        className={cn("fixed z-[var(--cozea-layer-dialog)]", className)}
        style={rect}
        data-app-anchored-overlay
      >
        {children}
      </div>
    </AppOverlayPortal>
  );
}

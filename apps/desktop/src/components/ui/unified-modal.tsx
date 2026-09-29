"use client";

import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react";

import { cn } from "@/lib/utils";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";

/**
 * Unified modal shell for the Cozea design system.
 *
 * Codified rules (do not work around them per call site):
 * - Title is a required plain string. No icons, no subtitles, no description
 *   slot — context belongs in the body.
 * - Never renders a top close button. Dismissal happens through footer
 *   actions (or `dismissable` outside/escape behavior).
 * - The footer is a shaded band (`bg-muted/50` + top border) with
 *   right-aligned actions. Primary action goes last.
 * - Size and animation come from the closed sets below.
 */
export const UNIFIED_MODAL_SIZES = {
  /** Confirms. */
  sm: "sm:max-w-sm",
  /** Default forms. */
  md: "sm:max-w-md",
  /** Large forms, invite/manage lists. */
  lg: "sm:max-w-xl",
  /** Wide content (conflict lists, session dialogs). */
  xl: "sm:max-w-2xl",
  /** Full task-scale forms. */
  "2xl": "sm:max-w-[860px]",
} as const;

export type UnifiedModalSize = keyof typeof UNIFIED_MODAL_SIZES;

/**
 * Codified open/close animations. Overlay always fades; the popup:
 * - `pop` (default): scale + fade, matches the legacy dialog feel.
 * - `rise`: translate + fade. The translate offsets compose with the
 *   -50% centering transform, which is why this is the only slide-style
 *   option — arbitrary slide distances would break centering.
 * - `fade`: opacity only.
 * - `none`: no transition (status/progress surfaces).
 */
export const UNIFIED_MODAL_ANIMATIONS = {
  pop: "transition-[scale,opacity] duration-200 ease-in-out will-change-transform data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
  rise: "transition-[translate,opacity] duration-200 ease-out will-change-transform data-ending-style:translate-y-[calc(-50%+10px)] data-ending-style:opacity-0 data-starting-style:translate-y-[calc(-50%+10px)] data-starting-style:opacity-0",
  fade: "transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0",
  none: "",
} as const;

export type UnifiedModalAnimation = keyof typeof UNIFIED_MODAL_ANIMATIONS;

export interface UnifiedModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Plain-text title. Never an icon, never a subtitle. */
  title: string;
  size?: UnifiedModalSize;
  animation?: UnifiedModalAnimation;
  /**
   * When false, outside presses and escape never close the modal — only
   * explicit `onOpenChange(false)` calls (e.g. footer buttons) do.
   * @default true
   */
  dismissable?: boolean;
  /** Rendered inside the shaded footer band. Omit for no footer. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function UnifiedModal({
  open,
  onOpenChange,
  title,
  size = "md",
  animation = "pop",
  dismissable = true,
  footer,
  children,
}: UnifiedModalProps) {
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      // Non-dismissable modals only close via explicit footer actions,
      // which call onOpenChange directly and bypass this handler.
      if (!next && !dismissable) return;
      onOpenChange(next);
    },
    [dismissable, onOpenChange],
  );

  return (
    <Dialog
      data-slot="unified-modal"
      open={open}
      onOpenChange={handleOpenChange}
      disablePointerDismissal={!dismissable}
    >
      <DialogPortal>
        <DialogOverlay />
        <BaseDialog.Popup
          data-slot="unified-modal-content"
          className={cn(
            "fixed top-[50%] left-[50%] z-[var(--cozea-layer-dialog)] flex w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-2xl border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            UNIFIED_MODAL_SIZES[size],
            UNIFIED_MODAL_ANIMATIONS[animation],
          )}
        >
          <div data-slot="unified-modal-header" className="px-6 pt-5">
            <DialogTitle className="text-left">{title}</DialogTitle>
          </div>
          <div data-slot="unified-modal-body" className="px-6 py-4">
            {children}
          </div>
          {footer ? (
            <div
              data-slot="unified-modal-footer"
              className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/50 px-6 py-4"
            >
              {footer}
            </div>
          ) : null}
        </BaseDialog.Popup>
      </DialogPortal>
    </Dialog>
  );
}

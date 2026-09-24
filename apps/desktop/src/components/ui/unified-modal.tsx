"use client";

import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react";

import { cn } from "@/lib/utils";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Unified modal shell for the Cozea design system.
 *
 * Codified rules (do not work around them per call site):
 * - Title is a required plain string. No icons, no subtitles, no description
 *   slot — context belongs in the body.
 * - Body copy is minimal: as little text as possible, a sentence or two.
 * - Typography always inherits the app font (`font-sans`). Never a
 *   display face, never a per-modal font treatment.
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
  /** Full-bleed review surfaces (diffs). */
  "3xl": "sm:max-w-6xl",
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
  /** `data-tour` on the popup, for a product tour step that rings the modal. */
  tourTarget?: string;
  /** Where focus goes on close, when the element that opened it may be gone. */
  finalFocus?: React.ComponentProps<typeof BaseDialog.Popup>["finalFocus"];
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
  tourTarget,
  finalFocus,
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
          data-tour={tourTarget}
          finalFocus={finalFocus}
          className={cn(
            "fixed top-[50%] left-[50%] z-[var(--cozea-layer-dialog)] flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-2xl border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            UNIFIED_MODAL_SIZES[size],
            UNIFIED_MODAL_ANIMATIONS[animation],
          )}
        >
          <div data-slot="unified-modal-header" className="shrink-0 px-6 pt-5">
            <BaseDialog.Title
              data-slot="unified-modal-title"
              className="text-left font-sans text-lg font-semibold leading-snug tracking-tight"
            >
              {title}
            </BaseDialog.Title>
          </div>
          {/* The popup never outgrows the window; a tall body scrolls
              between the fixed title and footer instead of being clipped. */}
          <div data-slot="unified-modal-body" className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {children}
          </div>
          {footer ? (
            <div
              data-slot="unified-modal-footer"
              className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 bg-muted/50 px-6 py-4"
            >
              {footer}
            </div>
          ) : null}
        </BaseDialog.Popup>
      </DialogPortal>
    </Dialog>
  );
}

export interface UnifiedModalFieldProps {
  id: string;
  /** Field title. Visible only as placeholder text when the field is empty —
   *  never a label above, never floated. Exposed to assistive tech via aria-label. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  spellCheck?: boolean;
  maxLength?: number;
  required?: boolean;
  /** Suffix inside the field (e.g. character counters). */
  trailing?: React.ReactNode;
  className?: string;
}

/**
 * The single codified text field for modals: a shared `Input` whose title
 * is the placeholder, shown only while empty. No label above, no floated
 * label, no per-modal field chrome.
 * Instruction-style prompts (type-to-confirm) use a plain `Input` with a
 * merged instruction placeholder instead — see ConfirmModal usage.
 */
export function UnifiedModalField({
  id,
  label,
  value,
  onChange,
  autoFocus,
  disabled,
  autoComplete,
  spellCheck,
  maxLength,
  required,
  trailing,
  className,
}: UnifiedModalFieldProps) {
  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        maxLength={maxLength}
        required={required}
        className={cn(trailing && "pr-12")}
      />
      {trailing ? (
        <span className="absolute right-3 top-1/2 -translate-y-1/2">{trailing}</span>
      ) : null}
    </div>
  );
}

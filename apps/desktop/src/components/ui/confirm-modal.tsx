"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { UnifiedModal, type UnifiedModalAnimation } from "@/components/ui/unified-modal";
import {
  isNativeModalPresentation,
  type NativeCapableModalKind,
} from "@/components/ui/modal-presentation";

export interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Selects danger styling AND the native override slot.
   * `destructive-confirm` renders the confirm button destructive and,
   * when flipped in `modal-presentation.ts`, a native warning dialog.
   * @default "confirm"
   */
  kind?: NativeCapableModalKind;
  title: string;
  /** Short body text. Keep it to a sentence or two — no subtitles. */
  message: string;
  confirmLabel: string;
  /** @default "Cancel" */
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  isConfirming?: boolean;
  /** e.g. type-to-confirm gates. Disables the confirm button. */
  confirmDisabled?: boolean;
  dismissable?: boolean;
  animation?: UnifiedModalAnimation;
  /** Rare extra body content (e.g. verification inputs). */
  children?: React.ReactNode;
}

export function ConfirmModal({
  open,
  onOpenChange,
  kind = "confirm",
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  isConfirming = false,
  confirmDisabled = false,
  dismissable = true,
  animation = "pop",
  children,
}: ConfirmModalProps) {
  if (isNativeModalPresentation(kind)) {
    return (
      <NativeConfirmBridge
        open={open}
        onOpenChange={onOpenChange}
        kind={kind}
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
      />
    );
  }

  const danger = kind === "destructive-confirm";
  const busy = isConfirming;

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      animation={animation}
      dismissable={dismissable && !busy}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            onClick={() => void onConfirm()}
            disabled={busy || confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{message}</p>
        {children}
      </div>
    </UnifiedModal>
  );
}

interface NativeConfirmBridgeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: NativeCapableModalKind;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void | Promise<void>;
}

/**
 * Effect-driven native dialog. Same contract as the React path: confirm
 * runs `onConfirm` (the caller closes), anything else closes the modal.
 * Rendered only when the kind is flipped to native in
 * `modal-presentation.ts` and a native bridge exists.
 */
function NativeConfirmBridge({
  open,
  onOpenChange,
  kind,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: NativeConfirmBridgeProps) {
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    if (!open || firedRef.current) return;
    firedRef.current = true;

    const boxOptions: Parameters<typeof window.electronAPI.dialog.showMessageBox>[0] = {
      type: kind === "destructive-confirm" ? "warning" : "question",
      title,
      message,
      buttons: [confirmLabel, cancelLabel],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };

    void (async () => {
      try {
        const result = await window.electronAPI.dialog.showMessageBox(boxOptions);
        firedRef.current = false;
        if (result.response === 0) {
          await onConfirm();
        } else {
          onOpenChange(false);
        }
      } catch (error) {
        console.error("[ConfirmModal] showMessageBox failed:", error);
        firedRef.current = false;
        onOpenChange(false);
      }
    })();
  }, [cancelLabel, confirmLabel, kind, message, onConfirm, onOpenChange, open, title]);

  return null;
}

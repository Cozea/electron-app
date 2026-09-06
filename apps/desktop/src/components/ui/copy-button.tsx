"use client";

import * as React from "react";
import { CheckmarkCircle02Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { appToast } from "@/lib/appToast";
import { cn } from "@/lib/utils";

export interface CopyButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "children"> {
  value: string;
  label?: string;
  copiedLabel?: string;
  toastMessage?: string;
  timeoutMs?: number;
  children?: React.ReactNode | ((copied: boolean) => React.ReactNode);
  withTooltip?: boolean;
}

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  toastMessage,
  timeoutMs = 2000,
  children,
  withTooltip = true,
  className,
  onClick,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;

      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        if (toastMessage) {
          appToast.success({ title: toastMessage });
        }
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = window.setTimeout(() => {
          setCopied(false);
          timeoutRef.current = null;
        }, timeoutMs);
      } catch (err) {
        console.error("Failed to copy to clipboard:", err);
      }
    },
    [onClick, timeoutMs, toastMessage, value],
  );

  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn(
        "size-7 shrink-0 text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
        copied && "text-emerald-600 hover:text-emerald-600 dark:text-emerald-400",
        className,
      )}
      onClick={handleCopy}
      aria-label={copied ? copiedLabel : label}
      {...props}
    >
      {typeof children === "function" ? (
        children(copied)
      ) : children ? (
        children
      ) : copied ? (
        <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5 shrink-0" />
      ) : (
        <HugeiconsIcon icon={Copy01Icon} className="size-3.5 shrink-0" />
      )}
    </Button>
  );

  if (withTooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top">
          {copied ? copiedLabel : label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return button;
}

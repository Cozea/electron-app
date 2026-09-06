"use client";

import * as React from "react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface HeaderBackButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "children"> {
  label?: React.ReactNode;
  iconOnly?: boolean;
}

export function HeaderBackButton({
  label = "Back",
  iconOnly = false,
  className,
  onClick,
  ...props
}: HeaderBackButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? "icon-xs" : "sm"}
      className={cn(
        "h-7 gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/10 dark:hover:bg-foreground/15 transition-colors cursor-pointer",
        iconOnly && "w-7 px-0",
        className,
      )}
      onClick={onClick}
      {...props}
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5 shrink-0" />
      {!iconOnly && label ? <span>{label}</span> : null}
    </Button>
  );
}

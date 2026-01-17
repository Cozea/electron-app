"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BookmarkIcon, type LucideProps } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";

/**
 * Checkpoint data structure for conversation restore points
 */
export interface CheckpointData {
  /** Unique checkpoint identifier */
  id: string;
  /** Index of the message this checkpoint is at */
  messageIndex: number;
  /** When the checkpoint was created */
  timestamp: Date;
  /** Number of messages up to this checkpoint */
  messageCount: number;
  /** Optional label for the checkpoint */
  label?: string;
}

export type CheckpointProps = HTMLAttributes<HTMLDivElement>;

/**
 * Container for checkpoint marker in conversation.
 * Displays a visual separator with restore functionality.
 *
 * @example
 * ```tsx
 * <Checkpoint>
 *   <CheckpointIcon />
 *   <CheckpointTrigger
 *     tooltip="Restore to this point"
 *     onClick={() => restoreToCheckpoint(messageIndex)}
 *   />
 * </Checkpoint>
 * ```
 */
export const Checkpoint = memo(
  ({ className, children, ...props }: CheckpointProps) => (
    <div
      className={cn(
        "relative flex items-center gap-2 py-2",
        className
      )}
      {...props}
    >
      <Separator className="flex-1" />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {children}
      </div>
      <Separator className="flex-1" />
    </div>
  )
);

Checkpoint.displayName = "Checkpoint";

export type CheckpointIconProps = LucideProps;

/**
 * Visual indicator icon for checkpoint.
 * Defaults to BookmarkIcon, can be customized via children.
 */
export const CheckpointIcon = memo(
  ({ className, children, ...props }: CheckpointIconProps) => {
    if (children) {
      return <>{children}</>;
    }

    return (
      <BookmarkIcon
        className={cn("size-3.5", className)}
        {...props}
      />
    );
  }
);

CheckpointIcon.displayName = "CheckpointIcon";

export type CheckpointTriggerProps = ComponentProps<typeof Button> & {
  /** Tooltip text shown on hover */
  tooltip?: string;
};

/**
 * Interactive button to restore conversation to checkpoint.
 * Includes optional tooltip for accessibility.
 */
export const CheckpointTrigger = memo(
  ({
    className,
    children,
    tooltip = "Restore to this point",
    variant = "ghost",
    size = "sm",
    ...props
  }: CheckpointTriggerProps) => {
    const button = (
      <Button
        className={cn(
          "h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground",
          className
        )}
        variant={variant}
        size={size}
        {...props}
      >
        {children ?? "Restore"}
      </Button>
    );

    if (!tooltip) {
      return button;
    }

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
);

CheckpointTrigger.displayName = "CheckpointTrigger";

export type CheckpointLabelProps = HTMLAttributes<HTMLSpanElement>;

/**
 * Optional label for checkpoint (e.g., timestamp, description)
 */
export const CheckpointLabel = memo(
  ({ className, children, ...props }: CheckpointLabelProps) => (
    <span
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    >
      {children}
    </span>
  )
);

CheckpointLabel.displayName = "CheckpointLabel";

// Utility functions for checkpoint management

/**
 * Creates a new checkpoint at the specified message index
 */
export function createCheckpoint(
  messageIndex: number,
  label?: string
): CheckpointData {
  return {
    id: crypto.randomUUID(),
    messageIndex,
    timestamp: new Date(),
    messageCount: messageIndex + 1,
    label,
  };
}

/**
 * Restores messages to a checkpoint by slicing to the checkpoint index
 */
export function restoreToCheckpoint<T>(
  messages: T[],
  checkpoint: CheckpointData
): T[] {
  return messages.slice(0, checkpoint.messageIndex + 1);
}

/**
 * Filters checkpoints to only include those before or at a given index
 */
export function filterCheckpointsAfter(
  checkpoints: CheckpointData[],
  messageIndex: number
): CheckpointData[] {
  return checkpoints.filter((cp) => cp.messageIndex <= messageIndex);
}

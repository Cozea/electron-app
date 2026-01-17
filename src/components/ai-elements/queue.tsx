"use client";

import { cn } from "@/lib/utils";
import { ClockIcon, UsersIcon } from "lucide-react";
import type { HTMLAttributes } from "react";
import { memo } from "react";
import { Loader } from "./loader";

export type QueueProps = HTMLAttributes<HTMLDivElement>;

/**
 * Container for queue position and wait time display.
 * Used when requests are queued during high traffic.
 *
 * @example
 * ```tsx
 * <Queue>
 *   <QueuePosition position={3} total={15} />
 *   <QueueEstimate waitTime={120} />
 * </Queue>
 * ```
 */
export const Queue = memo(
  ({ className, children, ...props }: QueueProps) => (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-lg border bg-muted/30 p-6 text-center",
        className
      )}
      role="status"
      aria-live="polite"
      {...props}
    >
      <Loader className="size-8" />
      {children}
    </div>
  )
);

Queue.displayName = "Queue";

export type QueuePositionProps = HTMLAttributes<HTMLDivElement> & {
  /** Current position in queue */
  position: number;
  /** Total number of requests in queue */
  total?: number;
};

/**
 * Displays the current position in the queue
 */
export const QueuePosition = memo(
  ({ className, position, total, ...props }: QueuePositionProps) => (
    <div
      className={cn("flex items-center gap-2 text-sm", className)}
      {...props}
    >
      <UsersIcon className="size-4 text-muted-foreground" />
      <span>
        Position <span className="font-medium">{position}</span>
        {total && (
          <span className="text-muted-foreground"> of {total}</span>
        )}
      </span>
    </div>
  )
);

QueuePosition.displayName = "QueuePosition";

export type QueueEstimateProps = HTMLAttributes<HTMLDivElement> & {
  /** Estimated wait time in seconds */
  waitTime: number;
};

/**
 * Formats and displays estimated wait time
 */
export const QueueEstimate = memo(
  ({ className, waitTime, ...props }: QueueEstimateProps) => {
    // Format wait time
    const formatWaitTime = (seconds: number): string => {
      if (seconds < 60) {
        return `${seconds} second${seconds !== 1 ? "s" : ""}`;
      }
      const minutes = Math.ceil(seconds / 60);
      return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
    };

    return (
      <div
        className={cn(
          "flex items-center gap-2 text-sm text-muted-foreground",
          className
        )}
        {...props}
      >
        <ClockIcon className="size-4" />
        <span>Estimated wait: {formatWaitTime(waitTime)}</span>
      </div>
    );
  }
);

QueueEstimate.displayName = "QueueEstimate";

export type QueueMessageProps = HTMLAttributes<HTMLParagraphElement>;

/**
 * Custom message within the queue display
 */
export const QueueMessage = memo(
  ({ className, children, ...props }: QueueMessageProps) => (
    <p
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    >
      {children}
    </p>
  )
);

QueueMessage.displayName = "QueueMessage";

// Convenience pre-composed queue display

export type RequestQueueProps = {
  /** Current position in queue */
  position: number;
  /** Total requests in queue */
  total?: number;
  /** Estimated wait time in seconds */
  estimatedWait?: number;
  /** Custom message */
  message?: string;
  /** Optional className */
  className?: string;
};

/**
 * Pre-composed queue display showing position and wait time
 */
export const RequestQueue = memo(
  ({
    position,
    total,
    estimatedWait,
    message,
    className,
  }: RequestQueueProps) => {
    // Don't show if position is 1 or less
    if (position <= 1 && !message) {
      return null;
    }

    return (
      <Queue className={className}>
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Request Queued</h4>
          <QueuePosition position={position} total={total} />
          {estimatedWait !== undefined && estimatedWait > 0 && (
            <QueueEstimate waitTime={estimatedWait} />
          )}
          {message && <QueueMessage>{message}</QueueMessage>}
        </div>
      </Queue>
    );
  }
);

RequestQueue.displayName = "RequestQueue";

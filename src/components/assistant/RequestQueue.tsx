"use client";

import {
  Queue,
  QueuePosition,
  QueueEstimate,
  QueueMessage,
  RequestQueue as RequestQueueBase,
} from "@/components/ai-elements/queue";

export interface RequestQueueDisplayProps {
  /** Current position in queue */
  position: number;
  /** Total requests in queue */
  total?: number;
  /** Estimated wait time in seconds */
  estimatedWait?: number;
  /** Optional className */
  className?: string;
}

/**
 * Displays queue position and wait time during high load.
 * Only shows when position > 1.
 *
 * @example
 * ```tsx
 * <RequestQueueDisplay
 *   position={3}
 *   total={15}
 *   estimatedWait={120}
 * />
 * ```
 */
export function RequestQueueDisplay({
  position,
  total,
  estimatedWait,
  className,
}: RequestQueueDisplayProps) {
  // Don't show if not in queue
  if (position <= 1) {
    return null;
  }

  return (
    <RequestQueueBase
      position={position}
      total={total}
      estimatedWait={estimatedWait}
      message="Your request is being processed. Please wait."
      className={className}
    />
  );
}

// Re-export base components for custom usage
export {
  Queue,
  QueuePosition,
  QueueEstimate,
  QueueMessage,
  RequestQueueBase as RequestQueue,
};

export default RequestQueueDisplay;

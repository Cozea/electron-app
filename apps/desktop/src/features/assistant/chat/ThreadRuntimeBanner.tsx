import { memo, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon as __CircleAlertIconHugeIcon,
  Cancel01Icon as __XIconHugeIcon,
  Loading03Icon as __LoadingIconHugeIcon,
} from "@hugeicons/core-free-icons";

import type { SessionPhase } from "@/features/assistant/model/types";
import { cn } from "@/lib/utils";

type ThreadRuntimeBannerState = Exclude<SessionPhase, "disconnected" | "ready" | "running"> | "interrupting";

interface ThreadRuntimeBannerProps {
  state: ThreadRuntimeBannerState;
  detail?: string | null;
  isForceStopAvailable?: boolean;
  /** One-click fix (install CLI / run login) when the detail is actionable. */
  action?: ReactNode;
}

function bannerPresentation(state: ThreadRuntimeBannerState, isForceStopAvailable: boolean | undefined) {
  switch (state) {
    case "interrupting":
      return {
        title: "Stopping run",
        detail: isForceStopAvailable
          ? "The agent is still settling. Force stop is available if it stays stuck."
          : "Waiting for the current run and any active tools to stop.",
        className: "border-amber-300 bg-[#fffbeb] text-amber-900 dark:border-amber-500/40 dark:bg-[#231b0f] dark:text-amber-200",
        icon: __LoadingIconHugeIcon,
      };
    case "interrupted":
      return {
        title: "Run interrupted",
        detail: "The last run was stopped before it finished.",
        className: "border-amber-300 bg-[#fffbeb] text-amber-900 dark:border-amber-500/40 dark:bg-[#231b0f] dark:text-amber-200",
        icon: __CircleAlertIconHugeIcon,
      };
    case "stopped":
      return {
        title: "Session stopped",
        detail: "The provider session ended. Send a message to start a fresh run.",
        className: "border-border bg-[#f4f4f5] text-foreground dark:border-white/[0.12] dark:bg-[#202022] dark:text-foreground",
      };
    case "error":
      return {
        title: "Run error",
        detail: "The last run failed before it completed.",
        className: "border-destructive/30 bg-[#fff1f2] text-destructive dark:border-red-500/40 dark:bg-[#231214] dark:text-red-400",
        icon: __CircleAlertIconHugeIcon,
      };
    case "connecting":
      return {
        title: "Connecting",
        detail: "Waiting for the provider session to come online.",
        className: "border-border bg-[#f4f4f5] text-foreground dark:border-white/[0.12] dark:bg-[#202022] dark:text-foreground",
        icon: __LoadingIconHugeIcon,
      };
  }
}

export const ThreadRuntimeBanner = memo(function ThreadRuntimeBanner(
  props: ThreadRuntimeBannerProps,
) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const presentation = bannerPresentation(props.state, props.isForceStopAvailable);
  const detail = props.detail?.trim() || presentation.detail;
  const currentKey = `${props.state}-${detail}`;

  if (dismissedKey === currentKey) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-2xl border px-3.5 py-2.5 shadow-md transition-all duration-150",
        presentation.className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        {presentation.icon && (
          <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
            <HugeiconsIcon
              icon={presentation.icon}
              className={cn(
                "size-4",
                props.state === "connecting" || props.state === "interrupting"
                  ? "animate-spin"
                  : undefined,
              )}
            />
          </span>
        )}
        <div className="min-w-0 flex-1 text-left">
          <p className="text-xs font-semibold leading-5">{presentation.title}</p>
          {detail ? (
            <p className="mt-0.5 text-xs leading-normal opacity-90 break-words">{detail}</p>
          ) : null}
          {props.action ? <div className="mt-2">{props.action}</div> : null}
        </div>
        <button
          onClick={() => setDismissedKey(currentKey)}
          className="mt-0.5 ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-sm transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/50"
          aria-label="Dismiss"
        >
          <HugeiconsIcon icon={__XIconHugeIcon} strokeWidth={2.5} className="size-3 text-black stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
});

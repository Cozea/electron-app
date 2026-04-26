import { memo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon as __CircleAlertIconHugeIcon,
  Cancel01Icon as __StopIconHugeIcon,
  Loading03Icon as __LoadingIconHugeIcon,
} from "@hugeicons/core-free-icons";

import type { SessionPhase } from "@/stores/types";
import { cn } from "@/lib/utils";

type ThreadRuntimeBannerState = Exclude<SessionPhase, "disconnected" | "ready" | "running"> | "interrupting";

interface ThreadRuntimeBannerProps {
  state: ThreadRuntimeBannerState;
  detail?: string | null;
  isForceStopAvailable?: boolean;
}

function bannerPresentation(state: ThreadRuntimeBannerState, isForceStopAvailable: boolean | undefined) {
  switch (state) {
    case "interrupting":
      return {
        title: "Stopping run",
        detail: isForceStopAvailable
          ? "The agent is still settling. Force stop is available if it stays stuck."
          : "Waiting for the current run and any active tools to stop.",
        className: "border-amber-500/30 bg-amber-500/8 text-amber-800 dark:text-amber-200",
        icon: __LoadingIconHugeIcon,
      };
    case "interrupted":
      return {
        title: "Run interrupted",
        detail: "The last run was stopped before it finished.",
        className: "border-amber-500/30 bg-amber-500/8 text-amber-800 dark:text-amber-200",
        icon: __StopIconHugeIcon,
      };
    case "stopped":
      return {
        title: "Session stopped",
        detail: "The provider session ended. Send a message to start a fresh run.",
        className: "border-border/70 bg-secondary/45 text-foreground/85",
        icon: __StopIconHugeIcon,
      };
    case "error":
      return {
        title: "Run error",
        detail: "The last run failed before it completed.",
        className: "border-destructive/25 bg-destructive/8 text-destructive",
        icon: __CircleAlertIconHugeIcon,
      };
    case "connecting":
      return {
        title: "Connecting",
        detail: "Waiting for the provider session to come online.",
        className: "border-border/70 bg-secondary/45 text-foreground/85",
        icon: __LoadingIconHugeIcon,
      };
  }
}

export const ThreadRuntimeBanner = memo(function ThreadRuntimeBanner(
  props: ThreadRuntimeBannerProps,
) {
  const presentation = bannerPresentation(props.state, props.isForceStopAvailable);
  const detail = props.detail?.trim() || presentation.detail;

  return (
    <div
      className={cn(
        "rounded-2xl border px-3 py-2.5 sm:px-4",
        presentation.className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center">
          <HugeiconsIcon icon={presentation.icon} className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium leading-5">{presentation.title}</p>
          {detail ? (
            <p className="mt-0.5 text-xs leading-5 opacity-85">{detail}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
});

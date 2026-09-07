import { memo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitForkIcon, Volume02Icon } from "@hugeicons/core-free-icons";
import type { ChatMessage } from "../model/types";
import type { TextRevealController } from "./textRevealController";
import { useTextReveal } from "./useTextReveal";
import { MessageCopyButton } from "./MessageCopyButton";
import { cn } from "@/lib/utils";

interface AssistantResponseActionsProps {
  message: ChatMessage;
  controller: TextRevealController;
  relativeTime: string;
  isLatest?: boolean;
  showActions?: boolean;
}

/** One footer per settled response; it may sit after trailing tool activity. */
export const AssistantResponseActions = memo(function AssistantResponseActions({
  message,
  controller,
  relativeTime,
  isLatest = false,
  showActions = true,
}: AssistantResponseActionsProps) {
  const { isRevealing } = useTextReveal(controller, message.id);
  const isReady = showActions && !message.streaming && !isRevealing && Boolean(message.text);

  return (
    <div
      data-response-actions={message.id}
      aria-hidden={!isReady}
      className={cn(
        "mt-1 flex h-7 items-center gap-3 px-1 py-1 text-[11px] text-muted-foreground/60 transition-opacity duration-150 animate-in fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none",
        !isReady
          ? "invisible pointer-events-none select-none"
          : isLatest
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:opacity-100 pointer-events-auto",
      )}
    >
      <div className="flex items-center gap-1.5">
        <MessageCopyButton text={message.text} />
        <button
          type="button"
          disabled
          className="cursor-not-allowed p-0.5 text-muted-foreground/25"
          title="Branch (coming soon)"
          aria-label="Branch thread"
        >
          <HugeiconsIcon icon={GitForkIcon} className="size-3.5" />
        </button>
        <button
          type="button"
          disabled
          className="cursor-not-allowed p-0.5 text-muted-foreground/25"
          title="Read aloud (coming soon)"
          aria-label="Read aloud"
        >
          <HugeiconsIcon icon={Volume02Icon} className="size-3.5" />
        </button>
      </div>
      {relativeTime ? <span className="select-none tabular-nums">{relativeTime}</span> : null}
    </div>
  );
});

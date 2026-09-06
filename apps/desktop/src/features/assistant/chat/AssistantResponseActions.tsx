import { memo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitForkIcon, PinIcon, Volume02Icon } from "@hugeicons/core-free-icons";
import type { ChatMessage } from "../model/types";
import type { TextRevealController } from "./textRevealController";
import { useTextReveal } from "./useTextReveal";
import { MessageCopyButton } from "./MessageCopyButton";

/** One footer per settled response; it may sit after trailing tool activity. */
export const AssistantResponseActions = memo(function AssistantResponseActions({
  message,
  controller,
  relativeTime,
}: {
  message: ChatMessage;
  controller: TextRevealController;
  relativeTime: string;
}) {
  const { isRevealing } = useTextReveal(controller, message.id);
  if (message.streaming || isRevealing || !message.text) return null;
  return (
    <div
      data-response-actions={message.id}
      className="mt-1 flex items-center gap-3 px-1 py-1 text-[11px] text-muted-foreground/60 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
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
          title="Pin (coming soon)"
          aria-label="Pin message"
        >
          <HugeiconsIcon icon={PinIcon} className="size-3.5" />
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

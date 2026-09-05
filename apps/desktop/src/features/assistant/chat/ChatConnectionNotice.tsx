import { memo } from "react";
import type { SubscriptionStatus } from "@/substrate/subscriptionSupervisor";

export const ChatConnectionNotice = memo(function ChatConnectionNotice({
  status,
}: {
  status?: SubscriptionStatus | null;
}) {
  if (!status || status.phase === "connected") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 px-4 py-2 text-xs text-muted-foreground"
      data-chat-connection={status.phase}
    >
      {status.phase === "connecting"
        ? "Connecting to conversation…"
        : "Connection interrupted. Reconnecting… Saved content may be out of date."}
    </div>
  );
});

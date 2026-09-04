import type { ServerProvider } from "@cozea/assistant-contracts";
import type { Thread } from "../model/types";

export function compactionUnavailableReason(input: {
  provider?: Pick<ServerProvider, "slashCommands"> | null;
  thread?: Pick<Thread, "messages"> | null;
  ready: boolean;
  busy: boolean;
  hasPendingRequests: boolean;
}): string | null {
  if (!input.provider?.slashCommands?.some((command) => command.name === "compact"))
    return "This provider does not support context compaction.";
  if (!input.thread?.messages.some((message) => message.role === "user"))
    return "Send a message before compacting this conversation.";
  if (!input.ready) return "Reconnect this conversation before compacting it.";
  if (input.busy) return "Wait for the current operation to finish before compacting.";
  if (input.hasPendingRequests) return "Answer pending questions and approvals before compacting.";
  return null;
}

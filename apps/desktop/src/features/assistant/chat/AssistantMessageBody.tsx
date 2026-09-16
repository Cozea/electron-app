import { memo, type ReactNode } from "react";

import ChatMarkdown from "./ChatMarkdown";
import type { TextRevealController } from "./textRevealController";
import type { ChatMessage } from "../model/types";

interface AssistantMessageBodyProps {
  message: ChatMessage;
  controller?: TextRevealController;
  cwd: string | undefined;
  children: ReactNode;
  actions: ReactNode;
}

/** Directly renders assistant message text without artificial reveal delay. */
export const AssistantMessageBody = memo(function AssistantMessageBody({
  message,
  cwd,
  children,
  actions,
}: AssistantMessageBodyProps) {
  const streaming = Boolean(message.streaming);
  const messageText = message.text || (streaming ? "" : "(empty response)");
  return (
    <div className="group min-w-0 px-1 py-0.5">
      <div>
        <ChatMarkdown text={messageText} cwd={cwd} isStreaming={streaming} variant="timeline" />
      </div>
      {children}
      {actions}
    </div>
  );
});

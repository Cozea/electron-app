import { memo, useLayoutEffect, useRef, type ReactNode } from "react";

import ChatMarkdown from "./ChatMarkdown";
import { useTextReveal } from "./useTextReveal";
import type { TextRevealController } from "./textRevealController";
import type { ChatMessage } from "../model/types";

interface AssistantMessageBodyProps {
  message: ChatMessage;
  controller: TextRevealController;
  cwd: string | undefined;
  children: ReactNode;
  actions: ReactNode;
}

/** Only this component subscribes to presentation frames; timeline rows stay stable. */
export const AssistantMessageBody = memo(function AssistantMessageBody({
  message,
  controller,
  cwd,
  children,
  actions,
}: AssistantMessageBodyProps) {
  const { displayText, isRevealing } = useTextReveal(controller, message.id);
  const textRef = useRef<HTMLDivElement>(null);
  const entranceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(
    () => () => {
      if (entranceTimer.current !== null) clearTimeout(entranceTimer.current);
    },
    [],
  );
  useLayoutEffect(() => {
    const node = textRef.current;
    if (!node || !displayText || !controller.consumeEntrance(message.id)) return;
    node.classList.add("assistant-text-enter");
    entranceTimer.current = setTimeout(() => node.classList.remove("assistant-text-enter"), 180);
    // Do not clean up on each chunk. The class completes once and the registry
    // consumes its entrance, so a recycled DOM node cannot replay it.
  }, [controller, message.id, displayText]);

  const streaming = message.streaming || isRevealing;
  const messageText = displayText || (streaming || message.text ? "" : "(empty response)");
  return (
    <div className="group min-w-0 px-1 py-0.5" data-assistant-text-revealing={isRevealing}>
      <div ref={textRef}>
        <ChatMarkdown text={messageText} cwd={cwd} isStreaming={streaming} variant="timeline" />
      </div>
      {children}
      {!streaming && message.text ? actions : null}
    </div>
  );
});

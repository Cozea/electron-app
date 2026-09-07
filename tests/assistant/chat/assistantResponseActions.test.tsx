import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantResponseActions } from "@/features/assistant/chat/AssistantResponseActions";
import { TextRevealController } from "@/features/assistant/chat/textRevealController";
import type { ChatMessage } from "@/features/assistant/model/types";

const mockScheduler = {
  now: () => Date.now(),
  requestFrame: () => 1,
  cancelFrame: () => {},
};

const mockMessage: ChatMessage = {
  id: "msg-1" as any,
  role: "assistant",
  text: "Hey. How can I help you today?",
  createdAt: "2026-09-07T00:00:00.000Z",
  streaming: false,
};

describe("AssistantResponseActions", () => {
  it("does not render the pin button", () => {
    const controller = new TextRevealController(mockScheduler);
    const html = renderToStaticMarkup(
      <AssistantResponseActions
        message={mockMessage}
        controller={controller}
        relativeTime="20 minutes ago"
        isLatest={true}
      />,
    );

    expect(html).not.toContain("Pin");
    expect(html).not.toContain("pin");
    expect(html).toContain("Copy message");
    expect(html).toContain("Branch");
    expect(html).toContain("Read aloud");
  });

  it("displays permanently (opacity-100) when isLatest is true", () => {
    const controller = new TextRevealController(mockScheduler);
    const html = renderToStaticMarkup(
      <AssistantResponseActions
        message={mockMessage}
        controller={controller}
        relativeTime="just now"
        isLatest={true}
      />,
    );

    expect(html).toContain("opacity-100");
    expect(html).not.toContain("opacity-0");
  });

  it("displays on hover (opacity-0 group-hover:opacity-100) when isLatest is false", () => {
    const controller = new TextRevealController(mockScheduler);
    const html = renderToStaticMarkup(
      <AssistantResponseActions
        message={mockMessage}
        controller={controller}
        relativeTime="5 minutes ago"
        isLatest={false}
      />,
    );

    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover:opacity-100");
    expect(html).toContain("focus-within:opacity-100");
  });

  it("reserves row height (h-7 invisible) even when not ready yet", () => {
    const controller = new TextRevealController(mockScheduler);
    const html = renderToStaticMarkup(
      <AssistantResponseActions
        message={{ ...mockMessage, streaming: true }}
        controller={controller}
        relativeTime=""
        isLatest={true}
        showActions={false}
      />,
    );

    expect(html).toContain("h-7");
    expect(html).toContain("invisible");
    expect(html).toContain("pointer-events-none");
    expect(html).toContain('aria-hidden="true"');
  });
});

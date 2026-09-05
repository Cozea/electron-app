import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ChatMarkdown from "@/features/assistant/chat/ChatMarkdown";
import { AuthorizedChatAttachment } from "@/features/assistant/chat/ChatMedia";

vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark" }) }));

describe("provider media rendering boundary", () => {
  it.each(["image.png", "video.mp4", "audio.wav"])(
    "renders %s as an explicit link without a fetchable media element",
    (name) => {
      const url = `http://127.0.0.1:43193/${name}`;
      const html = renderToStaticMarkup(
        <ChatMarkdown text={`![External asset](${url})`} cwd="/workspace" />,
      );
      expect(html).toContain(`href="${url}"`);
      expect(html).toContain("open external media");
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).not.toMatch(/<(?:img|video|audio|link)\b/);
    },
  );

  it("does not use a provider-controlled attachment preview as a network source", () => {
    const html = renderToStaticMarkup(
      <AuthorizedChatAttachment
        attachment={{
          type: "image",
          id: "remote",
          name: "remote.png",
          mimeType: "image/png",
          sizeBytes: 1,
          previewUrl: "http://127.0.0.1:43193/attachment.png",
        }}
      />,
    );
    expect(html).toContain("preview unavailable");
    expect(html).not.toContain("127.0.0.1");
    expect(html).not.toContain("<img");
  });
});

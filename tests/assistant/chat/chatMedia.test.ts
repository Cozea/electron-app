import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { describe, expect, it } from "vitest";
import {
  assetRefreshDelay,
  classifyChatMediaSource,
  resolveSignedAssetUrl,
} from "@/features/assistant/chat/chatMediaSource";
import {
  parseChatAssistantCitation,
  remarkChatRichOutput,
} from "@/features/assistant/chat/chatRichOutput";

const renderRichOutput = (text: string) =>
  renderToStaticMarkup(
    createElement(Markdown, {
      remarkPlugins: [remarkChatRichOutput],
      children: text,
    }),
  );

describe("authorized chat media", () => {
  it("never automatically fetches provider-controlled network media", () => {
    for (const source of [
      "http://127.0.0.1:43193/private.png",
      "http://localhost/private.mp4",
      "http://192.168.1.2/private.wav",
      "http://[::1]/image.png",
      "http://2130706433/image.png",
      "//10.0.0.1/image.png",
      "https://example.com/redirect-to-private",
      "https://rebind.example/image.png",
    ])
      expect(classifyChatMediaSource(source).kind).toBe("external");
    expect(classifyChatMediaSource("https://").kind).toBe("blocked");
    expect(classifyChatMediaSource("blob:https://example.com/local").kind).toBe("direct");
    expect(classifyChatMediaSource("data:image/png;base64,aGVsbG8=").kind).toBe("direct");
  });
  it("routes absolute, relative and encoded file paths through signing", () => {
    expect(classifyChatMediaSource("./art/result.png", "/workspace")).toEqual({
      kind: "file",
      value: "/workspace/./art/result.png",
    });
    expect(classifyChatMediaSource("file:///tmp/my%20image.png")).toEqual({
      kind: "file",
      value: "/tmp/my image.png",
    });
    expect(classifyChatMediaSource("C:\\images\\test.png").kind).toBe("file");
    expect(classifyChatMediaSource("https://example.com/a.png").kind).toBe("external");
    expect(classifyChatMediaSource("javascript:alert(1)", "/workspace").kind).toBe("blocked");
    expect(classifyChatMediaSource("data:text/html,<script>").kind).toBe("blocked");
    expect(classifyChatMediaSource("relative.png").kind).toBe("blocked");
  });
  it("uses actual expiry and rejects signed URL origin changes", () => {
    expect(assetRefreshDelay(100_000, 50_000)).toBe(20_000);
    expect(assetRefreshDelay(100, 1000)).toBe(1000);
    expect(resolveSignedAssetUrl("http://localhost:3000", "/assets/signed?a=b")).toBe(
      "http://localhost:3000/assets/signed?a=b",
    );
    expect(() => resolveSignedAssetUrl("http://localhost:3000", "https://other.test/x")).toThrow();
  });
});

describe("pinned Codex file citations", () => {
  it("validates native assistant quotes and rejects malformed selectors", () => {
    const href = "t3-citation://v1/env/thread/message?text=hello&start=0&end=5&prefix=&suffix=";
    expect(parseChatAssistantCitation(href)?.text).toBe("hello");
    expect(parseChatAssistantCitation(href.replace("end=5", "end=0"))).toBeNull();
    expect(parseChatAssistantCitation(`${href}&text=duplicate`)).toBeNull();
  });
  it("retains native path and positive line semantics", () => {
    expect(
      renderRichOutput(':codex-file-citation{path="/tmp/a#b.ts" line_range_start="12"}'),
    ).toContain('href="/tmp/a%23b.ts#L12">a#b.ts</a>');
    expect(renderRichOutput(':codex-file-citation{path="a.ts" line_range_start="-1"}')).toContain(
      'href="a.ts">a.ts</a>',
    );
  });
  it("keeps code, existing links, and malformed directives untouched", () => {
    const source = ':codex-file-citation{path="/tmp/a.ts"}';
    expect(renderRichOutput(source)).toContain('href="/tmp/a.ts"');
    for (const example of [
      `\`${source}\``,
      `[${source}](https://example.com)`,
      ':codex-file-citation{purpose="output"}',
    ]) {
      expect(renderRichOutput(example)).not.toContain('href="/tmp/a.ts"');
      expect(renderRichOutput(example)).toContain("codex-file-citation");
    }
  });
});

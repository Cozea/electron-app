import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const chatSurface = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/assistant/chat/CozeaChatSurface.tsx",
  ),
  "utf8",
);

describe("agent chat composer layout", () => {
  it("keeps one editor subtree while the surface reflows", () => {
    expect(chatSurface.match(/<ComposerPromptEditor\b/g)).toHaveLength(1);
    expect(chatSurface).toContain(
      'data-chat-composer-layout={isStackedComposer ? "stacked" : "inline"}',
    );
    expect(chatSurface).toContain('"items-center gap-1.5 rounded-full p-1.5"');
    expect(chatSurface).toContain('"order-2 basis-full px-1 py-0.5"');
    expect(chatSurface).toContain(
      "const composerSuppressed = !props.workspaceId || hasProviderBanner",
    );
  });
});

import { describe, expect, it } from "vitest";

import { createCodexLiveSession } from "../../../../apps/desktop/electron/substrate/providers/drivers/codexLiveSession";

describe("createCodexLiveSession", () => {
  it("uses injected sendTurn hook without spawning app-server", async () => {
    const live = createCodexLiveSession(
      { binaryPath: "codex" },
      {
        sendTurn: async (input) => ({
          turnId: "turn-test",
          replyText: `echo:${input.text}`,
          status: "completed",
        }),
      },
    );

    const result = await live.sendTurn({ text: "hello codex" });
    expect(result.status).toBe("completed");
    expect(result.replyText).toBe("echo:hello codex");
    await live.dispose();
  });
});

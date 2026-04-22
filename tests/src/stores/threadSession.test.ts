import { describe, expect, it } from "vitest";
import { ThreadId } from "@cozea/assistant-contracts";

import { normalizeThreadSession } from "../../../src/stores/threadSession";

describe("normalizeThreadSession", () => {
  it("preserves supported provider kinds from orchestration sessions", () => {
    const session = normalizeThreadSession({
      threadId: ThreadId.makeUnsafe("thread-1"),
      status: "ready",
      providerName: "cursor",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(session?.provider).toBe("cursor");
  });

  it("falls back to codex for invalid persisted providers", () => {
    const session = normalizeThreadSession({
      threadId: ThreadId.makeUnsafe("thread-1"),
      status: "ready",
      providerName: "not-a-provider",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(session?.provider).toBe("codex");
  });
});

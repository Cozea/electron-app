import { describe, expect, it } from "vitest";
import { ThreadId } from "@cozea/assistant-contracts";

import { normalizeThreadSession } from "@/features/assistant/model/threadSession";

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

  it("preserves interrupted and stopped orchestration statuses", () => {
    const interrupted = normalizeThreadSession({
      threadId: ThreadId.makeUnsafe("thread-1"),
      status: "interrupted",
      providerName: "cursor",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const stopped = normalizeThreadSession({
      threadId: ThreadId.makeUnsafe("thread-1"),
      status: "stopped",
      providerName: "cursor",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(interrupted?.status).toBe("interrupted");
    expect(stopped?.status).toBe("stopped");
  });
});

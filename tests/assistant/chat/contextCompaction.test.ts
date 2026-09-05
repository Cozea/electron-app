import { describe, expect, it } from "vitest";
import { compactionUnavailableReason } from "@/features/assistant/chat/contextCompaction";
import { MessageId } from "@cozea/assistant-contracts";
const eligible = {
  provider: { slashCommands: [{ name: "compact", description: "Compact" }] },
  thread: {
    messages: [
      {
        id: MessageId.makeUnsafe("message"),
        role: "user" as const,
        text: "Keep this history",
        createdAt: "2026-09-05T00:00:00Z",
        streaming: false,
      },
    ],
  },
  ready: true,
  busy: false,
  hasPendingRequests: false,
};
describe("context compaction eligibility", () => {
  it("uses the selected instance's advertised capability", () => {
    expect(compactionUnavailableReason(eligible)).toBeNull();
    expect(
      compactionUnavailableReason({ ...eligible, provider: { slashCommands: [{ name: "plan" }] } }),
    ).toMatch(/does not support/);
    expect(compactionUnavailableReason({ ...eligible, provider: null })).toMatch(
      /does not support/,
    );
  });
  it("requires existing history, a ready connection, and no operation or pending request", () => {
    expect(compactionUnavailableReason({ ...eligible, thread: { messages: [] } })).toMatch(
      /Send a message/,
    );
    expect(compactionUnavailableReason({ ...eligible, ready: false })).toMatch(/Reconnect/);
    expect(compactionUnavailableReason({ ...eligible, busy: true })).toMatch(/Wait/);
    expect(compactionUnavailableReason({ ...eligible, hasPendingRequests: true })).toMatch(
      /pending/,
    );
  });
});

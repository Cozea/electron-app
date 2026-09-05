import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageId } from "@cozea/assistant-contracts";
import {
  currentTextArrivalRevision,
  getMessageTextArrival,
  markLiveText,
  markSnapshotText,
} from "@/features/assistant/model/messageTextArrival";
import type { ChatMessage } from "@/features/assistant/model/types";
import { useThreadDetailStore } from "@/features/assistant/model/threadDetailStore";

function message(text: string): ChatMessage {
  return {
    id: MessageId.makeUnsafe("answer"),
    role: "assistant",
    text,
    createdAt: "2026-09-05T00:00:00Z",
    streaming: true,
  };
}

beforeEach(() => useThreadDetailStore.setState({ byThreadId: {} }));
afterEach(() => vi.restoreAllMocks());

describe("transient message arrival metadata", () => {
  it("tracks snapshot provenance without adding serializable message fields", () => {
    const initial = message("Snapshot");
    const serialized = JSON.stringify(initial);
    markSnapshotText([initial]);
    const snapshot = getMessageTextArrival(initial)!;
    expect(snapshot.source).toBe("snapshot");
    const next = message("Snapshot live suffix");
    markLiveText(next, initial);
    expect(getMessageTextArrival(next)).toMatchObject({
      source: "live",
      snapshot: { text: "Snapshot", revision: snapshot.revision },
    });
    expect(JSON.stringify(initial)).toBe(serialized);
    expect(getMessageTextArrival(JSON.parse(serialized))).toBeUndefined();
  });

  it("bounds old arrival batches while retaining the oldest overdue prefix", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let previous: ChatMessage | undefined;
    for (let i = 0; i < 1_000; i++) {
      now = i * 10;
      const next = message("x".repeat(i + 1));
      markLiveText(next, previous);
      previous = next;
    }
    const arrival = getMessageTextArrival(previous!)!;
    expect(arrival.batches!.length).toBeLessThanOrEqual(26);
    expect(arrival.batches![0]!.end).toBe(975);
    expect(arrival.batches!.at(-1)!.end).toBe(1000);
  });

  it("does not treat rejected stale snapshots as new display baselines", () => {
    const store = useThreadDetailStore.getState();
    store.ingestSnapshot("thread", {
      snapshotSequence: 9,
      thread: { messages: [message("Current")] },
    });
    const current = store.getThreadDetail("thread")!.messages[0]!;
    const revision = currentTextArrivalRevision();
    store.ingestSnapshot("thread", {
      snapshotSequence: 8,
      thread: { messages: [message("Stale")] },
    });
    expect(store.getThreadDetail("thread")!.messages[0]).toBe(current);
    expect(currentTextArrivalRevision()).toBe(revision);
    expect(getMessageTextArrival(current)?.source).toBe("snapshot");
  });
});

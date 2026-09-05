import { beforeEach, describe, expect, it } from "vitest";
import type { OrchestrationEvent } from "@cozea/assistant-contracts";
import { useThreadDetailStore } from "@/features/assistant/model/threadDetailStore";
import { getMessageTextArrival } from "@/features/assistant/model/messageTextArrival";

const timestamp = "2026-09-05T08:00:00.000Z";
const plan = (id: string, turnId: string | null) => ({
  id,
  turnId,
  planMarkdown: id,
  createdAt: timestamp,
  updatedAt: timestamp,
  implementedAt: null,
  implementationThreadId: null,
});
const message = (id: string, turnId: string | null, role = "assistant") => ({
  id,
  turnId,
  role,
  text: id,
  createdAt: timestamp,
  updatedAt: timestamp,
  streaming: false,
});
function apply(sequence: number, type: string, payload: unknown) {
  useThreadDetailStore.getState().applyEvent("thread", {
    sequence,
    type,
    payload,
    occurredAt: timestamp,
  } as OrchestrationEvent);
}
const detail = () => useThreadDetailStore.getState().getThreadDetail("thread")!;

describe("pinned thread detail parity", () => {
  it.each(["ready", "interrupted", "error", "stopped"])(
    "restores settled %s snapshots without a final text event",
    (status) => {
      useThreadDetailStore.getState().ingestSnapshot("snapshot-terminal", {
        snapshotSequence: 1,
        thread: {
          session: { status, updatedAt: timestamp },
          latestTurn: {
            turnId: "turn",
            state: "running",
            requestedAt: timestamp,
            startedAt: timestamp,
            completedAt: null,
            assistantMessageId: "stream",
          },
          messages: [
            { ...message("stream", "turn"), streaming: true },
            message("complete", "older"),
          ],
        },
      });
      const restored = useThreadDetailStore.getState().getThreadDetail("snapshot-terminal")!;
      expect(restored.isStreaming).toBe(false);
      expect(restored.messages.map((m) => m.streaming)).toEqual([false, false]);
      expect(restored.messages[0]?.completedAt).toBe(timestamp);
      expect(restored.canonical.latestTurn?.state).toBe(
        status === "ready" ? "completed" : status === "stopped" ? "interrupted" : status,
      );
      useThreadDetailStore.getState().resetThread("snapshot-terminal");
      expect(useThreadDetailStore.getState().getThreadDetail("snapshot-terminal")).toBeNull();
    },
  );

  it.each(["thread.session-stop-requested", "thread.turn-interrupt-requested"])(
    "closes text immediately on %s",
    (type) => {
      apply(1, "thread.session-set", {
        session: { status: "running", activeTurnId: "turn", updatedAt: timestamp },
      });
      apply(2, "thread.message-sent", { ...message("m", "turn"), messageId: "m", streaming: true });
      apply(3, type, { turnId: "turn", createdAt: timestamp });
      expect(detail()).toMatchObject({ isStreaming: false });
      expect(detail().messages[0]).toMatchObject({
        text: "m",
        streaming: false,
        completedAt: timestamp,
      });
    },
  );

  it("does not close the newer turn on an older turn interrupt request", () => {
    apply(1, "thread.session-set", {
      session: { status: "running", activeTurnId: "new", updatedAt: timestamp },
    });
    apply(2, "thread.message-sent", { ...message("m", "new"), messageId: "m", streaming: true });
    const live = detail().messages[0];
    apply(3, "thread.turn-interrupt-requested", { turnId: "old", createdAt: timestamp });
    expect(detail().messages[0]).toBe(live);
    expect(detail().messages[0]?.streaming).toBe(true);
    expect(detail().isStreaming).toBe(true);
  });
  beforeEach(() =>
    useThreadDetailStore.setState({ byThreadId: {}, deletedSequenceByThreadId: {} }),
  );

  it("upserts plans with sparse sequences and rejects stale replay", () => {
    useThreadDetailStore.getState().ingestSnapshot("thread", {
      snapshotSequence: 10,
      thread: { proposedPlans: [plan("a", "turn-a")] },
    });
    apply(40, "thread.proposed-plan-upserted", {
      proposedPlan: { ...plan("a", "turn-a"), planMarkdown: "revised" },
    });
    apply(20, "thread.proposed-plan-upserted", { proposedPlan: plan("a", "turn-a") });
    expect(detail().proposedPlans.map((p) => p.planMarkdown)).toEqual(["revised"]);
    expect(detail().lastSequence).toBe(40);
  });

  it("reverts all detail collections while retaining system and unbound messages", () => {
    useThreadDetailStore.getState().ingestSnapshot("thread", {
      snapshotSequence: 1,
      thread: {
        messages: [
          message("system", "turn-b", "system"),
          message("unbound", null, "user"),
          message("a", "turn-a"),
          message("b", "turn-b"),
        ],
        proposedPlans: [plan("unbound", null), plan("a", "turn-a"), plan("b", "turn-b")],
        activities: ["turn-a", "turn-b"].map((turnId) => ({
          id: turnId,
          turnId,
          kind: "tool.call",
          tone: "tool",
          payload: {},
          createdAt: timestamp,
        })),
        checkpoints: ["turn-a", "turn-b"].map((turnId, i) => ({
          turnId,
          checkpointTurnCount: i + 1,
          completedAt: timestamp,
          files: [],
        })),
      },
    });
    apply(5, "thread.reverted", { turnCount: 1 });
    expect(detail().messages.map((m) => m.id)).toEqual(["system", "unbound", "a"]);
    expect(detail().proposedPlans.map((p) => p.id)).toEqual(["unbound", "a"]);
    expect(detail().activities.map((a) => a.id)).toEqual(["turn-a"]);
    expect(detail().turnDiffSummaries.map((d) => d.turnId)).toEqual(["turn-a"]);
    apply(9, "thread.reverted", { turnCount: 0 });
    expect(detail().messages.map((m) => m.id)).toEqual(["system", "unbound"]);
    expect(detail().activities).toEqual([]);
    expect(detail().turnDiffSummaries).toEqual([]);
  });

  it("records empty snapshot authority independently of sparse live revisions", () => {
    apply(4, "thread.message-sent", { ...message("m", null), messageId: "m" });
    expect(detail()).toMatchObject({ loaded: false, snapshotSequence: null, lastSequence: 4 });
    useThreadDetailStore
      .getState()
      .ingestSnapshot("thread", { snapshotSequence: 10, thread: { messages: [] } });
    expect(detail()).toMatchObject({
      loaded: true,
      snapshotSequence: 10,
      lastSequence: 10,
      messages: [],
    });
    apply(40, "thread.proposed-plan-upserted", { proposedPlan: plan("p", null) });
    useThreadDetailStore.getState().ingestSnapshot("thread", {
      snapshotSequence: 20,
      thread: { messages: [message("stale", null)] },
    });
    expect(detail()).toMatchObject({
      loaded: true,
      snapshotSequence: 10,
      lastSequence: 40,
      messages: [],
    });
    useThreadDetailStore.getState().resetThread("thread");
    apply(1, "thread.proposed-plan-upserted", { proposedPlan: plan("new", null) });
    expect(detail()).toMatchObject({ loaded: false, snapshotSequence: null, lastSequence: 1 });
  });

  it("keeps native attachment variants and snapshot/live provenance with stable unrelated messages", () => {
    const attachments = [
      { type: "image", id: "image", name: "image.png", mimeType: "image/png", sizeBytes: 1 },
      { type: "file", id: "file", name: "file.pdf", mimeType: "application/pdf", sizeBytes: 2 },
      { type: "audio", id: "audio", name: "audio.wav", mimeType: "audio/wav", sizeBytes: 3 },
    ];
    useThreadDetailStore.getState().ingestSnapshot("thread", {
      snapshotSequence: 1,
      thread: {
        messages: [{ ...message("one", null), attachments }, message("two", null)],
      },
    });
    const first = detail().messages[0]!;
    const second = detail().messages[1]!;
    expect(first.attachments?.map((a) => a.type)).toEqual(["image", "file", "unsupported"]);
    expect(first.attachments?.[2]).toMatchObject({ originalType: "audio" });
    expect(detail().canonical.messages[0]?.attachments?.map((a) => a.type)).toEqual([
      "image",
      "file",
      "audio",
    ]);
    expect(getMessageTextArrival(first)?.source).toBe("snapshot");
    apply(3, "thread.message-sent", {
      ...message("one", null),
      messageId: "one",
      text: " tail",
      streaming: true,
    });
    expect(detail().messages[1]).toBe(second);
    expect(detail().messages[0]?.text).toBe("one tail");
    expect(getMessageTextArrival(detail().messages[0]!)?.source).toBe("live");
    expect(getMessageTextArrival(detail().messages[0]!)?.snapshot?.text).toBe("one");
    apply(5, "thread.message-sent", {
      ...message("one", null),
      messageId: "one",
      text: "replacement",
      attachments: [],
    });
    expect(detail().messages[0]).toMatchObject({ text: "replacement", attachments: [] });
    const stable = detail().messages;
    apply(8, "thread.proposed-plan-upserted", { proposedPlan: plan("p", null) });
    expect(detail().messages).toBe(stable);
  });

  it("accepts old-turn text without changing the newer running turn", () => {
    apply(1, "thread.session-set", {
      session: { status: "running", activeTurnId: "old", updatedAt: timestamp },
    });
    apply(2, "thread.message-sent", {
      ...message("old-message", "old"),
      messageId: "old-message",
      streaming: true,
    });
    apply(4, "thread.session-set", {
      session: { status: "interrupted", activeTurnId: null, updatedAt: timestamp },
    });
    apply(6, "thread.session-set", {
      session: { status: "running", activeTurnId: "new", updatedAt: timestamp },
    });
    const latest = detail().canonical.latestTurn;
    apply(8, "thread.message-sent", {
      ...message("old-message", "old"),
      messageId: "old-message",
      streaming: true,
      text: " late",
    });
    expect(detail().canonical.latestTurn).toBe(latest);
    expect(detail().isStreaming).toBe(true);
    expect(detail().messages[0]).toMatchObject({ text: "old-message late", streaming: false });
  });

  it("retains full native snapshot metadata and rejects another thread's snapshot", () => {
    const native = {
      id: "thread",
      projectId: "project",
      title: "Native",
      modelSelection: { provider: "codex", model: "fixture" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      latestTurn: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      messages: [message("native", null)],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    };
    useThreadDetailStore
      .getState()
      .ingestSnapshot("thread", { snapshotSequence: 10, thread: native });
    expect(detail().canonical).toMatchObject({
      title: "Native",
      projectId: "project",
      branch: "main",
    });
    const accepted = detail();
    useThreadDetailStore
      .getState()
      .ingestSnapshot("thread", { snapshotSequence: 20, thread: { ...native, id: "other" } });
    expect(detail()).toBe(accepted);
  });

  it("does not resurrect deleted detail from late chunks or stale snapshots", () => {
    apply(1, "thread.message-sent", { ...message("m", null), messageId: "m" });
    apply(10, "thread.deleted", {});
    apply(12, "thread.message-sent", {
      ...message("m", null),
      messageId: "m",
      text: "late",
      streaming: true,
    });
    useThreadDetailStore.getState().ingestSnapshot("thread", {
      snapshotSequence: 9,
      thread: { messages: [message("m", null)] },
    });
    expect(useThreadDetailStore.getState().getThreadDetail("thread")).toBeNull();
    useThreadDetailStore
      .getState()
      .ingestSnapshot("thread", { snapshotSequence: 20, thread: { messages: [] } });
    expect(detail()).toMatchObject({ loaded: true, snapshotSequence: 20, messages: [] });
  });
});

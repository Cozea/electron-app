import { describe, expect, it, beforeEach } from "vitest";
import { useThreadDetailStore } from "../../apps/desktop/src/stores/threadDetailStore";

describe("threadDetailStore", () => {
  beforeEach(() => {
    useThreadDetailStore.setState({ byThreadId: {} });
  });

  it("ingests an initial thread detail snapshot", () => {
    const threadId = "th-test-123";
    const snapshot = {
      threadId,
      messages: [
        {
          id: "msg-1",
          role: "user",
          text: "Initial prompt",
          createdAt: "2026-08-27T10:00:00.000Z",
          streaming: false,
        },
        {
          id: "msg-2",
          role: "assistant",
          text: "Initial answer",
          createdAt: "2026-08-27T10:00:05.000Z",
          streaming: false,
        },
      ],
      activities: [
        {
          id: "act-1",
          kind: "tool.call",
          summary: "Reading file",
          createdAt: "2026-08-27T10:00:02.000Z",
        },
      ],
      checkpoints: [
        {
          turnId: "turn-1",
          status: "ready",
          completedAt: "2026-08-27T10:00:05.000Z",
          files: [{ path: "src/index.ts", additions: 5, deletions: 2 }],
        },
      ],
    };

    useThreadDetailStore.getState().ingestSnapshot(threadId, snapshot);

    const detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(detail).not.toBeNull();
    expect(detail?.messages).toHaveLength(2);
    expect(detail?.messages[0]?.text).toBe("Initial prompt");
    expect(detail?.activities).toHaveLength(1);
    expect(detail?.turnDiffSummaries).toHaveLength(1);
    expect(detail?.turnDiffSummaries[0]?.files[0]?.path).toBe("src/index.ts");
  });

  it("concatenates streaming message deltas in-place", () => {
    const threadId = "th-stream-1";

    // First chunk
    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.message-sent",
      sequence: 1,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        threadId,
        messageId: "msg-assistant-1",
        role: "assistant",
        text: "Hello",
        streaming: true,
        createdAt: "2026-08-27T10:00:00.000Z",
      },
    } as any);

    let detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(detail?.messages).toHaveLength(1);
    expect(detail?.messages[0]?.text).toBe("Hello");
    expect(detail?.messages[0]?.streaming).toBe(true);
    expect(detail?.isStreaming).toBe(true);

    // Second chunk
    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.message-sent",
      sequence: 2,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        threadId,
        messageId: "msg-assistant-1",
        role: "assistant",
        text: ", world!",
        streaming: true,
        createdAt: "2026-08-27T10:00:01.000Z",
      },
    } as any);

    detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(detail?.messages).toHaveLength(1);
    expect(detail?.messages[0]?.text).toBe("Hello, world!");
    expect(detail?.messages[0]?.streaming).toBe(true);

    // Final chunk closing stream
    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.message-sent",
      sequence: 3,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        threadId,
        messageId: "msg-assistant-1",
        role: "assistant",
        text: "",
        streaming: false,
        updatedAt: "2026-08-27T10:00:02.000Z",
      },
    } as any);

    detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(detail?.messages).toHaveLength(1);
    expect(detail?.messages[0]?.text).toBe("Hello, world!");
    expect(detail?.messages[0]?.streaming).toBe(false);
    expect(detail?.isStreaming).toBe(false);
  });

  it("appends activities and checkpoints", () => {
    const threadId = "th-act-1";

    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.activity-appended",
      sequence: 1,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        activityId: "act-101",
        kind: "tool.call",
        summary: "Running tests",
        createdAt: "2026-08-27T10:00:00.000Z",
      },
    } as any);

    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.turn-diff-completed",
      sequence: 2,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        turnId: "turn-99",
        status: "ready",
        completedAt: "2026-08-27T10:00:05.000Z",
        files: [{ path: "app.ts", additions: 10, deletions: 0 }],
      },
    } as any);

    const detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(detail?.activities).toHaveLength(1);
    expect(detail?.activities[0]?.summary).toBe("Running tests");
    expect(detail?.turnDiffSummaries).toHaveLength(1);
    expect(detail?.turnDiffSummaries[0]?.files[0]?.path).toBe("app.ts");
  });
});

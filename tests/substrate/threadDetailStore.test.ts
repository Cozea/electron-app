import { describe, expect, it, beforeEach } from "vitest";
import { useThreadDetailStore } from "../../apps/desktop/src/stores/threadDetailStore";
import { deriveGenerationStatusPhase } from "../../apps/desktop/src/features/assistant/chat/MessagesTimeline.logic";

describe("threadDetailStore", () => {
  beforeEach(() => {
    useThreadDetailStore.setState({ byThreadId: {} });
  });

  it("ingests the T3 thread detail snapshot envelope", () => {
    const threadId = "th-test-123";
    const snapshot = {
      snapshotSequence: 42,
      thread: {
        threadId,
        session: {
          status: "ready",
          lastError: null,
        },
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
            tone: "tool",
            kind: "tool.call",
            summary: "Reading file",
            payload: {
              itemType: "command_execution",
              status: "completed",
              detail: "/bin/zsh -lc 'pwd'",
            },
            sequence: 40,
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
      },
    };

    useThreadDetailStore.getState().ingestSnapshot(threadId, snapshot);

    const detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(detail).not.toBeNull();
    expect(detail?.lastSequence).toBe(42);
    expect(detail?.messages).toHaveLength(2);
    expect(detail?.messages[0]?.text).toBe("Initial prompt");
    expect(detail?.activities).toHaveLength(1);
    expect(detail?.activities[0]).toMatchObject({
      tone: "tool",
      sequence: 40,
      payload: {
        itemType: "command_execution",
        status: "completed",
        detail: "/bin/zsh -lc 'pwd'",
      },
    });
    expect(detail?.turnDiffSummaries).toHaveLength(1);
    expect(detail?.turnDiffSummaries[0]?.files[0]?.path).toBe("src/index.ts");
  });

  it("restores and advances provider reasoning lifecycle across a snapshot reconnect", () => {
    const threadId = "th-reasoning-reconnect";
    const turnId = "turn-reasoning";
    useThreadDetailStore.getState().ingestSnapshot(threadId, {
      snapshotSequence: 4,
      thread: {
        session: { status: "running", activeTurnId: turnId, lastError: null },
        messages: [],
        activities: [
          {
            id: "reasoning-start",
            tone: "info",
            kind: "reasoning.started",
            summary: "Reasoning started",
            payload: { provider: "codex" },
            turnId,
            sequence: 3,
            createdAt: "2026-08-27T10:00:00.000Z",
          },
        ],
      },
    });

    let detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(deriveGenerationStatusPhase(detail?.activities ?? [], turnId as any)).toBe("thinking");

    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.activity-appended",
      sequence: 5,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        activity: {
          id: "reasoning-complete",
          tone: "info",
          kind: "reasoning.completed",
          summary: "Reasoning completed",
          payload: { provider: "codex" },
          turnId,
          sequence: 4,
          createdAt: "2026-08-27T10:00:01.000Z",
        },
      },
    } as any);

    detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(deriveGenerationStatusPhase(detail?.activities ?? [], turnId as any)).toBe("working");
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

    // Final chunk closes the message, but the aggregate turn remains active
    // until T3 emits a terminal turn/session event.
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
    expect(detail?.isStreaming).toBe(true);

    // A checkpoint can be emitted mid-turn while the provider is still
    // running, so it is not the authoritative completion signal.
    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.turn-diff-completed",
      sequence: 4,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        turnId: "turn-1",
        status: "ready",
        completedAt: "2026-08-27T10:00:03.000Z",
        files: [],
      },
    } as any);

    detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(detail?.isStreaming).toBe(true);

    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.session-set",
      sequence: 5,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        threadId,
        session: {
          status: "ready",
          lastError: null,
        },
      },
    } as any);

    detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(detail?.isStreaming).toBe(false);
  });

  it("keeps the turn active when a completed message is followed by tool work", () => {
    const threadId = "th-tool-after-message";

    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.turn-start-requested",
      sequence: 1,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: { threadId },
    } as any);

    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.message-sent",
      sequence: 2,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        threadId,
        messageId: "msg-preamble",
        role: "assistant",
        text: "Running the requested command now.",
        streaming: false,
        createdAt: "2026-08-27T10:00:00.000Z",
      },
    } as any);

    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.activity-appended",
      sequence: 3,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        activityId: "act-sleep",
        kind: "tool.call",
        summary: "Running command",
        createdAt: "2026-08-27T10:00:01.000Z",
      },
    } as any);

    expect(useThreadDetailStore.getState().getThreadDetail(threadId)?.isStreaming).toBe(true);
  });

  it("replaces accumulated text when the final event contains the complete message", () => {
    const threadId = "th-stream-final";

    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.message-sent",
      sequence: 1,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        threadId,
        messageId: "msg-assistant-final",
        role: "assistant",
        text: "Partial",
        streaming: true,
        createdAt: "2026-08-27T10:00:00.000Z",
      },
    } as any);

    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.message-sent",
      sequence: 2,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        threadId,
        messageId: "msg-assistant-final",
        role: "assistant",
        text: "Partial response complete.",
        streaming: false,
        updatedAt: "2026-08-27T10:00:02.000Z",
      },
    } as any);

    const detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(detail?.messages[0]?.text).toBe("Partial response complete.");
    expect(detail?.messages[0]?.streaming).toBe(false);
  });

  it("ignores replayed events already included in the snapshot", () => {
    const threadId = "th-replay";
    useThreadDetailStore.getState().ingestSnapshot(threadId, {
      snapshotSequence: 10,
      thread: {
        messages: [
          {
            id: "msg-replay",
            role: "assistant",
            text: "Already persisted",
            createdAt: "2026-08-27T10:00:00.000Z",
            streaming: true,
          },
        ],
      },
    });

    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.message-sent",
      sequence: 10,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        threadId,
        messageId: "msg-replay",
        role: "assistant",
        text: "Already persisted",
        streaming: true,
        createdAt: "2026-08-27T10:00:00.000Z",
      },
    } as any);

    const detail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(detail?.messages[0]?.text).toBe("Already persisted");
    expect(detail?.lastSequence).toBe(10);

    useThreadDetailStore.getState().applyEvent(threadId, {
      type: "thread.message-sent",
      sequence: 11,
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        threadId,
        messageId: "msg-replay",
        role: "assistant",
        text: " and now live",
        streaming: true,
        createdAt: "2026-08-27T10:00:01.000Z",
      },
    } as any);

    const updatedDetail = useThreadDetailStore.getState().getThreadDetail(threadId);
    expect(updatedDetail?.messages[0]?.text).toBe("Already persisted and now live");
    expect(updatedDetail?.lastSequence).toBe(11);
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

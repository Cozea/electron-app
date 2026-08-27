import { describe, expect, it, beforeEach } from "vitest";
import { useThreadDetailStore } from "../../apps/desktop/src/stores/threadDetailStore";

describe("multiTileConcurrency", () => {
  beforeEach(() => {
    useThreadDetailStore.setState({ byThreadId: {} });
  });

  it("isolates simultaneous streaming across multiple threads", () => {
    const thread1 = "th-claude-alpha";
    const thread2 = "th-codex-beta";

    // 1. Initial user messages for both threads
    useThreadDetailStore.getState().applyEvent(thread1, {
      type: "thread.message-sent",
      sequence: 1,
      aggregateKind: "thread",
      aggregateId: thread1,
      payload: {
        threadId: thread1,
        messageId: "msg-user-1",
        role: "user",
        text: "Prompt for Claude",
        streaming: false,
        createdAt: "2026-08-27T12:00:00.000Z",
      },
    } as any);

    useThreadDetailStore.getState().applyEvent(thread2, {
      type: "thread.message-sent",
      sequence: 2,
      aggregateKind: "thread",
      aggregateId: thread2,
      payload: {
        threadId: thread2,
        messageId: "msg-user-2",
        role: "user",
        text: "Prompt for Codex",
        streaming: false,
        createdAt: "2026-08-27T12:00:00.000Z",
      },
    } as any);

    // 2. Interleaved streaming chunks from both providers
    useThreadDetailStore.getState().applyEvent(thread1, {
      type: "thread.message-sent",
      sequence: 3,
      aggregateKind: "thread",
      aggregateId: thread1,
      payload: {
        threadId: thread1,
        messageId: "msg-asst-1",
        role: "assistant",
        text: "Claude chunk 1",
        streaming: true,
        createdAt: "2026-08-27T12:00:01.000Z",
      },
    } as any);

    useThreadDetailStore.getState().applyEvent(thread2, {
      type: "thread.message-sent",
      sequence: 4,
      aggregateKind: "thread",
      aggregateId: thread2,
      payload: {
        threadId: thread2,
        messageId: "msg-asst-2",
        role: "assistant",
        text: "Codex chunk A",
        streaming: true,
        createdAt: "2026-08-27T12:00:01.000Z",
      },
    } as any);

    useThreadDetailStore.getState().applyEvent(thread1, {
      type: "thread.message-sent",
      sequence: 5,
      aggregateKind: "thread",
      aggregateId: thread1,
      payload: {
        threadId: thread1,
        messageId: "msg-asst-1",
        role: "assistant",
        text: " + Claude chunk 2",
        streaming: false,
        updatedAt: "2026-08-27T12:00:02.000Z",
      },
    } as any);

    useThreadDetailStore.getState().applyEvent(thread2, {
      type: "thread.message-sent",
      sequence: 6,
      aggregateKind: "thread",
      aggregateId: thread2,
      payload: {
        threadId: thread2,
        messageId: "msg-asst-2",
        role: "assistant",
        text: " + Codex chunk B",
        streaming: false,
        updatedAt: "2026-08-27T12:00:02.000Z",
      },
    } as any);

    // 3. Assert complete isolation
    const detail1 = useThreadDetailStore.getState().getThreadDetail(thread1);
    const detail2 = useThreadDetailStore.getState().getThreadDetail(thread2);

    expect(detail1?.messages).toHaveLength(2);
    expect(detail1?.messages[0]?.text).toBe("Prompt for Claude");
    expect(detail1?.messages[1]?.text).toBe("Claude chunk 1 + Claude chunk 2");
    expect(detail1?.messages[1]?.streaming).toBe(false);

    expect(detail2?.messages).toHaveLength(2);
    expect(detail2?.messages[0]?.text).toBe("Prompt for Codex");
    expect(detail2?.messages[1]?.text).toBe("Codex chunk A + Codex chunk B");
    expect(detail2?.messages[1]?.streaming).toBe(false);
  });

  it("handles deletion of one thread without corrupting other active threads", () => {
    const thread1 = "th-kill-me";
    const thread2 = "th-keep-me";

    useThreadDetailStore.getState().ingestSnapshot(thread1, {
      threadId: thread1,
      messages: [{ id: "m1", role: "user", text: "temp" }],
      activities: [],
      checkpoints: [],
    });

    useThreadDetailStore.getState().ingestSnapshot(thread2, {
      threadId: thread2,
      messages: [{ id: "m2", role: "user", text: "permanent" }],
      activities: [],
      checkpoints: [],
    });

    useThreadDetailStore.getState().resetThread(thread1);

    expect(useThreadDetailStore.getState().getThreadDetail(thread1)).toBeNull();
    const keepDetail = useThreadDetailStore.getState().getThreadDetail(thread2);
    expect(keepDetail).not.toBeNull();
    expect(keepDetail?.messages[0]?.text).toBe("permanent");
  });
});

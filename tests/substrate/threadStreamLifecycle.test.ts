import { beforeEach, expect, it, vi } from "vitest";
import { createThreadStreamConsumer } from "@/substrate/useTileThreadStream";
import { useThreadDetailStore } from "@/features/assistant/model/threadDetailStore";
import { superviseSubscription } from "@/substrate/subscriptionSupervisor";

beforeEach(() => useThreadDetailStore.setState({ byThreadId: {}, deletedSequenceByThreadId: {} }));
const attempt = () => ({
  isCurrent: vi.fn(() => true),
  ready: vi.fn(),
  disconnected: vi.fn(),
  own: vi.fn(),
});
const snapshot = (sequence: number, id = "t") => ({
  kind: "snapshot",
  snapshot: {
    snapshotSequence: sequence,
    thread: {
      id,
      messages: [],
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      session: null,
      latestTurn: null,
    },
  },
});

it("accepts empty authoritative snapshots and rejects a regressing reconnect snapshot", () => {
  const first = attempt();
  createThreadStreamConsumer("t", first)(snapshot(10));
  expect(first.ready).toHaveBeenCalledOnce();
  expect(useThreadDetailStore.getState().getThreadDetail("t")?.loaded).toBe(true);
  const next = attempt();
  createThreadStreamConsumer("t", next)(snapshot(9));
  expect(next.ready).not.toHaveBeenCalled();
  expect(next.disconnected).toHaveBeenCalledOnce();
});

it("rejects mismatched identity even when its revision equals an existing snapshot", () => {
  createThreadStreamConsumer("t", attempt())(snapshot(10));
  const next = attempt();
  createThreadStreamConsumer("t", next)(snapshot(10, "other"));
  expect(next.ready).not.toHaveBeenCalled();
  expect(next.disconnected).toHaveBeenCalledOnce();
});

it("does not mark tombstoned snapshots ready", () => {
  useThreadDetailStore.setState({ deletedSequenceByThreadId: { t: 11 } });
  const next = attempt();
  createThreadStreamConsumer("t", next)(snapshot(10));
  expect(next.ready).not.toHaveBeenCalled();
  expect(next.disconnected).toHaveBeenCalledOnce();
});

it("recovers from event-before-snapshot and ignores disposed generations", () => {
  const next = attempt();
  const consume = createThreadStreamConsumer("t", next);
  consume({ kind: "event", event: { sequence: 12 } });
  expect(next.disconnected).toHaveBeenCalledOnce();
  next.isCurrent.mockReturnValue(false);
  consume(snapshot(12));
  expect(next.ready).not.toHaveBeenCalled();
  expect(useThreadDetailStore.getState().getThreadDetail("t")).toBeNull();
});

it.each(["session", "revert"])(
  "reacquires a snapshot after a %s boundary error without advancing the cursor",
  async (kind) => {
    vi.useFakeTimers();
    let attempts = 0;
    let consume!: ReturnType<typeof createThreadStreamConsumer>;
    const status = vi.fn();
    const stop = superviseSubscription({
      status,
      connect: async (attempt) => {
        attempts += 1;
        consume = createThreadStreamConsumer("t", attempt);
        const initial = snapshot(attempts === 1 ? 10 : 12);
        consume(
          attempts === 1 && kind === "revert"
            ? {
                ...initial,
                snapshot: {
                  ...initial.snapshot,
                  thread: {
                    ...initial.snapshot.thread,
                    checkpoints: [{ turnId: "turn", completedAt: "2026-09-05T00:00:00Z" }],
                  },
                },
              }
            : initial,
        );
      },
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      const previous = useThreadDetailStore.getState().getThreadDetail("t");
      consume({
        kind: "event",
        event: {
          sequence: 11,
          occurredAt: "2026-09-05T00:00:00Z",
          type: kind === "session" ? "thread.session-set" : "thread.reverted",
          payload: kind === "session" ? { session: null } : { turnCount: 1 },
        },
      });
      expect(useThreadDetailStore.getState().getThreadDetail("t")).toBe(previous);
      expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "error" }));
      // Old generation cannot publish while the retry waits.
      consume(snapshot(99));
      expect(useThreadDetailStore.getState().getThreadDetail("t")?.lastSequence).toBe(10);
      await vi.advanceTimersByTimeAsync(500);
      expect(attempts).toBe(2);
      expect(useThreadDetailStore.getState().getThreadDetail("t")).toMatchObject({
        loaded: true,
        snapshotSequence: 12,
        lastSequence: 12,
      });
      expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "connected" }));
    } finally {
      stop();
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
  },
);

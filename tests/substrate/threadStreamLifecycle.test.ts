import { beforeEach, expect, it, vi } from "vitest";
import { createThreadStreamConsumer } from "../../apps/desktop/src/substrate/useTileThreadStream";
import { useThreadDetailStore } from "../../apps/desktop/src/features/assistant/model/threadDetailStore";

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

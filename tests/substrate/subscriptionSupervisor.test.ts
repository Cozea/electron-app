import { describe, expect, it, vi } from "vitest";
import {
  superviseSubscription,
  type SubscriptionAttempt,
  type SubscriptionStatus,
} from "../../apps/desktop/src/substrate/subscriptionSupervisor";
import { createSharedSubscriptionRegistry } from "../../apps/desktop/src/substrate/sharedSubscription";

function scheduler() {
  const pending = new Map<number, { callback: () => void; delay: number }>();
  let id = 0;
  return {
    pending,
    schedule(callback: () => void, delay: number) {
      const key = ++id;
      pending.set(key, { callback, delay });
      return () => {
        pending.delete(key);
      };
    },
    next() {
      const [key, timer] = [...pending.entries()][0]!;
      pending.delete(key);
      timer.callback();
    },
  };
}

describe("subscription recovery ownership", () => {
  it("backs off, gets a fresh attempt, rejects stale callbacks and resets after a snapshot", async () => {
    const clock = scheduler();
    const attempts: SubscriptionAttempt[] = [];
    const statuses: SubscriptionStatus[] = [];
    const close = vi.fn();
    const stop = superviseSubscription({
      schedule: clock.schedule,
      status: (status) => statuses.push(status),
      connect: async (attempt) => {
        attempts.push(attempt);
        attempt.own(close);
      },
    });
    attempts[0]!.disconnected();
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    expect([...clock.pending.values()][0]!.delay).toBe(500);
    attempts[0]!.ready();
    expect(statuses.at(-1)!.phase).toBe("error");
    clock.next();
    attempts[1]!.disconnected();
    expect([...clock.pending.values()][0]!.delay).toBe(1000);
    clock.next();
    attempts[2]!.ready();
    expect(clock.pending.size).toBe(0);
    expect(statuses.at(-1)!.phase).toBe("connected");
    attempts[2]!.disconnected();
    expect([...clock.pending.values()][0]!.delay).toBe(500);
    stop();
    expect(clock.pending.size).toBe(0);
  });

  it("cleans late asynchronous acquisitions after unmount and never reconnects", async () => {
    const clock = scheduler();
    let resolve!: () => void;
    const wait = new Promise<void>((done) => {
      resolve = done;
    });
    const close = vi.fn();
    const connect = vi.fn(async (attempt: SubscriptionAttempt) => {
      await wait;
      attempt.own(close);
      attempt.disconnected();
    });
    const stop = superviseSubscription({ connect, schedule: clock.schedule, status: () => {} });
    stop();
    resolve();
    await wait;
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(clock.pending.size).toBe(0);
  });

  it("retries a stream that never supplies an authoritative snapshot", () => {
    const clock = scheduler();
    const statuses: SubscriptionStatus[] = [];
    const stop = superviseSubscription({
      connect: async () => {},
      schedule: clock.schedule,
      status: (status) => statuses.push(status),
    });
    clock.next();
    expect(statuses.at(-1)!.error).toContain("snapshot timed out");
    expect([...clock.pending.values()][0]!.delay).toBe(500);
    stop();
  });

  it("shares same-thread tiles until the final release and isolates different owners", () => {
    const acquire = createSharedSubscriptionRegistry();
    const close = vi.fn();
    const start = vi.fn(() => close);
    const first = acquire("one", start);
    const second = acquire("one", start);
    const other = acquire("two", start);
    expect(start).toHaveBeenCalledTimes(2);
    first();
    first();
    expect(close).not.toHaveBeenCalled();
    second();
    expect(close).toHaveBeenCalledTimes(1);
    other();
    expect(close).toHaveBeenCalledTimes(2);
  });
});

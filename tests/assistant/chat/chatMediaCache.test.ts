import { expect, it, vi } from "vitest";
import { createChatMediaCache } from "../../../apps/desktop/src/features/assistant/chat/chatMediaCache";

it("shares mounted consumers, refreshes actual expiry, retries failure, and releases the final timer", async () => {
  vi.useFakeTimers();
  const resolve = vi
    .fn()
    .mockResolvedValueOnce({ url: "first", expiresAt: Date.now() + 40_000 })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ url: "renewed", expiresAt: Date.now() + 100_000 });
  const subscribe = createChatMediaCache({ resolve });
  const one = vi.fn();
  const two = vi.fn();
  const releaseOne = subscribe("asset", one);
  const releaseTwo = subscribe("asset", two);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(one).toHaveBeenLastCalledWith({ url: "first", error: false });
    releaseOne();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(two).toHaveBeenLastCalledWith({ url: null, error: true });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(two).toHaveBeenLastCalledWith({ url: "renewed", error: false });
    expect(one).toHaveBeenCalledTimes(2);
    releaseTwo();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(resolve).toHaveBeenCalledTimes(3);
  } finally {
    releaseOne();
    releaseTwo();
    vi.useRealTimers();
  }
});

it("aborts retired authority requests and ignores completion after a thread switch", async () => {
  let done!: (value: { url: string; expiresAt: number }) => void;
  let signal!: AbortSignal;
  const subscribe = createChatMediaCache({
    resolve: async (_key, incoming) => {
      signal = incoming;
      return new Promise((resolve) => {
        done = resolve;
      });
    },
  });
  const old = vi.fn();
  const release = subscribe("old-thread", old);
  release();
  expect(signal.aborted).toBe(true);
  done({ url: "stale", expiresAt: Date.now() + 40_000 });
  await Promise.resolve();
  await Promise.resolve();
  expect(old).toHaveBeenCalledTimes(1);
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/desktopBridgeClient", () => ({ readSubstrateShadowBridgeStatus: read }));
import {
  subscribeSubstrateShadowStatus,
  watchSubstrateShadowStatus,
} from "../../apps/desktop/src/substrate/useSubstrateChatTransport";
const stops: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  read.mockReset();
});
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});

it("continues endpoint discovery after ready and serializes slow status reads", async () => {
  let resolve!: (value: unknown) => void;
  read.mockResolvedValueOnce({ phase: "ready", baseUrl: "http://old" });
  read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  read.mockResolvedValue({ phase: "ready", baseUrl: "http://new" });
  const status = vi.fn();
  stops.push(watchSubstrateShadowStatus(status, vi.fn()));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(read).toHaveBeenCalledTimes(2);
  resolve({ phase: "ready", baseUrl: "http://new" });
  await vi.advanceTimersByTimeAsync(0);
  expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: "http://new" }));
  await vi.advanceTimersByTimeAsync(3000);
  expect(read).toHaveBeenCalledTimes(3);
});

it("backs off failures and ignores results after final cleanup", async () => {
  read.mockRejectedValueOnce(new Error("offline"));
  let resolve!: (value: unknown) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const status = vi.fn();
  const error = vi.fn();
  const stop = watchSubstrateShadowStatus(status, error);
  stops.push(stop);
  await vi.advanceTimersByTimeAsync(5999);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(2);
  stop();
  resolve({ phase: "ready" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(status).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledTimes(2);
});

const readyStatus = (baseUrl = "http://shadow") => ({
  phase: "ready" as const,
  enabled: true,
  baseUrl,
  readyPath: "/ready",
  lastError: null,
  features: {
    rpcChat: true,
    providers: true,
    vcs: true,
    primary: true,
    obsNdjson: false,
    inProcessAssistant: false,
  },
});

it("shares reads across subscribers and retains equal snapshot identity without broadcasts", async () => {
  read.mockImplementation(async () => readyStatus());
  const first = vi.fn();
  const second = vi.fn();
  const stopFirst = subscribeSubstrateShadowStatus(first, vi.fn());
  stops.push(stopFirst);
  const stopSecond = subscribeSubstrateShadowStatus(second, vi.fn());
  stops.push(stopSecond);
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(1);
  expect(first.mock.calls[0]![0]).toBe(second.mock.calls[0]![0]);
  await vi.advanceTimersByTimeAsync(9000);
  expect(read).toHaveBeenCalledTimes(4);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  const late = vi.fn();
  stops.push(subscribeSubstrateShadowStatus(late, vi.fn()));
  expect(late).toHaveBeenCalledWith(first.mock.calls[0]![0]);
  expect(late.mock.calls[0]![0]).toBe(first.mock.calls[0]![0]);
  stopFirst();
  stopFirst();
  read.mockResolvedValue(readyStatus("http://restarted"));
  await vi.advanceTimersByTimeAsync(3000);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
});

it("last shared release cancels late results and a new owner starts fresh discovery", async () => {
  let resolve!: (value: unknown) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const old = vi.fn();
  const stop = subscribeSubstrateShadowStatus(old, vi.fn());
  stops.push(stop);
  stop();
  read.mockResolvedValue(readyStatus("http://new"));
  const next = vi.fn();
  const stopNext = subscribeSubstrateShadowStatus(next, vi.fn());
  stops.push(stopNext);
  await vi.advanceTimersByTimeAsync(0);
  resolve(readyStatus("http://old"));
  await vi.advanceTimersByTimeAsync(0);
  expect(old).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: "http://new" }));
  stopNext();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(2);
});

it("gives late subscribers the retained status plus current error and preserves identity on recovery", async () => {
  read.mockResolvedValueOnce(readyStatus()).mockRejectedValueOnce(new Error("offline"));
  read.mockResolvedValue(readyStatus());
  const first = vi.fn();
  stops.push(subscribeSubstrateShadowStatus(first, vi.fn()));
  await vi.advanceTimersByTimeAsync(3000);
  const late = vi.fn();
  const error = vi.fn();
  stops.push(subscribeSubstrateShadowStatus(late, error));
  expect(late.mock.calls[0]![0]).toBe(first.mock.calls[0]![0]);
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
  await vi.advanceTimersByTimeAsync(6000);
  expect(late).toHaveBeenCalledTimes(2);
  expect(late.mock.calls[1]![0]).toBe(late.mock.calls[0]![0]);
});

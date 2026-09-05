import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stopChildProcessVerified } from "../../shared/verifiedChildProcessStop";

class Child extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  kill = vi.fn((_signal?: NodeJS.Signals | number) => {
    this.killed = true;
    return true;
  });
  asProcess(): ChildProcess { return this as unknown as ChildProcess; }
  exit(signal: NodeJS.Signals = "SIGTERM") {
    this.signalCode = signal;
    this.emit("exit", null, signal);
  }
}

afterEach(() => vi.useRealTimers());

describe("verified child process shutdown", () => {
  it("does not signal a process already confirmed exited", async () => {
    const child = new Child();
    child.exitCode = 0;
    await stopChildProcessVerified(child.asProcess());
    expect(child.kill).not.toHaveBeenCalled();
    await stopChildProcessVerified(null);
  });

  it("observes synchronous exit because the listener precedes SIGTERM", async () => {
    const child = new Child();
    child.kill.mockImplementation(() => { child.exit(); return true; });
    await stopChildProcessVerified(child.asProcess());
    expect(child.listenerCount("exit")).toBe(0);
  });

  it("escalates a successfully signalled but still running child", async () => {
    vi.useFakeTimers();
    const child = new Child();
    const stopped = stopChildProcessVerified(child.asProcess(), { graceMs: 10, killWaitMs: 10 });
    expect(child.killed).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(child.kill.mock.calls.map(([signal]) => signal)).toEqual(["SIGTERM", "SIGKILL"]);
    child.exit("SIGKILL");
    await stopped;
    expect(child.listenerCount("exit")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not confuse an earlier kill with termination", async () => {
    const child = new Child();
    child.killed = true;
    const stopped = stopChildProcessVerified(child.asProcess());
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.exit();
    await stopped;
  });

  it("shares an in-flight stop and permits retry after an unacknowledged kill", async () => {
    vi.useFakeTimers();
    const child = new Child();
    child.kill.mockImplementation(() => false);
    const stopped = stopChildProcessVerified(child.asProcess(), { graceMs: 5, killWaitMs: 5 });
    expect(stopChildProcessVerified(child.asProcess())).toBe(stopped);
    const rejected = expect(stopped).rejects.toThrow("exit was not acknowledged");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(child.listenerCount("exit")).toBe(0);
    child.kill.mockImplementation(() => { child.exit(); return true; });
    await stopChildProcessVerified(child.asProcess());
  });

  it("does not leak kill errors and cleans listeners on failure", async () => {
    vi.useFakeTimers();
    const child = new Child();
    child.kill.mockImplementation(() => { throw new Error("private process detail"); });
    const stopped = stopChildProcessVerified(child.asProcess(), { graceMs: 1, killWaitMs: 1 });
    const rejected = expect(stopped).rejects.toThrow("shutdown remains incomplete");
    await vi.advanceTimersByTimeAsync(2);
    await rejected;
    expect(child.listenerCount("exit")).toBe(0);
  });

  it("rejects invalid deadlines without installing listeners or signalling", async () => {
    const child = new Child();
    await expect(stopChildProcessVerified(child.asProcess(), { graceMs: Number.NaN })).rejects.toThrow("deadline");
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

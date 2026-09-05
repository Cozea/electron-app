import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stopChildProcessVerified } from "../../shared/verifiedChildProcessStop";

const children = new Set<ChildProcess>();

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([...children].map(child =>
    stopChildProcessVerified(child, { graceMs: 0, killWaitMs: 5_000 })));
  children.clear();
});

async function readyChild(ignoreTerm: boolean): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", `
    ${ignoreTerm ? 'process.on("SIGTERM", () => {});' : ''}
    process.send("ready");
    setInterval(() => {}, 1000);
  `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  children.add(child);
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error); else resolve();
    };
    const onMessage = (message: unknown) => { if (message === "ready") finish(); };
    const onError = () => finish(new Error("Shutdown fixture failed to start."));
    const onExit = () => finish(new Error("Shutdown fixture exited before readiness."));
    const timer = setTimeout(() => finish(new Error("Shutdown fixture readiness timed out.")), 10_000);
    child.on("message", onMessage);
    child.on("error", onError);
    child.on("exit", onExit);
  });
  return child;
}

describe("verified shutdown against an owned OS process", () => {
  it.skipIf(process.platform === "win32")("acknowledges a real graceful exit", async () => {
    const child = await readyChild(false);
    await stopChildProcessVerified(child, { graceMs: 2_000, killWaitMs: 2_000 });
    expect(child.signalCode).toBe("SIGTERM");
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
  }, 15_000);

  it.skipIf(process.platform === "win32")("forces a real child which ignores SIGTERM and waits for its exit", async () => {
    const child = await readyChild(true);
    const stopped = stopChildProcessVerified(child, { graceMs: 50, killWaitMs: 5_000 });
    expect(child.killed).toBe(true);
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    await stopped;
    expect(child.signalCode).toBe("SIGKILL");
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
  }, 15_000);
});

describe("asynchronous signal-delivery errors", () => {
  it("does not mistake an error event for exit or expose its details", async () => {
    vi.useFakeTimers();
    const raw = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
    });
    const stopped = stopChildProcessVerified(raw as unknown as ChildProcess, { graceMs: 5, killWaitMs: 5 });
    const rejected = expect(stopped).rejects.toThrow("exit was not acknowledged");
    expect(() => raw.emit("error", new Error("private child detail"))).not.toThrow();
    await vi.advanceTimersByTimeAsync(5);
    expect(raw.kill).toHaveBeenCalledWith("SIGKILL");
    await vi.advanceTimersByTimeAsync(5);
    await rejected;
    expect(raw.listenerCount("exit")).toBe(0);
    expect(raw.listenerCount("error")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still accepts a later confirmed exit after a delivery error", async () => {
    const raw = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
    });
    const stopped = stopChildProcessVerified(raw as unknown as ChildProcess);
    raw.emit("error", new Error("private child detail"));
    raw.emit("exit", null, "SIGTERM");
    await stopped;
    expect(raw.listenerCount("exit")).toBe(0);
    expect(raw.listenerCount("error")).toBe(0);
  });
});

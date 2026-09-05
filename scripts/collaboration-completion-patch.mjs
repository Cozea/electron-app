#!/usr/bin/env node
// Temporary, branch-scoped implementation driver. Removed before review.
import fs from "node:fs";
import path from "node:path";

const edits = new Map();
function replace(file, before, after) {
  const source = edits.get(file) ?? fs.readFileSync(file, "utf8");
  if (source.includes(after)) return;
  if (source.split(before).length !== 2) throw new Error(`Expected one patch anchor in ${file}`);
  edits.set(file, source.replace(before, after));
}
function create(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== content) throw new Error(`Refusing to overwrite ${file}`);
  if (!fs.existsSync(file)) edits.set(file, content);
}

create("shared/terminateOwnedChild.ts", `import type { ChildProcess } from "node:child_process";

export interface OwnedChildTerminationOptions {
  readonly gracefulMs?: number;
  readonly forcedMs?: number;
}

const stopping = new WeakMap<ChildProcess, Promise<void>>();

/** Only an observed exit (not ChildProcess.killed) proves an owned child stopped. */
export function terminateOwnedChild(
  child: ChildProcess | null,
  options: OwnedChildTerminationOptions = {},
): Promise<void> {
  if (!child) return Promise.resolve();
  const exited = () => child.exitCode != null || child.signalCode != null;
  if (exited()) return Promise.resolve();
  const existing = stopping.get(child);
  if (existing) return existing;
  const gracefulMs = options.gracefulMs ?? 5_000;
  const forcedMs = options.forcedMs ?? 2_000;
  if (![gracefulMs, forcedMs].every(value => Number.isFinite(value) && value >= 0)) {
    return Promise.reject(new Error("Invalid owned-process shutdown deadline"));
  }
  const operation = new Promise<void>((resolve, reject) => {
    let settled = false;
    let gracefulTimer: ReturnType<typeof setTimeout> | undefined;
    let forcedTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(gracefulTimer);
      clearTimeout(forcedTimer);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      if (error) reject(error); else resolve();
    };
    const onExit = () => finish();
    const onError = () => {
      if (exited()) finish();
      else finish(new Error("Owned process termination could not be confirmed; retry shutdown"));
    };
    const force = () => {
      clearTimeout(gracefulTimer);
      if (settled) return;
      if (exited()) { finish(); return; }
      forcedTimer = setTimeout(() => {
        if (exited()) finish();
        else finish(new Error("Owned process did not exit after forced termination; retry shutdown"));
      }, forcedMs);
      try { child.kill("SIGKILL"); }
      catch { onError(); }
    };
    // Register before signaling: mocks and short-lived children can exit immediately.
    child.once("exit", onExit);
    child.once("error", onError);
    if (exited()) { finish(); return; }
    gracefulTimer = setTimeout(force, gracefulMs);
    try { child.kill("SIGTERM"); }
    catch { force(); }
  });
  stopping.set(child, operation);
  // Keep failed shutdown retryable and avoid an unhandled finally() rejection.
  void operation.then(() => stopping.delete(child), () => stopping.delete(child));
  return operation;
}
`);

create("tests/electron/terminateOwnedChild.test.ts", `import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminateOwnedChild } from "../../shared/terminateOwnedChild";

function fixture() {
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    killed: false,
    kill: vi.fn((_signal?: NodeJS.Signals | number): boolean => { child.killed = true; return true; }),
  });
  return { child: child as unknown as ChildProcess, raw: child };
}

afterEach(() => { vi.useRealTimers(); });

describe("confirmed owned-child shutdown", () => {
  it("accepts absent and already exited children without signaling", async () => {
    await terminateOwnedChild(null);
    const { child, raw } = fixture();
    raw.exitCode = 0;
    await terminateOwnedChild(child);
    expect(raw.kill).not.toHaveBeenCalled();
  });

  it("observes an exit emitted synchronously by kill", async () => {
    const { child, raw } = fixture();
    raw.kill.mockImplementation(() => { raw.emit("exit", 0, null); return true; });
    await terminateOwnedChild(child);
    expect(raw.listenerCount("exit")).toBe(0);
    expect(raw.listenerCount("error")).toBe(0);
  });

  it("does not treat killed=true as exit and escalates after the grace period", async () => {
    vi.useFakeTimers();
    const { child, raw } = fixture();
    const task = terminateOwnedChild(child, { gracefulMs: 20, forcedMs: 20 });
    let complete = false;
    void task.then(() => { complete = true; });
    await vi.advanceTimersByTimeAsync(19);
    expect(raw.killed).toBe(true);
    expect(complete).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(raw.kill.mock.calls.map(call => call[0])).toEqual(["SIGTERM", "SIGKILL"]);
    expect(complete).toBe(false);
    raw.emit("exit", null, "SIGKILL");
    await task;
    expect(complete).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a child previously signaled by another owner", async () => {
    const { child, raw } = fixture();
    raw.killed = true;
    const task = terminateOwnedChild(child);
    expect(raw.kill).toHaveBeenCalledWith("SIGTERM");
    raw.emit("exit", null, "SIGTERM");
    await task;
  });

  it("joins concurrent shutdowns without issuing duplicate signals", async () => {
    const { child, raw } = fixture();
    const first = terminateOwnedChild(child);
    const second = terminateOwnedChild(child);
    expect(first).toBe(second);
    expect(raw.kill).toHaveBeenCalledTimes(1);
    raw.emit("exit", 0, null);
    await Promise.all([first, second]);
  });

  it("rejects unconfirmed force termination and permits an explicit retry", async () => {
    vi.useFakeTimers();
    const { child, raw } = fixture();
    const task = terminateOwnedChild(child, { gracefulMs: 1, forcedMs: 1 });
    const result = expect(task).rejects.toThrow("did not exit");
    await vi.advanceTimersByTimeAsync(2);
    await result;
    expect(raw.listenerCount("exit")).toBe(0);
    expect(raw.listenerCount("error")).toBe(0);
    const retry = terminateOwnedChild(child);
    raw.emit("exit", null, "SIGTERM");
    await retry;
  });

  it("escalates if sending SIGTERM throws", async () => {
    const { child, raw } = fixture();
    raw.kill.mockImplementation(signal => {
      if (signal === "SIGTERM") throw new Error("signal delivery failed");
      raw.emit("exit", null, "SIGKILL");
      return true;
    });
    await terminateOwnedChild(child);
    expect(raw.kill.mock.calls.map(call => call[0])).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("rejects an asynchronous process error without exposing its details", async () => {
    const { child, raw } = fixture();
    const task = terminateOwnedChild(child);
    const result = expect(task).rejects.toThrow("could not be confirmed");
    raw.emit("error", new Error("private subprocess details"));
    await result;
    expect(raw.listenerCount("exit")).toBe(0);
  });
});
`);

const manager = "apps/desktop/electron/substrate/ShadowServerManager.ts";
replace(manager, 'import { fork, type ChildProcess } from "node:child_process";', 'import { fork, type ChildProcess } from "node:child_process";\nimport { terminateOwnedChild } from "../../../../shared/terminateOwnedChild";');
replace(manager, `function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

`, "");
// Empty replacement is handled independently because every string includes it.
let managerSource = edits.get(manager) ?? fs.readFileSync(manager, "utf8");
managerSource = managerSource.replace(/function delay\(ms: number\): Promise<void> \{\n  return new Promise\(\(resolve\) => \{\n    setTimeout\(resolve, ms\);\n  \}\);\n\}\n\n/, "");
edits.set(manager, managerSource);
replace(manager, `    await this.stopChild(child);
    this.child = null;
    this.phase = "stopped";`, `    try {
      await this.stopChild(child);
    } catch (error) {
      this.phase = "error";
      this.lastError = "Chat server termination could not be confirmed; retry shutdown";
      throw error;
    }
    this.child = null;
    this.phase = "stopped";`);
const start = managerSource.indexOf("  private async stopChild(child: ChildProcess | null): Promise<void> {");
const end = managerSource.indexOf("  private appendManagerLog", start);
if (start < 0 || end < 0) throw new Error("Missing owned shadow shutdown anchors");
const oldStop = managerSource.slice(start, end);
replace(manager, oldStop, `  private async stopChild(child: ChildProcess | null): Promise<void> {
    await terminateOwnedChild(child, { gracefulMs: this.stopGraceMs, forcedMs: 2_000 });
  }

`);

const processFile = "apps/server/src/t3/process.ts";
replace(processFile, 'import { spawn } from "node:child_process";', 'import { spawn } from "node:child_process";\nimport { terminateOwnedChild } from "../../../../shared/terminateOwnedChild.ts";');
replace(processFile, `    child.kill("SIGTERM");
    throw error;`, `    await terminateOwnedChild(child, { gracefulMs: 2_000 });
    throw error;`);
replace(processFile, `    stop: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },`, `    stop: () => terminateOwnedChild(child, { gracefulMs: 2_000 }),`);
replace("apps/server/src/t3Bootstrap.ts", `      await proxy.close();
      await processHandle.stop();`, `      try { await proxy.close(); }
      finally { await processHandle.stop(); }`);

for (const [file, content] of edits) {
  console.log(file);
  if (!process.argv.includes("--check")) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

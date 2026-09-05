import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NativeWorkspaceAuthority,
  isWithinNativeWorkspace,
  type NativeWorkspaceDecision,
} from "../../shared/nativeWorkspaceAuthority";

const ROOT = path.resolve("/native-authority-fixture/session");
const OTHER = path.resolve("/native-authority-fixture/other");
const ALIAS = path.resolve("/native-authority-fixture/alias");
const allowed: NativeWorkspaceDecision = { allowed: true, sessionRoot: ROOT };
const canonicalize = async (cwd: string) => cwd;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("native workspace admission and revocation", () => {
  it("does not treat a similarly prefixed sibling as the session root", () => {
    expect(isWithinNativeWorkspace(ROOT, path.join(ROOT, "nested"))).toBe(true);
    expect(isWithinNativeWorkspace(ROOT, ROOT + "-other")).toBe(false);
    expect(isWithinNativeWorkspace(ROOT, path.dirname(ROOT))).toBe(false);
  });

  it("rejects an old request whose canonical path resolves after stop and reactivation", async () => {
    const resolving = deferred<string>();
    const authorize = vi.fn(async () => allowed);
    const authority = new NativeWorkspaceAuthority({
      authorize,
      canonicalize: () => resolving.promise,
    });
    authority.activate(ROOT);
    const acquiring = authority.acquire(ALIAS);
    const rejected = expect(acquiring).rejects.toThrow("not authorized");
    await authority.stop(ROOT, async () => undefined);
    authority.activate(ROOT);
    resolving.resolve(ROOT);
    await rejected;
    expect(authorize).not.toHaveBeenCalled();
  });

  it("does not cancel unrelated work while a different workspace is revoked", async () => {
    const resolving = deferred<string>();
    const authority = new NativeWorkspaceAuthority({
      authorize: async () => allowed,
      canonicalize: () => resolving.promise,
    });
    authority.activate(ROOT);
    const acquiring = authority.acquire(ALIAS);
    await authority.stop(OTHER, async () => undefined);
    authority.activate(OTHER);
    resolving.resolve(ROOT);
    const permit = await acquiring;
    expect(permit.cwd).toBe(ROOT);
    permit.release();
    permit.release();
  });

  it("drains a pending host authorization and rejects its late allowed reply", async () => {
    const response = deferred<NativeWorkspaceDecision>();
    const authorize = vi.fn(() => response.promise);
    const authority = new NativeWorkspaceAuthority({ authorize, canonicalize });
    const acquiring = authority.acquire(ROOT);
    const rejected = expect(acquiring).rejects.toThrow("not authorized");
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));
    const stopOwned = vi.fn(async () => undefined);
    const stopped = authority.stop(ROOT, stopOwned);
    expect(stopOwned).toHaveBeenCalledTimes(1);
    response.resolve(allowed);
    await rejected;
    await stopped;
    expect(stopOwned).toHaveBeenCalledTimes(2);
    await expect(authority.acquire(ROOT)).rejects.toThrow("not authorized");
  });

  it("releases denied observer requests without leaking an execution flight", async () => {
    const authority = new NativeWorkspaceAuthority({
      authorize: async () => ({ allowed: false, sessionRoot: ROOT }),
      canonicalize,
      drainTimeoutMs: 0,
    });
    await expect(authority.acquire(ROOT)).rejects.toThrow("not authorized");
    await expect(authority.stop(ROOT, async () => undefined)).resolves.toBeUndefined();
  });

  it("joins duplicate stops and forbids activation while owned resources are stopping", async () => {
    const exiting = deferred<void>();
    const stopOwned = vi.fn(() => exiting.promise);
    const authority = new NativeWorkspaceAuthority({ authorize: async () => allowed, canonicalize });
    const first = authority.stop(ROOT, stopOwned);
    const second = authority.stop(ROOT, stopOwned);
    expect(first).toBe(second);
    expect(() => authority.activate(ROOT)).toThrow("still in progress");
    exiting.resolve(undefined);
    await first;
    expect(stopOwned).toHaveBeenCalledTimes(2);
    authority.activate(ROOT);
    const permit = await authority.acquire(ROOT);
    permit.release();
  });

  it("retains revocation after a failed stop and does not interrupt unrelated work", async () => {
    const authority = new NativeWorkspaceAuthority({
      authorize: async cwd => ({ allowed: true, sessionRoot: cwd === ROOT ? ROOT : null }),
      canonicalize,
    });
    await expect(authority.stop(ROOT, async () => { throw new Error("private resource detail"); }))
      .rejects.toThrow("shutdown was not fully acknowledged");
    await expect(authority.acquire(ROOT)).rejects.toThrow("not authorized");
    const unrelated = await authority.acquire(OTHER);
    unrelated.release();
    await authority.stop(ROOT, async () => undefined);
    await expect(authority.acquire(ROOT)).rejects.toThrow("not authorized");
    authority.activate(ROOT);
    const permit = await authority.acquire(ROOT);
    permit.release();
  });

  it("never acknowledges Leave when an admitted native action fails to drain", async () => {
    vi.useFakeTimers();
    const authority = new NativeWorkspaceAuthority({
      authorize: async () => allowed,
      canonicalize,
      drainTimeoutMs: 10,
    });
    const permit = await authority.acquire(ROOT);
    const stopOwned = vi.fn(async () => undefined);
    const stopped = authority.stop(ROOT, stopOwned);
    const rejected = expect(stopped).rejects.toThrow("shutdown was not fully acknowledged");
    try {
      await vi.advanceTimersByTimeAsync(11);
      await rejected;
      expect(stopOwned).toHaveBeenCalledTimes(2);
      await expect(authority.acquire(ROOT)).rejects.toThrow("not authorized");
    } finally {
      permit.release();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});

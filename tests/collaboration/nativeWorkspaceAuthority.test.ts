import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, rm, symlink, realpath } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeWorkspaceAuthority, isWithinNativeWorkspace, type NativeWorkspaceDecision } from "../../shared/nativeWorkspaceAuthority";

const root = path.resolve("native-session-fixture");
const other = path.resolve("native-ordinary-fixture");
const editor: NativeWorkspaceDecision = { allowed: true, sessionRoot: root };
const observer: NativeWorkspaceDecision = { allowed: false, sessionRoot: root };
const ordinary: NativeWorkspaceDecision = { allowed: true, sessionRoot: null };
const temporary: string[] = [];

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(implementation: (cwd: string, operation: "execute" | "git") => Promise<NativeWorkspaceDecision> = async () => editor) {
  const authorize = vi.fn(implementation);
  return { authorize, authority: new NativeWorkspaceAuthority({ authorize, canonicalize: async cwd => cwd, drainTimeoutMs: 10 }) };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("native collaboration execution authority", () => {
  it("denies an observer without granting a permit", async () => {
    const { authority } = fixture(vi.fn(async () => observer));
    await expect(authority.acquire(root)).rejects.toThrow("not authorized");
    expect(authority.knownSessionRoots()).toEqual([root]);
    await authority.stop(root, async () => undefined);
  });

  it("keeps ordinary workspaces independent from a suspended collaboration root", async () => {
    const { authority } = fixture(vi.fn(async cwd => cwd === root ? editor : ordinary));
    await authority.stop(root, async () => undefined);
    await expect(authority.acquire(root)).rejects.toThrow("not authorized");
    const permit = await authority.acquire(other);
    permit.release();
    permit.release();
  });

  it("does not mistake a sibling prefix for a nested workspace", () => {
    expect(isWithinNativeWorkspace(root, path.join(root, "src"))).toBe(true);
    expect(isWithinNativeWorkspace(root, `${root}-other`)).toBe(false);
    expect(isWithinNativeWorkspace(root, path.dirname(root))).toBe(false);
  });

  it("rejects a late allowed response after revocation and drains that request", async () => {
    const response = deferred<NativeWorkspaceDecision>();
    const started = deferred<void>();
    const { authority } = fixture(vi.fn(async () => { started.resolve(); return response.promise; }));
    const permit = authority.acquire(root);
    const denied = expect(permit).rejects.toThrow("not authorized");
    await started.promise;
    const stopOwned = vi.fn(async () => undefined);
    const stopped = authority.stop(root, stopOwned);
    response.resolve(editor);
    await denied;
    await stopped;
    expect(stopOwned).toHaveBeenCalledTimes(2);
  });

  it("does not revive an old request across an explicit stop and reactivation", async () => {
    vi.useFakeTimers();
    const response = deferred<NativeWorkspaceDecision>();
    const started = deferred<void>();
    const { authority, authorize } = fixture(vi.fn(async () => { started.resolve(); return response.promise; }));
    const pending = authority.acquire(root);
    const denied = expect(pending).rejects.toThrow("not authorized");
    await started.promise;
    const stop = authority.stop(root, async () => undefined);
    const failedStop = expect(stop).rejects.toThrow("not fully acknowledged");
    await vi.advanceTimersByTimeAsync(10);
    await failedStop;
    authority.activate(root);
    response.resolve(editor);
    await denied;
    authorize.mockResolvedValue(editor);
    const current = await authority.acquire(root);
    current.release();
  });

  it("sweeps again after an admitted provider start finishes", async () => {
    const { authority } = fixture();
    const permit = await authority.acquire(path.join(root, "src"));
    const firstSweep = deferred<void>();
    const stopOwned = vi.fn(async () => { firstSweep.resolve(); });
    const stopped = authority.stop(root, stopOwned);
    await firstSweep.promise;
    expect(stopOwned).toHaveBeenCalledTimes(1);
    permit.release();
    await stopped;
    expect(stopOwned).toHaveBeenCalledTimes(2);
    await expect(authority.acquire(root)).rejects.toThrow("not authorized");
  });

  it("does not wait for an unrelated workspace's active permit", async () => {
    const { authority } = fixture(vi.fn(async cwd => cwd === root ? editor : ordinary));
    const unrelated = await authority.acquire(other);
    await authority.stop(root, async () => undefined);
    unrelated.release();
  });

  it("joins repeated stop requests and leaves failed cleanup explicitly retryable", async () => {
    const { authority } = fixture();
    const blocked = deferred<void>();
    const failed = vi.fn(async () => { await blocked.promise; throw new Error("private provider error"); });
    const first = authority.stop(root, failed);
    const second = authority.stop(root, failed);
    expect(second).toBe(first);
    expect(() => authority.activate(root)).toThrow("still in progress");
    const result = expect(first).rejects.toThrow("not fully acknowledged");
    blocked.resolve();
    await result;
    await expect(authority.acquire(root)).rejects.toThrow("not authorized");
    await authority.stop(root, async () => undefined);
    authority.activate(root);
    const permit = await authority.acquire(root);
    permit.release();
  });

  it("fails closed on an unavailable host without revealing error details", async () => {
    const { authority } = fixture(vi.fn(async () => { throw new Error("private host state"); }));
    await expect(authority.acquire(root)).rejects.toThrow("not authorized");
    await authority.stop(root, async () => undefined);
  });

  it("requires the host's session root to contain the actual execution path", async () => {
    const { authority } = fixture();
    await expect(authority.acquire(other)).rejects.toThrow("not authorized");
    expect(authority.knownSessionRoots()).toEqual([]);
  });

  it("sends git operations to the host instead of treating editor as Git authority", async () => {
    const { authority, authorize } = fixture(vi.fn(async (_cwd, operation) => operation === "git" ? observer : editor));
    await expect(authority.acquire(root, "git")).rejects.toThrow("not authorized");
    expect(authorize).toHaveBeenCalledWith(root, "git");
  });

  it("does not let polling automatically reactivate a suspended root", async () => {
    const { authority } = fixture();
    await authority.stop(root, async () => undefined);
    expect(await authority.recheckSessionRoot(root)).toBe(false);
    authority.activate(root);
    expect(await authority.recheckSessionRoot(root)).toBe(true);
  });

  it("resolves a real symlink before requesting native execution authority", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "cozea-native-authority-"));
    temporary.push(directory);
    const session = path.join(directory, "session");
    await mkdir(session);
    const alias = path.join(directory, "alias");
    await symlink(session, alias, process.platform === "win32" ? "junction" : "dir");
    const canonical = await realpath(session);
    const authorize = vi.fn(async () => ({ allowed: false, sessionRoot: canonical }));
    const authority = new NativeWorkspaceAuthority({ authorize });
    await expect(authority.acquire(alias)).rejects.toThrow("not authorized");
    expect(authorize).toHaveBeenCalledWith(canonical, "execute");
  });

  it("rejects relative or missing paths before asking the host", async () => {
    const { authority, authorize } = fixture();
    await expect(authority.acquire("relative")).rejects.toThrow("not authorized");
    await expect(authority.acquire("")).rejects.toThrow("not authorized");
    expect(authorize).not.toHaveBeenCalled();
  });
});

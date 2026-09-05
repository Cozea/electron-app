import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createNativeWorkspaceAuthorizer } from "../../apps/desktop/electron/collaboration/NativeWorkspaceAuthorizer";
import type { CollaborationWorkspaceAuthority, SessionWorkspaceBinding } from "../../shared/collaborationDesktop";
import type { NativeWorkspaceAuthorizeRequest } from "../../shared/nativeWorkspaceIpc";

const root = path.resolve("native-main-session");
const ordinary = path.resolve("native-main-ordinary");
const binding: SessionWorkspaceBinding = {
  generation: 3, sessionId: "session", projectId: "project", repositoryId: "repository",
  workspaceId: "session-workspace", sourceWorkspaceId: "source-workspace", sessionBranch: "session-branch",
  baseCommitSha: "a".repeat(40), role: "editor", state: "active", joinedAt: 1,
};
const live = {
  role: "editor", expiresAt: 100,
  session: { id: binding.sessionId, projectId: binding.projectId, repositoryId: binding.repositoryId, status: "active" },
} as CollaborationWorkspaceAuthority;

function fixture() {
  const readBinding = vi.fn(async (_id: string): Promise<SessionWorkspaceBinding | null> => binding);
  const authorizeSession = vi.fn(async (_id: string) => live);
  const findWorkspace = vi.fn(async (cwd: string) => cwd === root ? { workspaceId: binding.workspaceId, projectRootPath: root } : null);
  const authorize = createNativeWorkspaceAuthorizer({
    binding: readBinding, authorizeSession, findWorkspace, canonicalize: async cwd => cwd, now: () => 10,
  });
  const request = (cwd = root, operation: "execute" | "git" = "execute"): NativeWorkspaceAuthorizeRequest => ({
    type: "cozea:workspace-authorize", requestId: "12345678-1234-1234-1234-123456789012", cwd, operation,
  });
  return { authorize, readBinding, authorizeSession, findWorkspace, request };
}

describe("main-owned native workspace authorization", () => {
  it("allows a live editor only after both local and server checks", async () => {
    const f = fixture();
    expect(await f.authorize(f.request())).toEqual({ allowed: true, sessionRoot: root });
    expect(f.authorizeSession).toHaveBeenCalledWith(binding.sessionId);
    expect(f.readBinding).toHaveBeenCalledTimes(2);
  });

  it.each(["joining", "left", "ended"] as const)("denies a %s binding before contacting the server", async state => {
    const f = fixture();
    f.readBinding.mockResolvedValue({ ...binding, state });
    expect((await f.authorize(f.request())).allowed).toBe(false);
    expect(f.authorizeSession).not.toHaveBeenCalled();
  });

  it("denies local and remotely demoted observers", async () => {
    const f = fixture();
    f.readBinding.mockResolvedValue({ ...binding, role: "observer" });
    expect((await f.authorize(f.request())).allowed).toBe(false);
    expect(f.authorizeSession).not.toHaveBeenCalled();
    f.readBinding.mockResolvedValue(binding);
    f.authorizeSession.mockResolvedValue({ ...live, role: "observer" });
    expect((await f.authorize(f.request())).allowed).toBe(false);
  });

  it("denies native Git writes even for editors", async () => {
    const f = fixture();
    expect((await f.authorize(f.request(root, "git"))).allowed).toBe(false);
    expect(f.authorizeSession).not.toHaveBeenCalled();
  });

  it("preserves ordinary offline execution without a network lookup", async () => {
    const f = fixture();
    f.authorizeSession.mockRejectedValue(new Error("offline"));
    expect(await f.authorize(f.request(ordinary))).toEqual({ allowed: true, sessionRoot: null });
    expect(f.authorizeSession).not.toHaveBeenCalled();
    expect(await f.authorize(f.request(root))).toEqual({ allowed: false, sessionRoot: root });
  });

  it("finds a session through nested directories rather than string prefixes", async () => {
    const f = fixture();
    f.readBinding.mockResolvedValue({ ...binding, role: "observer" });
    expect((await f.authorize(f.request(path.join(root, "src", "deep")))).allowed).toBe(false);
    expect(await f.authorize(f.request(root + "-other"))).toEqual({ allowed: true, sessionRoot: null });
  });

  it("does not let a nested ordinary catalog entry mask the parent session", async () => {
    const f = fixture();
    const nested = path.join(root, "nested");
    f.findWorkspace.mockImplementation(async cwd => cwd === nested ? { workspaceId: "ordinary", projectRootPath: nested } : cwd === root ? { workspaceId: binding.workspaceId, projectRootPath: root } : null);
    f.readBinding.mockImplementation(async id => id === "ordinary" ? null : { ...binding, role: "observer" });
    expect((await f.authorize(f.request(nested))).allowed).toBe(false);
  });

  it("rejects a local suspension which happens while remote authorization waits", async () => {
    const f = fixture();
    f.authorizeSession.mockImplementation(async () => { f.readBinding.mockResolvedValue({ ...binding, state: "left" }); return live; });
    expect((await f.authorize(f.request())).allowed).toBe(false);
  });

  it("rejects stale and malformed authority expiry", async () => {
    for (const expiresAt of [0, 10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const f = fixture();
      f.authorizeSession.mockResolvedValue({ ...live, expiresAt });
      expect((await f.authorize(f.request())).allowed).toBe(false);
    }
  });

  it("fails closed on catalog corruption without forwarding error contents", async () => {
    const f = fixture();
    f.readBinding.mockRejectedValue(new Error("private catalog details"));
    expect(await f.authorize(f.request())).toEqual({ allowed: false, sessionRoot: null });
  });
});

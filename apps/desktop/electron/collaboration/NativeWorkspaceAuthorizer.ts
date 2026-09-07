import path from "node:path";
import { realpath } from "node:fs/promises";
import type { CollaborationWorkspaceAuthority, SessionWorkspaceBinding } from "../../../../shared/collaborationDesktop";
import type { NativeWorkspaceDecision } from "../../../../shared/nativeWorkspaceAuthority";
import { isWithinNativeWorkspace } from "../../../../shared/nativeWorkspaceAuthority";
import type { NativeWorkspaceAuthorizeRequest } from "../../../../shared/nativeWorkspaceIpc";

interface NativeCatalogWorkspace {
  readonly workspaceId: string;
  readonly projectRootPath: string;
}

export interface NativeWorkspaceAuthorizerOptions {
  readonly findWorkspace: (canonicalPath: string) => Promise<NativeCatalogWorkspace | null>;
  readonly binding: (workspaceId: string) => Promise<SessionWorkspaceBinding | null>;
  readonly authorizeSession: (sessionId: string) => Promise<CollaborationWorkspaceAuthority>;
  readonly canonicalize?: (value: string) => Promise<string>;
  readonly now?: () => number;
}

/** Session roles come from authenticated main/gateway state, never native RPC input. */
export function createNativeWorkspaceAuthorizer(options: NativeWorkspaceAuthorizerOptions): (request: NativeWorkspaceAuthorizeRequest) => Promise<NativeWorkspaceDecision> {
  const canonicalize = options.canonicalize ?? realpath;
  const now = options.now ?? Date.now;
  return async request => {
    let sessionRoot: string | null = null;
    try {
      if ((request.operation !== "execute" && request.operation !== "git") || !path.isAbsolute(request.cwd) || request.cwd.includes("\0")) return { allowed: false, sessionRoot };
      const cwd = await canonicalize(request.cwd);
      if (!path.isAbsolute(cwd)) return { allowed: false, sessionRoot };
      let candidate = cwd;
      let found: { workspace: NativeCatalogWorkspace; binding: SessionWorkspaceBinding } | null = null;
      // Check ancestors too: a nested ordinary binding cannot mask the enclosing
      // session's authority, and a sibling prefix is never a parent workspace.
      for (let depth = 0; ; depth++) {
        if (depth >= 128) return { allowed: false, sessionRoot };
        const workspace = await options.findWorkspace(candidate);
        if (workspace) {
          const binding = await options.binding(workspace.workspaceId);
          if (binding) {
            if (found && found.binding.sessionId !== binding.sessionId) return { allowed: false, sessionRoot };
            const root = await canonicalize(workspace.projectRootPath);
            if (!isWithinNativeWorkspace(root, cwd) || binding.workspaceId !== workspace.workspaceId || binding.generation !== 3) return { allowed: false, sessionRoot: root };
            sessionRoot = root;
            found = { workspace, binding };
          }
        }
        const parent = path.dirname(candidate);
        if (parent === candidate) break;
        candidate = parent;
      }
      if (!found) return { allowed: true, sessionRoot: null };
      const { workspace, binding } = found;
      if (request.operation === "git" || binding.state !== "active" || binding.role !== "editor") return { allowed: false, sessionRoot };
      const live = await options.authorizeSession(binding.sessionId);
      if (live.role !== "editor" || live.session.id !== binding.sessionId || live.session.projectId !== binding.projectId || live.session.repositoryId !== binding.repositoryId || ["closing", "closed", "failed"].includes(live.session.status) || !Number.isFinite(live.expiresAt) || live.expiresAt <= now()) return { allowed: false, sessionRoot };
      // Leave/revocation may have completed while the gateway call was in flight.
      // A late server response cannot restore a locally suspended binding.
      const current = await options.binding(workspace.workspaceId);
      if (!current || current.generation !== 3 || current.sessionId !== binding.sessionId || current.projectId !== binding.projectId || current.workspaceId !== workspace.workspaceId || current.state !== "active" || current.role !== "editor") return { allowed: false, sessionRoot };
      if (await canonicalize(workspace.projectRootPath) !== sessionRoot) return { allowed: false, sessionRoot };
      return { allowed: true, sessionRoot };
    } catch {
      // Unavailable auth is not editor authority. Ordinary paths never perform a
      // network lookup; their existing offline behavior is preserved.
      return { allowed: false, sessionRoot };
    }
  };
}

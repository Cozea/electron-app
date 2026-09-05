import { nativeWorkspacePath as path, repeatNativeWorkspaceTask } from "./nativeWorkspacePlatform.ts";
import { NativeWorkspaceAuthority, type NativeWorkspacePermit, type NativeWorkspaceOperation } from "./nativeWorkspaceAuthority.ts";
import { isNativeWorkspaceControlRequest, requestNativeWorkspaceDecision, sendNativeWorkspaceMessage } from "./nativeWorkspaceIpc.ts";

export const nativeWorkspaceAuthorityEnabled = process.env.COZEA_NATIVE_WORKSPACE_AUTHORITY === "1";

const authority = new NativeWorkspaceAuthority({
  authorize: (cwd, operation) => requestNativeWorkspaceDecision(process, cwd, operation),
});
const stoppers = new Map<string, (root: string) => Promise<void>>();
let stopPolling: (() => void) | undefined;
let sweepPending = false;

async function stopOwned(root: string): Promise<void> {
  // A premature success during service startup would leave an unregistered
  // native resource owner outside the shutdown fence.
  if (!stoppers.has("providers") || !stoppers.has("terminals")) throw new Error("Native workspace resource owners are not ready.");
  const results = await Promise.allSettled([...stoppers.values()].map(stop => stop(root)));
  if (results.some(result => result.status === "rejected")) throw new Error("Native workspace resources did not stop.");
}

if (nativeWorkspaceAuthorityEnabled) {
  process.on("message", (message: unknown) => {
    if (!isNativeWorkspaceControlRequest(message)) return;
    const operation = message.action === "activate"
      ? Promise.resolve().then(() => authority.activate(message.root))
      : authority.stop(message.root, stopOwned);
    const reply = (success: boolean) => sendNativeWorkspaceMessage(process, {
      type: "cozea:workspace-control-result", requestId: message.requestId, action: message.action, success,
    });
    void operation.then(() => reply(true), () => reply(false));
  });
}

/** Called once by each native service, never by a websocket client. */
export function bindNativeWorkspaceStopper(name: "providers" | "terminals", stop: (root: string) => Promise<void>): () => void {
  if (!nativeWorkspaceAuthorityEnabled) return () => undefined;
  if (stoppers.has(name)) throw new Error("Duplicate native workspace resource owner.");
  stoppers.set(name, stop);
  if (!stopPolling) {
    stopPolling = repeatNativeWorkspaceTask(2_000, async () => {
      if (sweepPending || !stoppers.has("providers") || !stoppers.has("terminals")) return;
      sweepPending = true;
      await (async () => {
        for (const root of authority.knownSessionRoots()) {
          if (!(await authority.recheckSessionRoot(root))) {
            await authority.stop(root, stopOwned).catch(() => undefined);
          }
        }
      })().finally(() => { sweepPending = false; });
    });
  }
  return () => {
    if (stoppers.get(name) === stop) stoppers.delete(name);
    if (stoppers.size === 0 && stopPolling) { stopPolling(); stopPolling = undefined; }
  };
}

export async function acquireNativeWorkspacePaths(paths: readonly string[], operation: NativeWorkspaceOperation = "execute"): Promise<readonly NativeWorkspacePermit[]> {
  if (!nativeWorkspaceAuthorityEnabled) return [];
  if (paths.length === 0 || paths.length > 16) throw new Error("Native workspace execution context is missing.");
  const permits: NativeWorkspacePermit[] = [];
  try {
    for (const cwd of new Set(paths)) permits.push(await authority.acquire(cwd, operation));
    return permits;
  } catch (error) {
    for (const permit of permits) permit.release();
    throw error;
  }
}

export function releaseNativeWorkspacePermits(permits: readonly NativeWorkspacePermit[]): void {
  for (const permit of permits) permit.release();
}

export interface NativeWorkspaceLookup {
  readonly thread: (threadId: string) => Promise<string | null>;
  readonly project: (projectId: string) => Promise<string | null>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Explicit execution-context fields, not recursive inspection of user text. */
export async function acquireNativeRpcWorkspace(method: string, input: unknown, lookup: NativeWorkspaceLookup): Promise<readonly NativeWorkspacePermit[]> {
  if (!nativeWorkspaceAuthorityEnabled) return [];
  const value = asRecord(input);
  if (!value) throw new Error("Native workspace RPC context is missing.");
  if (method === "orchestration.dispatchCommand" && (value.type === "thread.session.stop" || value.type === "thread.turn.interrupt")) return [];
  const paths: string[] = [];
  const addPath = (candidate: unknown) => {
    if (candidate === undefined || candidate === null) return;
    if (typeof candidate !== "string" || !path.isAbsolute(candidate)) throw new Error("Invalid native workspace RPC path.");
    paths.push(candidate);
  };
  for (const field of ["cwd", "worktreePath", "workspaceRoot", "projectCwd"] as const) addPath(value[field]);
  if (typeof value.path === "string" && path.isAbsolute(value.path)) addPath(value.path);
  if (typeof value.threadId === "string") {
    const current = await lookup.thread(value.threadId);
    if (current !== null) addPath(current);
  }
  if (typeof value.projectId === "string") addPath(await lookup.project(value.projectId));
  const bootstrap = asRecord(value.bootstrap);
  const createThread = asRecord(bootstrap?.createThread);
  const prepareWorktree = asRecord(bootstrap?.prepareWorktree);
  if (createThread) {
    if (typeof createThread.projectId === "string") addPath(await lookup.project(createThread.projectId));
    addPath(createThread.worktreePath);
  }
  if (prepareWorktree) addPath(prepareWorktree.projectCwd);
  // Native terminals also have an independently guarded service boundary, where
  // their stored cwd is authoritative even for a terminal-only (non-chat) id.
  if (paths.length === 0 && method.startsWith("terminal.")) return [];
  const operation = method.startsWith("git.") || method.startsWith("vcs.") || method.startsWith("sourceControl.") || prepareWorktree ? "git" : "execute";
  return acquireNativeWorkspacePaths(paths, operation);
}

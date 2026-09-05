import { nativeWorkspacePath as path, canonicalizeNativeWorkspacePath } from "./nativeWorkspacePlatform.ts";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { EnvironmentAuthorizationError, TerminalCwdStatError, type AuthEnvironmentScope, type ProviderSession, type TerminalSummary } from "@t3tools/contracts";
import { ProviderValidationError } from "./provider/Errors.ts";
import type { TerminalManager } from "./terminal/Manager.ts";
import { isWithinNativeWorkspace } from "./nativeWorkspaceAuthority.ts";
import { acquireNativeRpcWorkspace, acquireNativeWorkspacePaths, bindNativeWorkspaceStopper, nativeWorkspaceAuthorityEnabled, releaseNativeWorkspacePermits, type NativeWorkspaceLookup } from "./cozeaWorkspaceControl.ts";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rpcDenied(requiredScope: AuthEnvironmentScope): EnvironmentAuthorizationError {
  return new EnvironmentAuthorizationError({ requiredScope, message: "Native workspace execution is not authorized. Reconnect or leave the collaboration session." });
}

export function guardNativeRpcEffect<A, E, R>(method: string, input: unknown, lookup: NativeWorkspaceLookup, requiredScope: AuthEnvironmentScope, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | EnvironmentAuthorizationError, R> {
  if (!nativeWorkspaceAuthorityEnabled) return effect;
  return Effect.acquireUseRelease(
    Effect.tryPromise({ try: () => acquireNativeRpcWorkspace(method, input, lookup), catch: () => rpcDenied(requiredScope) }),
    () => effect,
    permits => Effect.sync(() => releaseNativeWorkspacePermits(permits)),
  );
}

export function guardNativeRpcStream<A, E, R>(method: string, input: unknown, lookup: NativeWorkspaceLookup, requiredScope: AuthEnvironmentScope, stream: Stream.Stream<A, E, R>): Stream.Stream<A, E | EnvironmentAuthorizationError, R> {
  if (!nativeWorkspaceAuthorityEnabled) return stream;
  return Stream.unwrap(Effect.acquireRelease(
    Effect.tryPromise({ try: () => acquireNativeRpcWorkspace(method, input, lookup), catch: () => rpcDenied(requiredScope) }),
    permits => Effect.sync(() => releaseNativeWorkspacePermits(permits)),
  ).pipe(Effect.as(stream)));
}

export function guardNativeProviderEffect<A, E, R>(args: readonly unknown[], lookup: (threadId: string) => Promise<string | null>, fallbackCwd: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | ProviderValidationError, R> {
  if (!nativeWorkspaceAuthorityEnabled) return effect;
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: async () => {
        const first = record(args[0]);
        const input = typeof args[0] === "string" ? record(args[1]) : first;
        const threadId = typeof args[0] === "string" ? args[0] : first?.threadId;
        if (typeof threadId !== "string" || !threadId) throw new Error("Missing native thread identity.");
        const previous = await lookup(threadId);
        const paths: string[] = [];
        if (previous !== null) paths.push(previous);
        if (input?.cwd !== undefined) {
          if (typeof input.cwd !== "string") throw new Error("Invalid native execution path.");
          paths.push(input.cwd);
        }
        if (paths.length === 0) paths.push(fallbackCwd);
        return acquireNativeWorkspacePaths(paths);
      },
      catch: () => new ProviderValidationError({ operation: "ProviderService.workspaceAuthority", issue: "Native workspace execution is not authorized. Reconnect or leave the collaboration session." }),
    }),
    () => effect,
    permits => Effect.sync(() => releaseNativeWorkspacePermits(permits)),
  );
}

async function within(root: string, cwd: string): Promise<boolean> {
  // Removal of a directory cannot turn an already-running owned process into an
  // unrelated process. The catalog path remains the fallback shutdown identity.
  const canonical = await canonicalizeNativeWorkspacePath(cwd).catch(() => path.resolve(cwd));
  return isWithinNativeWorkspace(root, canonical);
}

export function bindNativeProviderStopper(input: {
  readonly list: () => Promise<readonly ProviderSession[]>;
  readonly stop: (threadId: string) => Promise<void>;
  readonly lookup: (threadId: string) => Promise<string | null>;
}): () => void {
  return bindNativeWorkspaceStopper("providers", async root => {
    const sessions = await input.list();
    const targets: string[] = [];
    let unresolved = false;
    for (const session of sessions) {
      if (session.status === "closed") continue;
      const cwd = session.cwd ?? await input.lookup(session.threadId);
      if (!cwd) { unresolved = true; continue; }
      if (await within(root, cwd)) targets.push(session.threadId);
    }
    const results = await Promise.allSettled([...new Set(targets)].map(input.stop));
    if (unresolved || results.some(result => result.status === "rejected")) throw new Error("Native provider shutdown was not confirmed.");
    for (const session of await input.list()) {
      if (session.status === "closed") continue;
      const cwd = session.cwd ?? await input.lookup(session.threadId);
      if (!cwd || await within(root, cwd)) throw new Error("A native provider remains active in the suspended workspace.");
    }
  });
}

export function installNativeTerminalAuthority(manager: TerminalManager["Service"]): Effect.Effect<TerminalManager["Service"], never, Scope.Scope> {
  if (!nativeWorkspaceAuthorityEnabled) return Effect.succeed(manager);
  return Effect.gen(function* () {
    const terminals = new Map<string, TerminalSummary>();
    const key = (threadId: string, terminalId: string) => JSON.stringify([threadId, terminalId]);
    yield* Effect.acquireRelease(manager.subscribeMetadata(event => Effect.sync(() => {
      if (event.type === "snapshot") {
        terminals.clear();
        for (const terminal of event.terminals) terminals.set(key(terminal.threadId, terminal.terminalId), terminal);
      } else if (event.type === "upsert") terminals.set(key(event.terminal.threadId, event.terminal.terminalId), event.terminal);
      else terminals.delete(key(event.threadId, event.terminalId));
    })), unsubscribe => Effect.sync(unsubscribe));
    const unbind = bindNativeWorkspaceStopper("terminals", async root => {
      const targets: TerminalSummary[] = [];
      for (const terminal of terminals.values()) {
        if (terminal.pid !== null && await within(root, terminal.worktreePath ?? terminal.cwd)) targets.push(terminal);
      }
      const results = await Promise.allSettled(targets.map(terminal => Effect.runPromise(manager.close({ threadId: terminal.threadId, terminalId: terminal.terminalId, deleteHistory: false }))));
      if (results.some(result => result.status === "rejected")) throw new Error("Native terminals did not stop.");
      for (const terminal of terminals.values()) {
        if (terminal.pid !== null && await within(root, terminal.worktreePath ?? terminal.cwd)) throw new Error("A native terminal remains active in the suspended workspace.");
      }
    });
    yield* Effect.addFinalizer(() => Effect.sync(unbind));
    const guard = <A, E, R>(input: { readonly threadId: string; readonly terminalId: string; readonly cwd?: string | undefined; readonly worktreePath?: string | null | undefined }, effect: Effect.Effect<A, E, R>) => Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => {
          const previous = terminals.get(key(input.threadId, input.terminalId));
          const paths: string[] = [];
          if (previous) paths.push(previous.worktreePath ?? previous.cwd);
          const next = input.worktreePath ?? input.cwd;
          if (next !== undefined) paths.push(next);
          return acquireNativeWorkspacePaths(paths);
        },
        catch: () => new TerminalCwdStatError({ cwd: "[restricted workspace]", cause: new Error("Native workspace execution is not authorized.") }),
      }),
      () => effect,
      permits => Effect.sync(() => releaseNativeWorkspacePermits(permits)),
    );
    return {
      ...manager,
      open: input => guard(input, manager.open(input)),
      attachStream: (input, listener) => guard(input, manager.attachStream(input, listener)),
      write: input => guard(input, manager.write(input)),
      restart: input => guard(input, manager.restart(input)),
      clear: input => guard(input, manager.clear(input)),
      resize: input => guard(input, manager.resize(input)),
      // Close is deliberately always available, even after role removal.
    } satisfies TerminalManager["Service"];
  });
}

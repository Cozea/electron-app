import path from "node:path";
import { realpath } from "node:fs/promises";

export type NativeWorkspaceOperation = "execute" | "git";

export interface NativeWorkspaceDecision {
  readonly allowed: boolean;
  /** null identifies an ordinary, non-collaboration workspace. */
  readonly sessionRoot: string | null;
}

export interface NativeWorkspacePermit {
  readonly cwd: string;
  readonly release: () => void;
}

interface ExecutionFlight {
  readonly cwd: string;
  readonly done: Promise<void>;
  readonly release: () => void;
}

interface RootRevision {
  readonly revision: number;
  readonly suspended: boolean;
}

export interface NativeWorkspaceAuthorityOptions {
  readonly authorize: (cwd: string, operation: NativeWorkspaceOperation) => Promise<NativeWorkspaceDecision>;
  readonly canonicalize?: (cwd: string) => Promise<string>;
  readonly drainTimeoutMs?: number;
}

export function isWithinNativeWorkspace(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function requireAbsolutePath(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 32_768 || value.includes("\0") || !path.isAbsolute(value)) {
    throw new Error("A verified native workspace path is required.");
  }
  return path.normalize(value);
}

function denied(): Error {
  return new Error("Native workspace execution is not authorized. Reconnect or leave the collaboration session.");
}

/**
 * A native provider/RPC operation holds a permit for its complete side-effecting
 * lifetime. Revocation first freezes admission, then stops owned resources,
 * drains admitted work and sweeps once more. A late authorization response can
 * never reopen a workspace; only an explicit host activation advances its epoch.
 * No source text, provider credentials or recovery material enters this class.
 */
export class NativeWorkspaceAuthority {
  private readonly options: NativeWorkspaceAuthorityOptions;
  private readonly roots = new Map<string, RootRevision>();
  private readonly sessionRoots = new Set<string>();
  private readonly flights = new Set<ExecutionFlight>();
  private readonly stopping = new Map<string, Promise<void>>();
  private revision = 0;

  constructor(options: NativeWorkspaceAuthorityOptions) {
    this.options = options;
    const deadline = options.drainTimeoutMs ?? 10_000;
    if (!Number.isFinite(deadline) || deadline < 0) throw new Error("Invalid native workspace drain deadline.");
  }

  private async canonicalize(cwd: string): Promise<string> {
    const valid = requireAbsolutePath(cwd);
    return requireAbsolutePath(await (this.options.canonicalize ?? realpath)(valid));
  }

  private revisionFor(cwd: string): number {
    let revision = 0;
    for (const [root, value] of this.roots) {
      if (isWithinNativeWorkspace(root, cwd)) revision = Math.max(revision, value.revision);
    }
    return revision;
  }

  private isSuspended(cwd: string): boolean {
    for (const [root, value] of this.roots) {
      if (value.suspended && isWithinNativeWorkspace(root, cwd)) return true;
    }
    return false;
  }

  private advance(root: string, suspended: boolean): void {
    // Never evict a revocation tombstone to make room: doing so can authorize a
    // response which was issued before a previous suspend/activate cycle.
    if (!this.roots.has(root) && this.roots.size >= 4_096) throw new Error("Native workspace authority capacity reached; restart the app safely.");
    this.roots.set(root, { revision: ++this.revision, suspended });
  }

  async acquire(cwd: string, operation: NativeWorkspaceOperation = "execute"): Promise<NativeWorkspacePermit> {
    if (operation !== "execute" && operation !== "git") throw denied();
    // realpath itself is asynchronous. An old request must not survive a
    // stop/activate cycle while its canonical workspace is still resolving.
    // Compare only this root's revision to preserve unrelated workspaces.
    const requestedAtRevision = this.revision;
    let canonical: string;
    try { canonical = await this.canonicalize(cwd); }
    catch { throw denied(); }
    const revision = this.revisionFor(canonical);
    if (this.isSuspended(canonical) || revision > requestedAtRevision) throw denied();
    let finish: () => void = () => undefined;
    const done = new Promise<void>(resolve => { finish = resolve; });
    let released = false;
    const flight: ExecutionFlight = {
      cwd: canonical,
      done,
      release: () => {
        if (released) return;
        released = true;
        this.flights.delete(flight);
        finish();
      },
    };
    // Admission is registered before asking the host. A Stop arriving while
    // authorization is in flight must drain this request too.
    this.flights.add(flight);
    try {
      const decision = await this.options.authorize(canonical, operation);
      if (decision.sessionRoot !== null) {
        const root = requireAbsolutePath(decision.sessionRoot);
        if (!isWithinNativeWorkspace(root, canonical)) throw denied();
        this.sessionRoots.add(root);
      }
      if (decision.allowed !== true || this.isSuspended(canonical) || revision !== this.revisionFor(canonical)) throw denied();
      return { cwd: canonical, release: flight.release };
    } catch {
      flight.release();
      throw denied();
    }
  }

  /** Host control paths are already catalog-canonical, including deleted roots. */
  activate(canonicalRoot: string): void {
    const root = requireAbsolutePath(canonicalRoot);
    if (this.stopping.has(root)) throw new Error("Native workspace shutdown is still in progress.");
    this.advance(root, false);
  }

  knownSessionRoots(): readonly string[] {
    return [...this.sessionRoots];
  }

  async recheckSessionRoot(root: string): Promise<boolean> {
    const valid = requireAbsolutePath(root);
    try {
      const decision = await this.options.authorize(valid, "execute");
      return decision.allowed === true && decision.sessionRoot === valid && !this.isSuspended(valid);
    } catch { return false; }
  }

  stop(canonicalRoot: string, stopOwned: (root: string) => Promise<void>): Promise<void> {
    const root = requireAbsolutePath(canonicalRoot);
    const existing = this.stopping.get(root);
    if (existing) return existing;
    this.advance(root, true);
    const operation = (async () => {
      let failed = false;
      // Stop currently running agents immediately; do not wait for a long turn
      // to release its permit before interrupting that same turn.
      try { await stopOwned(root); } catch { failed = true; }
      const pending = [...this.flights].filter(flight => isWithinNativeWorkspace(root, flight.cwd));
      if (pending.length > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.all(pending.map(flight => flight.done)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Native workspace actions did not drain.")), this.options.drainTimeoutMs ?? 10_000);
            }),
          ]);
        } catch { failed = true; }
        finally { if (timer !== undefined) clearTimeout(timer); }
      }
      // A start admitted before revocation may have installed its resource just
      // as the first sweep ran. It is now either drained or explicitly failed.
      try { await stopOwned(root); } catch { failed = true; }
      if (failed) throw new Error("Native workspace shutdown was not fully acknowledged; retry Leave.");
      this.sessionRoots.delete(root);
    })();
    this.stopping.set(root, operation);
    void operation.then(() => this.stopping.delete(root), () => this.stopping.delete(root));
    return operation;
  }
}

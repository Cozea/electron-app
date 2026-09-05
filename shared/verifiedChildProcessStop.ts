import type { ChildProcess } from "node:child_process";

type StoppableChild = Pick<ChildProcess, "exitCode" | "signalCode" | "kill" | "on" | "off">;

export interface ChildProcessStopOptions {
  readonly graceMs?: number;
  readonly killWaitMs?: number;
}

const pendingStops = new WeakMap<StoppableChild, Promise<void>>();
const hasExited = (child: StoppableChild): boolean =>
  child.exitCode != null || child.signalCode != null;

/**
 * A sent signal is not an exit acknowledgement. Install the listeners before
 * signalling, escalate even when `child.killed` is true, and reject if the OS
 * never confirms exit. A failed stop remains retryable by its owner.
 *
 * This verifies this child only; workspace-scoped provider shutdown must also
 * stop and acknowledge its owned sessions before acknowledging collaboration Leave.
 */
export function stopChildProcessVerified(
  child: StoppableChild | null,
  options: ChildProcessStopOptions = {},
): Promise<void> {
  if (!child || hasExited(child)) return Promise.resolve();
  const pending = pendingStops.get(child);
  if (pending) return pending;
  const graceMs = options.graceMs ?? 5_000;
  const killWaitMs = options.killWaitMs ?? 1_000;
  if (!Number.isFinite(graceMs) || graceMs < 0 || !Number.isFinite(killWaitMs) || killWaitMs < 0) {
    return Promise.reject(new Error("Invalid child shutdown deadline."));
  }

  const stopped = new Promise<void>((resolve, reject) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (success: boolean) => {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      child.off("exit", exited);
      child.off("error", signalError);
      if (success) resolve();
      else reject(new Error("Child process exit was not acknowledged; shutdown remains incomplete."));
    };
    const exited = () => finish(true);
    // kill() may emit error asynchronously as well as throw. Neither proves
    // exit. Keep the escalation deadline, without exposing subprocess details
    // or leaving an unhandled EventEmitter error during shutdown.
    const signalError = () => {
      if (hasExited(child)) finish(true);
    };
    const signal = (value: NodeJS.Signals) => {
      try {
        child.kill(value);
      } catch {
        signalError();
      }
    };

    child.on("exit", exited);
    child.on("error", signalError);
    if (hasExited(child)) {
      finish(true);
      return;
    }
    timer = setTimeout(() => {
      if (hasExited(child)) {
        finish(true);
        return;
      }
      // Install the final deadline before signalling: test doubles and very
      // short-lived processes can acknowledge exit synchronously.
      timer = setTimeout(() => finish(hasExited(child)), killWaitMs);
      signal("SIGKILL");
    }, graceMs);
    signal("SIGTERM");
  });
  const result = stopped.finally(() => pendingStops.delete(child));
  pendingStops.set(child, result);
  return result;
}

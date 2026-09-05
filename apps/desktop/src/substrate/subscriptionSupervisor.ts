export interface SubscriptionStatus {
  readonly phase: "connecting" | "connected" | "reconnecting" | "error";
  readonly attempt: number;
  readonly error: string | null;
}

export interface SubscriptionAttempt {
  isCurrent(): boolean;
  ready(): void;
  disconnected(error?: unknown): void;
  own(cleanup: () => void | Promise<void>): void;
}

/** Recreates subscriptions only. Commands must never be retried through this owner. */
export function superviseSubscription(options: {
  connect(attempt: SubscriptionAttempt): Promise<void>;
  status(status: SubscriptionStatus): void;
  schedule?: (callback: () => void, delay: number) => () => void;
  snapshotTimeoutMs?: number;
}): () => void {
  const schedule =
    options.schedule ??
    ((callback, delay) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
  let stopped = false;
  let generation = 0;
  let failures = 0;
  let cancelTimer: (() => void) | undefined;
  let cleanups: Array<() => void | Promise<void>> = [];
  const dispose = () => {
    cancelTimer?.();
    cancelTimer = undefined;
    const owned = cleanups;
    cleanups = [];
    for (const cleanup of owned)
      void Promise.resolve()
        .then(cleanup)
        .catch(() => {});
  };
  const run = () => {
    if (stopped) return;
    const id = ++generation;
    let ready = false;
    const isCurrent = () => !stopped && generation === id;
    options.status({
      phase: failures ? "reconnecting" : "connecting",
      attempt: failures,
      error: null,
    });
    const disconnected = (error?: unknown) => {
      if (!isCurrent()) return;
      ++generation;
      dispose();
      ++failures;
      options.status({
        phase: "error",
        attempt: failures,
        error: error instanceof Error ? error.message : "Subscription disconnected",
      });
      // Sparse global sequence numbers are expected; every attempt requests a snapshot.
      cancelTimer = schedule(run, Math.min(30_000, 500 * 2 ** Math.min(failures - 1, 6)));
    };
    cancelTimer = schedule(
      () => disconnected(new Error("Subscription snapshot timed out")),
      options.snapshotTimeoutMs ?? 60_000,
    );
    void options
      .connect({
        isCurrent,
        disconnected,
        ready: () => {
          if (!isCurrent() || ready) return;
          ready = true;
          cancelTimer?.();
          cancelTimer = undefined;
          failures = 0;
          options.status({ phase: "connected", attempt: 0, error: null });
        },
        own: (cleanup) => {
          if (isCurrent()) cleanups.push(cleanup);
          else
            void Promise.resolve()
              .then(cleanup)
              .catch(() => {});
        },
      })
      .catch(disconnected);
  };
  run();
  return () => {
    stopped = true;
    ++generation;
    dispose();
  };
}

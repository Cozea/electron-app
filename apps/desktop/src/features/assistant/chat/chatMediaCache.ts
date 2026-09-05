import { assetRefreshDelay } from "./chatMediaSource";
export interface ChatMediaState {
  url: string | null;
  error: boolean;
}
export function createChatMediaCache(options: {
  resolve(key: string, signal: AbortSignal): Promise<{ url: string; expiresAt: number }>;
  schedule?: (callback: () => void, delay: number) => () => void;
  now?: () => number;
}) {
  const schedule =
    options.schedule ??
    ((callback, delay) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
  const entries = new Map<
    string,
    { listeners: Set<(state: ChatMediaState) => void>; state: ChatMediaState; stop(): void }
  >();
  return (key: string, listener: (state: ChatMediaState) => void) => {
    let entry = entries.get(key);
    if (!entry) {
      const abort = new AbortController();
      let cancelTimer: (() => void) | undefined;
      const listeners = new Set<(state: ChatMediaState) => void>();
      const owned = {
        listeners,
        state: { url: null, error: false } as ChatMediaState,
        stop: () => {
          abort.abort();
          cancelTimer?.();
        },
      };
      entry = owned;
      entries.set(key, owned);
      const publish = (state: ChatMediaState) => {
        owned.state = state;
        for (const callback of listeners) callback(state);
      };
      const refresh = async () => {
        try {
          const result = await options.resolve(key, abort.signal);
          if (abort.signal.aborted) return;
          publish({ url: result.url, error: false });
          if (abort.signal.aborted) return;
          cancelTimer = schedule(
            () => void refresh(),
            assetRefreshDelay(result.expiresAt, options.now?.() ?? Date.now()),
          );
        } catch {
          if (abort.signal.aborted) return;
          publish({ url: null, error: true });
          if (abort.signal.aborted) return;
          cancelTimer = schedule(() => void refresh(), 30_000);
        }
      };
      void refresh();
    }
    entry.listeners.add(listener);
    listener(entry.state);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0) {
        entries.delete(key);
        entry.stop();
      }
    };
  };
}

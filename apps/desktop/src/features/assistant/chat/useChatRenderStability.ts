import { useCallback, useLayoutEffect, useRef } from "react";

/** Stable UI event identity, dispatching only to the latest committed handler. */
export function useCommittedChatCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const committed = useRef(callback);
  useLayoutEffect(() => {
    committed.current = callback;
  }, [callback]);
  return useCallback((...args: Args) => committed.current(...args), []);
}

export function reuseEqualMap<K, V>(
  previous: ReadonlyMap<K, V>,
  next: ReadonlyMap<K, V>,
): ReadonlyMap<K, V> {
  if (previous.size !== next.size) return next;
  for (const [key, value] of next) {
    if (!previous.has(key) || !Object.is(previous.get(key), value)) return next;
  }
  return previous;
}

/** Text-only message updates must not broadcast unchanged checkpoint metadata. */
export function useStableChatMap<K, V>(value: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const committed = useRef(value);
  const stable = reuseEqualMap(committed.current, value);
  useLayoutEffect(() => {
    committed.current = stable;
  }, [stable]);
  return stable;
}

import { useLayoutEffect, useRef, useState } from "react"

type Action = (...args: never[]) => unknown

/**
 * Stable functions that always call the latest version of each action, so a
 * memoized consumer is not invalidated by closures recreated every render.
 *
 * The object and its functions keep their identity for the component's life.
 * The set of action names is read once, on the first render.
 */
export function useStableActions<T extends { [K in keyof T]?: Action }>(actions: T): T {
  const latest = useRef(actions)
  useLayoutEffect(() => {
    latest.current = actions
  })
  const [stable] = useState(
    () =>
      Object.fromEntries(
        Object.keys(actions).map((name) => [
          name,
          (...args: never[]) => (latest.current[name as keyof T] as Action | undefined)?.(...args),
        ]),
      ) as T,
  )
  return stable
}

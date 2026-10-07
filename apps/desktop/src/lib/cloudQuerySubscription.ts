import type { ConvexReactClient, RequestForQueries, Watch } from "convex/react"

export type CloudQueryResults = Readonly<Record<string, unknown | Error | undefined>>

/** Watches are inert until subscribe; absent configuration never constructs a client. */
export function createCloudQuerySubscription(
  client: Pick<ConvexReactClient, "watchQuery"> | null,
  queries: RequestForQueries,
) {
  const watches = new Map<string, Watch<unknown>>()
  if (client) {
    for (const [key, request] of Object.entries(queries)) {
      watches.set(key, client.watchQuery(request.query, request.args))
    }
  }
  let dirty = true
  let snapshot: CloudQueryResults = {}

  const getSnapshot = (): CloudQueryResults => {
    if (!dirty) return snapshot
    dirty = false
    const next: Record<string, unknown | Error | undefined> = {}
    for (const key of Object.keys(queries)) {
      try {
        next[key] = watches.get(key)?.localQueryResult()
      } catch (error) {
        next[key] = error instanceof Error ? error : new Error(String(error))
      }
    }
    const keys = Object.keys(next)
    if (keys.length !== Object.keys(snapshot).length || keys.some((key) => !Object.is(next[key], snapshot[key]))) {
      snapshot = next
    }
    return snapshot
  }

  const subscribe = (notify: () => void): (() => void) => {
    const unsubscribes: Array<() => void> = []
    const onUpdate = () => {
      dirty = true
      notify()
    }
    try {
      for (const watch of watches.values()) unsubscribes.push(watch.onUpdate(onUpdate))
      // Close the read/subscribe race, including a reveal after Activity disconnected effects.
      onUpdate()
    } catch (error) {
      for (const unsubscribe of unsubscribes) unsubscribe()
      throw error
    }
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }

  return { getSnapshot, subscribe }
}

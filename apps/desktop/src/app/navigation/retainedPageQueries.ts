import type { ConvexReactClient } from "convex/react"
import { getFunctionName } from "convex/server"
import { convexToJson } from "convex/values"

/** Hidden Activity pages keep bounded presentation snapshots, never live cloud interest. */
export interface RetainedPageQueries {
  client: ConvexReactClient
  setVisible(visible: boolean): void
  /** Called on reveal and eviction; active subscriptions belong to the page. */
  release(): void
}

interface Watch {
  onUpdate(callback: () => void): () => void
  localQueryResult?(): unknown
}

export function createRetainedPageQueries(client: ConvexReactClient): RetainedPageQueries {
  let visible = true
  const snapshots = new Map<string, unknown>()
  const remember = (key: string, value: unknown) => {
    if (value === undefined || value instanceof Error) return
    snapshots.delete(key)
    snapshots.set(key, value)
    while (snapshots.size > 128) snapshots.delete(snapshots.keys().next().value!)
  }
  const retain = (watch: Watch, key: string): Watch => new Proxy(watch, {
    get(target, property) {
      if (property === "localQueryResult") return () => {
        const fresh = target.localQueryResult?.()
        remember(key, fresh)
        return fresh === undefined ? snapshots.get(key) : fresh
      }
      if (property === "onUpdate") return (callback: () => void) => {
        const unsubscribe = target.onUpdate(() => {
          remember(key, target.localQueryResult?.())
          callback()
        })
        return () => {
          if (!visible) remember(key, target.localQueryResult?.())
          unsubscribe()
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  const view = new Proxy(client, {
    get(target, property) {
      if (property === "watchQuery" || property === "watchPaginatedQuery") {
        const factories = target as unknown as Record<typeof property, (...args: unknown[]) => Watch>
        return (...args: unknown[]) => {
          const name = typeof args[0] === "string" ? args[0] : getFunctionName(args[0] as Parameters<typeof getFunctionName>[0])
          const key = JSON.stringify([property, name, convexToJson((args[1] ?? {}) as Parameters<typeof convexToJson>[0]), args[2] ?? null])
          return retain(factories[property](...args), key)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return {
    client: view,
    setVisible(next) { visible = next },
    release() { if (!visible) snapshots.clear() },
  }
}

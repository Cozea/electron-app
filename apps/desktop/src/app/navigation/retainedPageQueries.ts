import type { ConvexReactClient } from "convex/react"

/**
 * Keeps a hidden page's Convex queries subscribed until it is shown again.
 *
 * A retained page renders inside `<Activity mode="hidden">`, which disconnects
 * its effects, and Convex's hooks unsubscribe in an effect cleanup. On return
 * the page resubscribed from nothing: it rendered once with no data (its
 * loading state) and again when the result arrived. Holding a no-op
 * subscription while the page is hidden keeps the result in the client cache,
 * so the page comes back with the data it left with, kept current meanwhile.
 * This is the same mechanism as the client's own `prewarmQuery`.
 *
 * Unsubscribes while the page is visible (an argument change, a component
 * unmounting) pass straight through; only hiding holds anything.
 */
export interface RetainedPageQueries {
  client: ConvexReactClient
  /** Called in a layout effect, before the page's own effects are disconnected. */
  setVisible(visible: boolean): void
  /** Drops held subscriptions once the page has resubscribed, or is evicted. */
  release(): void
}

type Unsubscribe = () => void
interface Watch {
  onUpdate(callback: () => void): Unsubscribe
}

const noop = () => {}

export function createRetainedPageQueries(client: ConvexReactClient): RetainedPageQueries {
  let visible = true
  const held = new Set<Unsubscribe>()

  const retain = <W extends Watch>(watch: W): W => ({
    ...watch,
    onUpdate(callback: () => void) {
      const unsubscribe = watch.onUpdate(callback)
      return () => {
        // Subscribe the placeholder first so the query never drops to zero
        // listeners in between.
        if (!visible) held.add(watch.onUpdate(noop))
        unsubscribe()
      }
    },
  })

  const view = new Proxy(client, {
    get(target, property) {
      if (property === "watchQuery" || property === "watchPaginatedQuery") {
        // Both return a watch with `onUpdate`; watchPaginatedQuery is internal
        // to the client (usePaginatedQuery calls it) and untyped, and
        // watchQuery's generic arguments do not survive a spread.
        const watchFactory = target as unknown as Record<typeof property, (...args: unknown[]) => Watch>
        return (...args: unknown[]) => retain(watchFactory[property](...args))
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })

  return {
    client: view,
    setVisible(next) {
      visible = next
    },
    release() {
      for (const unsubscribe of held) unsubscribe()
      held.clear()
    },
  }
}

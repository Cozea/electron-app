import type { ConvexReactClient } from "convex/react"
import { describe, expect, it } from "vitest"

import { createRetainedPageQueries } from "@/app/navigation/retainedPageQueries"

/** A client whose watches count live subscriptions per query name. */
function fakeClient() {
  const live = new Map<string, number>()
  const results = new Map<string, unknown>()
  const watch = (name: string) => ({
    onUpdate() {
      live.set(name, (live.get(name) ?? 0) + 1)
      return () => live.set(name, (live.get(name) ?? 0) - 1)
    },
    localQueryResult: () => results.get(name),
  })
  const client = {
    watchQuery: (name: string) => watch(name),
    watchPaginatedQuery: (name: string) => watch(`paginated:${name}`),
    mutation: () => "mutated",
  }
  return { client: client as unknown as ConvexReactClient, live, results }
}

describe("retained page queries", () => {
  it("passes unsubscribes straight through while the page is visible", () => {
    const { client, live } = fakeClient()
    const queries = createRetainedPageQueries(client)
    const unsubscribe = queries.client.watchQuery("tasks" as never).onUpdate(() => {})
    unsubscribe()
    expect(live.get("tasks")).toBe(0)
  })

  it("releases hidden queries and restores their presentation snapshot on return", () => {
    const { client, live, results } = fakeClient()
    const queries = createRetainedPageQueries(client)
    results.set("tasks", { title: "saved" })
    const unsubscribe = queries.client.watchQuery("tasks" as never).onUpdate(() => {})

    queries.setVisible(false)
    unsubscribe()
    expect(live.get("tasks")).toBe(0)
    results.delete("tasks")

    queries.setVisible(true)
    const returned = queries.client.watchQuery("tasks" as never)
    returned.onUpdate(() => {})
    expect(returned.localQueryResult()).toEqual({ title: "saved" })
    results.set("tasks", { title: "fresh" })
    expect(returned.localQueryResult()).toEqual({ title: "fresh" })
    queries.release()
    expect(live.get("tasks")).toBe(1)
  })

  it("releases paginated queries while hidden", () => {
    const { client, live } = fakeClient()
    const queries = createRetainedPageQueries(client)
    const unsubscribe = (
      queries.client as unknown as { watchPaginatedQuery: (name: string) => { onUpdate(cb: () => void): () => void } }
    ).watchPaginatedQuery("feed").onUpdate(() => {})

    queries.setVisible(false)
    unsubscribe()
    expect(live.get("paginated:feed")).toBe(0)
    queries.release()
    expect(live.get("paginated:feed")).toBe(0)
  })

  it("delegates everything else to the real client", () => {
    const { client } = fakeClient()
    const queries = createRetainedPageQueries(client)
    expect((queries.client as unknown as { mutation: () => string }).mutation()).toBe("mutated")
  })
})

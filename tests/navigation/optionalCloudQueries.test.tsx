import { renderToStaticMarkup } from "react-dom/server"
import { ConvexReactClient } from "convex/react"
import { makeFunctionReference } from "convex/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConvexProvider } from "@/contexts/ConvexProvider"
import { AuthContext, type AuthContextType } from "@/contexts/AuthContext"
import { Onboarding } from "@/components/Onboarding"
import { CloudConnectionPrompt } from "@/components/CloudConnectionPrompt"
import {
  CloudClientContext, CloudUnavailableError, useAction, useConvex, useMutation, useQueries, useQuery,
} from "@/lib/cloudQueries"
import { createCloudQuerySubscription } from "@/lib/cloudQuerySubscription"
import { createRetainedPageQueries } from "@/app/navigation/retainedPageQueries"

vi.mock("@/lib/convex", () => ({ convex: null }))

const query = makeFunctionReference<"query", { id: string }, string>("projects:test")
const mutation = makeFunctionReference<"mutation", { name: string }, string>("projects:testMutation")
const action = makeFunctionReference<"action", { name: string }, string>("projects:testAction")

afterEach(() => vi.unstubAllGlobals())

describe("optional cloud queries", () => {
  it("renders first-run local onboarding and an unavailable cloud prompt without enrollment", () => {
    const enroll = vi.fn(async () => {})
    const update = vi.fn(async () => {})
    const auth: AuthContextType = {
      user: null, principalId: null, preferences: null, accessToken: null, personalWorkspace: null,
      localDevice: { identityKey: "czd_00000000000000000000000000", platform: "darwin",
        displayName: "This Device", avatarUrl: null, presentationConfigured: false, updatedAt: 0 },
      isLocalDeviceReady: true, localDeviceError: null, retryLocalDevice: async () => {}, updateLocalDevice: update,
      isAuthenticated: false, isConvexAuthReady: false, isLoading: false, isRevalidating: false,
      authError: null, needsOnboarding: true, retryDeviceSession: enroll, refreshToken: async () => "retryable",
    }
    const markup = renderToStaticMarkup(
      <ConvexProvider><AuthContext value={auth}><Onboarding /><CloudConnectionPrompt /></AuthContext></ConvexProvider>,
    )
    expect(markup).toContain("Name this device")
    expect(markup).toContain("Local projects remain available")
    expect(markup).not.toContain("Connect cloud features")
    expect(enroll).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it("renders the app provider and all hook kinds with no configured client or socket", async () => {
    const socket = vi.fn(() => { throw new Error("Unexpected connection") })
    vi.stubGlobal("WebSocket", socket)
    let executeMutation: ReturnType<typeof useMutation<typeof mutation>> | undefined
    let executeAction: ReturnType<typeof useAction<typeof action>> | undefined
    function LocalScreen() {
      expect(useConvex()).toBeNull()
      expect(useQuery(query, { id: "local" })).toBeUndefined()
      expect(useQuery(query, "skip")).toBeUndefined()
      expect(useQueries({ first: { query, args: { id: "local" } } })).toEqual({ first: undefined })
      executeMutation = useMutation(mutation)
      executeAction = useAction(action)
      return <p>Local project</p>
    }
    expect(renderToStaticMarkup(<ConvexProvider><LocalScreen /></ConvexProvider>)).toContain("Local project")
    await expect(executeMutation!({ name: "shared" })).rejects.toBeInstanceOf(CloudUnavailableError)
    await expect(executeAction!({ name: "shared" })).rejects.toBeInstanceOf(CloudUnavailableError)
    expect(socket).not.toHaveBeenCalled()
  })

  it("uses genuine configured SDK watches without connecting during render", async () => {
    const socket = vi.fn(() => { throw new Error("Unexpected connection") })
    vi.stubGlobal("WebSocket", socket)
    const client = new ConvexReactClient("http://127.0.0.1:3210")
    const watch = vi.spyOn(client, "watchQuery")
    const mutate = vi.spyOn(client, "mutation").mockResolvedValue("created")
    let execute: ReturnType<typeof useMutation<typeof mutation>> | undefined
    function Screen() {
      expect(useConvex()).toBe(client)
      expect(useQuery(query, { id: "shared" })).toBeUndefined()
      execute = useMutation(mutation)
      return <p>Shared service configured</p>
    }
    renderToStaticMarkup(<CloudClientContext value={client}><Screen /></CloudClientContext>)
    expect(watch).toHaveBeenCalledWith(query, { id: "shared" })
    expect(socket).not.toHaveBeenCalled()
    const update = vi.fn()
    await expect(execute!.withOptimisticUpdate(update)({ name: "shared" })).resolves.toBe("created")
    expect(mutate).toHaveBeenCalledWith(mutation, { name: "shared" }, { optimisticUpdate: update })
    await client.close()
  })

  it("keeps snapshots stable, closes subscribe races, and reports query errors as values", () => {
    let current: unknown = undefined
    let notifyWatch: (() => void) | undefined
    const stop = vi.fn()
    const client = {
      watchQuery: vi.fn(() => ({
        localQueryResult: () => {
          if (current instanceof Error) throw new Error(current.message)
          return current
        },
        onUpdate: (callback: () => void) => { notifyWatch = callback; return stop },
        localQueryLogs: () => undefined,
        journal: () => undefined,
      })),
    }
    const subscription = createCloudQuerySubscription(client, { result: { query, args: { id: "shared" } } })
    const first = subscription.getSnapshot()
    expect(subscription.getSnapshot()).toBe(first)
    current = "arrived before subscribe"
    const notify = vi.fn()
    const unsubscribe = subscription.subscribe(notify)
    expect(subscription.getSnapshot()).toEqual({ result: current })
    expect(notify).toHaveBeenCalledOnce()
    current = new Error("Membership denied")
    notifyWatch!()
    const failure = subscription.getSnapshot()
    expect(failure.result).toBeInstanceOf(Error)
    expect(subscription.getSnapshot()).toBe(failure)
    unsubscribe()
    expect(stop).toHaveBeenCalledOnce()
  })

  it("releases hidden subscriptions and observes fresh data on reveal", () => {
    let result = "first"
    let live = 0
    const client = {
      watchQuery: () => ({
        localQueryResult: () => result,
        onUpdate: () => { live++; return () => { live-- } },
        localQueryLogs: () => undefined,
        journal: () => undefined,
      }),
    } as unknown as ConvexReactClient
    const retained = createRetainedPageQueries(client)
    const subscription = createCloudQuerySubscription(retained.client, { result: { query, args: { id: "shared" } } })
    const stop = subscription.subscribe(() => {})
    expect(subscription.getSnapshot().result).toBe("first")
    retained.setVisible(false)
    stop()
    expect(live).toBe(0)
    result = "changed while hidden"
    retained.setVisible(true)
    const stopRevealed = subscription.subscribe(() => {})
    retained.release()
    expect(live).toBe(1)
    expect(subscription.getSnapshot().result).toBe(result)
    stopRevealed()
    expect(live).toBe(0)
  })

  it("cleans earlier subscriptions if a later watch fails to subscribe", () => {
    const stop = vi.fn()
    let count = 0
    const client = {
      watchQuery: () => ({
        localQueryResult: () => undefined,
        onUpdate: () => { if (count++ === 1) throw new Error("Closed client"); return stop },
        localQueryLogs: () => undefined,
        journal: () => undefined,
      }),
    }
    const request = { query, args: { id: "shared" } }
    const subscription = createCloudQuerySubscription(client, { first: request, second: request })
    expect(() => subscription.subscribe(() => {})).toThrow("Closed client")
    expect(stop).toHaveBeenCalledOnce()
  })
})

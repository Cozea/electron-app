import { createContext, useContext, useMemo, useSyncExternalStore } from "react"
import type { OptimisticUpdate } from "convex/browser"
import type {
  ConvexReactClient,
  MutationOptions,
  OptionalRestArgsOrSkip,
  ReactAction,
  ReactMutation,
  RequestForQueries,
} from "convex/react"
import {
  getFunctionName,
  type ArgsAndOptions,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type OptionalRestArgs,
} from "convex/server"
import { convexToJson } from "convex/values"

import { createCloudQuerySubscription } from "./cloudQuerySubscription"

export type { RequestForQueries } from "convex/react"

// This context represents service availability. Its value is always a genuine
// configured client (or the retained-query facade over one), never a dummy client.
export const CloudClientContext = createContext<ConvexReactClient | null>(null)

export class CloudUnavailableError extends Error {
  constructor() {
    super("Cloud features are unavailable in this build. Local projects remain available.")
    this.name = "CloudUnavailableError"
  }
}

export function useConvex(): ConvexReactClient | null {
  return useContext(CloudClientContext)
}

export function requireCloudClient(client: ConvexReactClient | null): ConvexReactClient {
  if (!client) throw new CloudUnavailableError()
  return client
}

type QueryResults<Queries extends RequestForQueries> = {
  [Key in keyof Queries]: FunctionReturnType<Queries[Key]["query"]> | Error | undefined
}

export function useQueries<Queries extends RequestForQueries>(queries: Queries): QueryResults<Queries> {
  const client = useConvex()
  // Generated function references and callers' argument objects have unstable identity.
  const key = JSON.stringify(Object.entries(queries).sort(([a], [b]) => a.localeCompare(b)).map(
    ([name, request]) => [name, getFunctionName(request.query), convexToJson(request.args)],
  ))
  const subscription = useMemo(
    () => createCloudQuerySubscription(client, queries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, key],
  )
  return useSyncExternalStore(subscription.subscribe, subscription.getSnapshot, subscription.getSnapshot) as QueryResults<Queries>
}

export function useQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const results = useQueries(args[0] === "skip" ? {} : { query: { query, args: args[0] ?? {} } })
  const result = results.query
  if (result instanceof Error) throw result
  return result as FunctionReturnType<Query> | undefined
}

function createMutation<Mutation extends FunctionReference<"mutation">>(
  client: ConvexReactClient | null,
  mutation: Mutation,
  optimisticUpdate?: OptimisticUpdate<FunctionArgs<Mutation>>,
): ReactMutation<Mutation> {
  const execute = async (...args: OptionalRestArgs<Mutation>): Promise<FunctionReturnType<Mutation>> => {
    const available = requireCloudClient(client)
    return available.mutation(mutation, ...([args[0] ?? {}, { optimisticUpdate }] as ArgsAndOptions<
      Mutation, MutationOptions<FunctionArgs<Mutation>>
    >))
  }
  const result = execute as ReactMutation<Mutation>
  result.withOptimisticUpdate = (update) => {
    if (optimisticUpdate) throw new Error(`Optimistic update already configured for ${getFunctionName(mutation)}`)
    return createMutation(client, mutation, update)
  }
  return result
}

export function useMutation<Mutation extends FunctionReference<"mutation">>(mutation: Mutation): ReactMutation<Mutation> {
  const client = useConvex()
  return useMemo(() => createMutation(client, mutation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, getFunctionName(mutation)])
}

export function useAction<Action extends FunctionReference<"action">>(action: Action): ReactAction<Action> {
  const client = useConvex()
  return useMemo(() => async (...args: OptionalRestArgs<Action>) => requireCloudClient(client).action(action, ...args),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, getFunctionName(action)])
}

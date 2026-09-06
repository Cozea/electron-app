import { useMemo } from "react"
import { useQueries, type RequestForQueries } from "convex/react"
import { convexToJson, type Value } from "convex/values"
import { getFunctionName, type FunctionReference } from "convex/server"

/**
 * A Convex query that reports failure as a value instead of throwing.
 *
 * `useQuery` from `convex/react` rethrows a failed query during render
 * (`if (result instanceof Error) throw result`). Under a route-level
 * `errorComponent` that turns any server-side rejection — an auth gap during
 * startup, a revoked device session, losing project membership — into a
 * full-view crash, even when the query only backs a decorative widget.
 *
 * This wrapper is built on `useQueries`, the stable primitive `useQuery` itself
 * uses, which already surfaces errors as `Error` values rather than throwing.
 *
 * Use it for anything whose failure should degrade to an empty state. Keep
 * plain `useQuery` where the data genuinely is the view and an error screen is
 * the right outcome.
 */

const QUERY_KEY = "safeConvexQuery"

export type SafeConvexQueryResult<TData> =
  | { status: "skipped"; data: undefined; error: null }
  | { status: "loading"; data: undefined; error: null }
  | { status: "error"; data: undefined; error: Error }
  | { status: "success"; data: TData; error: null }

export function useSafeConvexQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: Query["_args"] | "skip",
): SafeConvexQueryResult<Query["_returnType"]> {
  const skip = args === "skip"
  const argsObject = (skip ? {} : args) as Record<string, Value>
  // Depend on the function's *name*, never the reference. The generated `api`
  // object is a proxy that materialises a fresh function reference on every
  // property access, so `api.foo.bar` is a new identity each render. Keying the
  // memo on it rebuilds `queries` every render, which makes `useQueries`
  // resubscribe and set state during render — "Too many re-renders". This is
  // why convex/react's own useQuery keys on getFunctionName.
  const queryName = getFunctionName(query)

  const queries = useMemo(
    (): RequestForQueries => {
      if (skip) return {}
      return { [QUERY_KEY]: { query, args: argsObject } }
    },
    // Args are stringified for the same reason convex/react does it: callers
    // routinely build a fresh object each render, and comparing by identity
    // would resubscribe on every one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skip, queryName, JSON.stringify(convexToJson(argsObject))],
  )

  const result = useQueries(queries)[QUERY_KEY]

  return useMemo(() => {
    if (skip) return { status: "skipped", data: undefined, error: null }
    if (result instanceof Error) return { status: "error", data: undefined, error: result }
    if (result === undefined) return { status: "loading", data: undefined, error: null }
    return { status: "success", data: result, error: null }
  }, [result, skip])
}

import { createContext, useCallback, useContext, useMemo } from 'react'
import {
  Link as TanstackLink,
  Navigate as TanstackNavigate,
  Outlet as TanstackOutlet,
  RouterProvider as TanstackRouterProvider,
  useLocation as useTanstackLocation,
  useNavigate as useTanstackNavigate,
  useParams as useTanstackParams,
  useSearch as useTanstackSearch,
} from '@tanstack/react-router'

export { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

type RouterLocation = ReturnType<typeof useTanstackLocation>

/**
 * The route a retained page renders against. RetainedPageOutlet keeps recently
 * visited pages mounted while hidden; each one gets its own snapshot so the
 * hooks below answer with that page's route, never with whatever page is on
 * screen now. Outside a retained page there is no snapshot and the hooks read
 * the live router state as before.
 */
export interface RouteSnapshot {
  location: RouterLocation
  params: Record<string, string>
  search: Record<string, unknown>
}

export const RouteSnapshotContext = createContext<RouteSnapshot | null>(null)

// A constant selector keeps a snapshot consumer's live router subscription
// from re-rendering it on every navigation.
const selectNothing = () => null

export const Link = TanstackLink
export const Outlet = TanstackOutlet
export const RouterProvider = TanstackRouterProvider

export type To =
  | string
  | {
      pathname?: string
      search?: string
      hash?: string
    }

export interface NavigateOptions {
  replace?: boolean
  state?: unknown
}

// Returns the router's transition promise (resolves once the destination
// route has loaded) so callers like the View Transition wrapper can await the
// commit. Fire-and-forget callers can ignore it.
export type NavigateFunction = (to: To | number, options?: NavigateOptions) => void | Promise<void>

export function createPath(to: To): string {
  if (typeof to === 'string') {
    return to
  }

  const pathname = to.pathname ?? ''
  const search = to.search ?? ''
  const hash = to.hash ?? ''
  return `${pathname}${search}${hash}`
}

export function useNavigate(): NavigateFunction {
  const navigate = useTanstackNavigate({ from: '/' })

  return useCallback<NavigateFunction>(
    (to, options) => {
      if (typeof to === 'number') {
        window.history.go(to)
        return
      }

      if (typeof to === 'string') {
        return navigate({ to, replace: options?.replace, state: options?.state } as never) as unknown as Promise<void>
      }

      return navigate({ to: createPath(to), replace: options?.replace, state: options?.state } as never) as unknown as Promise<void>
    },
    [navigate]
  )
}

/**
 * Subscribes to router location. Prefer passing `select` to subscribe to a
 * narrow slice (e.g. `useLocation({ select: (l) => l.pathname })`): without it
 * the component re-renders on every navigation, including no-op clicks to the
 * current URL.
 */
export function useLocation<TSelected = ReturnType<typeof useTanstackLocation>>(options?: {
  select?: (location: ReturnType<typeof useTanstackLocation>) => TSelected
}): TSelected {
  const snapshot = useContext(RouteSnapshotContext)
  const live = useTanstackLocation((snapshot ? { select: selectNothing } : options) as never) as TSelected
  if (!snapshot) return live
  return (options?.select ? options.select(snapshot.location) : snapshot.location) as TSelected
}

export function useParams<TParams = any>() {
  const snapshot = useContext(RouteSnapshotContext)
  const live = useTanstackParams({ strict: false, ...(snapshot ? { select: selectNothing } : {}) } as never)
  return (snapshot ? snapshot.params : live) as TParams
}

export function useSearch<TSearch = any>() {
  const snapshot = useContext(RouteSnapshotContext)
  const live = useTanstackSearch({ strict: false, ...(snapshot ? { select: selectNothing } : {}) } as never)
  return (snapshot ? snapshot.search : live) as TSearch
}

export function useSearchParams() {
  // Subscribe to primitive slices only: the parsed `search` object and the
  // location object change identity on every navigation (even no-op clicks to
  // the current URL), which would re-render every consumer per click.
  const searchStr = useLocation({ select: (location) => location.searchStr ?? '' })
  const pathname = useLocation({ select: (location) => location.pathname })
  const hash = useLocation({ select: (location) => location.hash ?? '' })
  const navigate = useTanstackNavigate({ from: '/' })

  const searchParams = useMemo(() => new URLSearchParams(searchStr), [searchStr])

  const setSearchParams = useCallback(
    (
      next:
        | URLSearchParams
        | Record<string, unknown>
        | ((previous: URLSearchParams) => URLSearchParams | Record<string, unknown>),
      options?: { replace?: boolean }
    ) => {
      const previous = new URLSearchParams(searchParams)
      const resolved = typeof next === 'function' ? next(previous) : next
      const params = resolved instanceof URLSearchParams ? resolved : new URLSearchParams()

      if (!(resolved instanceof URLSearchParams)) {
        for (const [key, value] of Object.entries(resolved)) {
          if (value == null) continue
          if (Array.isArray(value)) {
            for (const item of value) {
              if (item != null) {
                params.append(key, String(item))
              }
            }
          } else {
            params.set(key, String(value))
          }
        }
      }

      const searchString = params.toString()
      const target = `${pathname}${searchString ? `?${searchString}` : ''}${hash}`

      navigate({
        to: target,
        replace: options?.replace,
      } as never)
    },
    [hash, pathname, navigate, searchParams]
  )

  return [searchParams, setSearchParams] as const
}

export function Navigate(props: React.ComponentProps<typeof TanstackNavigate> & { to: string }) {
  return <TanstackNavigate {...(props as any)} />
}

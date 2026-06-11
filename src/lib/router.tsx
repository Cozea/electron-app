import { useCallback, useMemo } from 'react'
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
  return useTanstackLocation(options as never) as TSelected
}

export function useParams<TParams = any>() {
  return useTanstackParams({ strict: false } as never) as TParams
}

export function useSearch<TSearch = any>() {
  return useTanstackSearch({ strict: false } as never) as TSearch
}

export function useSearchParams() {
  // Subscribe to primitive slices only: the parsed `search` object and the
  // location object change identity on every navigation (even no-op clicks to
  // the current URL), which would re-render every consumer per click.
  const searchStr = useTanstackLocation({
    select: (location: ReturnType<typeof useTanstackLocation>) => location.searchStr ?? '',
  } as never) as string
  const pathname = useTanstackLocation({
    select: (location: ReturnType<typeof useTanstackLocation>) => location.pathname,
  } as never) as string
  const hash = useTanstackLocation({
    select: (location: ReturnType<typeof useTanstackLocation>) => location.hash ?? '',
  } as never) as string
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

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

export type NavigateFunction = (to: To | number, options?: NavigateOptions) => void

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
        navigate({ to, replace: options?.replace, state: options?.state } as never)
        return
      }

      navigate({ to: createPath(to), replace: options?.replace, state: options?.state } as never)
    },
    [navigate]
  )
}

export function useLocation() {
  return useTanstackLocation()
}

export function useParams<TParams = any>() {
  return useTanstackParams({ strict: false } as never) as TParams
}

export function useSearch<TSearch = any>() {
  return useTanstackSearch({ strict: false } as never) as TSearch
}

export function useSearchParams() {
  const search = useTanstackSearch({ strict: false } as never) as Record<string, unknown>
  const navigate = useTanstackNavigate({ from: '/' })

  const searchParams = useMemo(() => {
    const params = new URLSearchParams()

    for (const [key, value] of Object.entries(search ?? {})) {
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

    return params
  }, [search])

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

      navigate({
        search: Object.fromEntries(params.entries()) as never,
        replace: options?.replace,
      } as never)
    },
    [navigate, searchParams]
  )

  return [searchParams, setSearchParams] as const
}

export function Navigate(props: React.ComponentProps<typeof TanstackNavigate> & { to: string }) {
  return <TanstackNavigate {...(props as any)} />
}

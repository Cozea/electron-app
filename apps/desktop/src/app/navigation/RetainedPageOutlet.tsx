import {
  Activity,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import { useRouter, useRouterState } from "@tanstack/react-router"
import { ConvexProvider, useConvex } from "convex/react"

import { RegionErrorBoundary } from "@/components/RegionErrorBoundary"
import { RETAINED_PAGE_ATTRIBUTE } from "@/lib/activePageDom"
import { Outlet, RouteSnapshotContext, type RouteSnapshot } from "@/lib/router"

import { createRetainedPageQueries } from "./retainedPageQueries"

/**
 * Pages kept mounted at once: the visible one plus four hidden. A desktop app
 * is expected to return to a page exactly as it was left — scroll, filters,
 * half-typed input, loaded data — without rebuilding it. The workbench already
 * works that way through its persistent surface; this does the same for the
 * ordinary pages whose routes set `staticData.retainPage`.
 */
export const MAX_RETAINED_PAGES = 5

interface RetainedRouterState {
  location: RouteSnapshot["location"]
  matches: ReadonlyArray<{
    pathname: string
    routeId: string
    params: Record<string, string>
    search: Record<string, unknown>
    staticData?: { retainPage?: boolean }
  }>
}

interface RetainedPage {
  key: string
  routeId: string
  Component: ComponentType
  snapshot: RouteSnapshot
}

/**
 * Least-recently-visited order with the current page last. Pages beyond the
 * limit are dropped from the front, which unmounts them.
 */
export function retainPage<T extends { key: string }>(
  pages: ReadonlyMap<string, T>,
  page: T,
  limit = MAX_RETAINED_PAGES,
): Map<string, T> {
  const next = new Map(pages)
  next.delete(page.key)
  next.set(page.key, page)
  for (const key of next.keys()) {
    if (next.size <= limit) break
    next.delete(key)
  }
  return next
}

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
}

/**
 * Hidden pages render inside `<Activity mode="hidden">`: React keeps their
 * state and DOM but disconnects their effects, so a hidden page cannot set the
 * header, listen to shortcuts or poll. Each page reads its own route through
 * RouteSnapshotContext, frozen while hidden. Routes that are not retained
 * (workbench, redirects, one-off flows) render through the ordinary outlet.
 */
export function RetainedPageOutlet() {
  const router = useRouter()
  // Read as a narrow shape: the installed router packages carry two copies of
  // the router-core types, which defeats `useRouterState({ select })` inference.
  const routerState = useRouterState() as unknown as RetainedRouterState
  const leaf = routerState.matches[routerState.matches.length - 1]
  const current = leaf?.staticData?.retainPage
    ? {
        key: leaf.pathname,
        routeId: leaf.routeId,
        location: routerState.location,
        params: leaf.params,
        search: leaf.search,
      }
    : null

  const currentKey = current?.key ?? null
  const pagesRef = useRef<Map<string, RetainedPage>>(new Map())
  const existing = currentKey ? pagesRef.current.get(currentKey) : undefined

  // Keep the page's snapshot object while its URL is unchanged: a new object
  // would change the context value and re-render the whole page on return,
  // which is the cost retaining it is meant to remove.
  const currentHref = current?.location.href ?? null
  // While a navigation is pending, `location` already holds the destination
  // but `matches` still describe the page being left. Pairing the two handed
  // that page the new URL, re-rendering it several times per navigation.
  const locationIsForLeaf =
    !current || stripTrailingSlash(current.location.pathname) === stripTrailingSlash(current.key)
  const snapshot = useMemo<RouteSnapshot | null>(() => {
    if (!current) return null
    if (existing && (!locationIsForLeaf || existing.snapshot.location.href === current.location.href)) {
      return existing.snapshot
    }
    return { location: current.location, params: current.params, search: current.search }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, currentHref, locationIsForLeaf])

  if (current && snapshot) {
    const Component =
      existing?.routeId === current.routeId
        ? existing.Component
        : (router.routesById[current.routeId as keyof typeof router.routesById]?.options
            .component as ComponentType | undefined)
    const isMostRecent = [...pagesRef.current.keys()].at(-1) === current.key
    if (Component && (existing?.snapshot !== snapshot || !isMostRecent)) {
      pagesRef.current = retainPage(pagesRef.current, {
        key: current.key,
        routeId: current.routeId,
        Component,
        snapshot,
      })
    }
  }

  const retained = [...pagesRef.current.values()]
  const showsRetainedPage = currentKey !== null && pagesRef.current.has(currentKey)

  return (
    <>
      {showsRetainedPage ? null : <Outlet />}
      {retained.map((page) => (
        <RetainedPageSlot
          key={page.key}
          pageKey={page.key}
          visible={page.key === currentKey}
          Component={page.Component}
          snapshot={page.snapshot}
        />
      ))}
    </>
  )
}

/**
 * One kept page. Memoized on primitive and stable props so that navigating
 * elsewhere skips every page whose visibility and route did not change;
 * without it each navigation re-rendered all hidden pages as well.
 */
const RetainedPageSlot = memo(function RetainedPageSlot({
  pageKey,
  visible,
  Component,
  snapshot,
}: {
  pageKey: string
  visible: boolean
  Component: ComponentType
  snapshot: RouteSnapshot
}) {
  const convex = useConvex()
  const [queries] = useState(() => (convex ? createRetainedPageQueries(convex) : null))

  // Layout effect: runs before the hidden page's own effects are disconnected,
  // so its Convex unsubscribes on hide see the page as hidden.
  useLayoutEffect(() => {
    queries?.setVisible(visible)
  }, [queries, visible])
  // Passive effect: runs after the page's own effects, so on reveal the page
  // has resubscribed before its held subscriptions are dropped.
  useEffect(() => {
    if (visible) queries?.release()
  }, [queries, visible])
  useEffect(() => () => queries?.release(), [queries])

  const page = (
    <RetainedPageFrame visible={visible}>
      <Activity mode={visible ? "visible" : "hidden"} name={`page:${pageKey}`}>
        <RouteSnapshotContext.Provider value={snapshot}>
          {/* Pages render outside TanStack's per-match boundary, so each gets its own. */}
          <RegionErrorBoundary>
            <Component />
          </RegionErrorBoundary>
        </RouteSnapshotContext.Provider>
      </Activity>
    </RetainedPageFrame>
  )
  return queries ? <ConvexProvider client={queries.client}>{page}</ConvexProvider> : page
})

/**
 * Hidden elements lose their scroll offset, so positions are recorded while
 * the page is visible — its own scrollers and the shell's shared content
 * container — and put back when it is shown again.
 */
function RetainedPageFrame({ visible, children }: { visible: boolean; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const positionsRef = useRef(new Map<Element, number>())

  useEffect(() => {
    const root = rootRef.current
    if (!visible || !root) return
    const container = root.parentElement
    const record = (event: Event) => {
      const target = event.target
      if (target instanceof Element) positionsRef.current.set(target, target.scrollTop)
    }
    root.addEventListener("scroll", record, { capture: true, passive: true })
    container?.addEventListener("scroll", record, { passive: true })
    return () => {
      root.removeEventListener("scroll", record, { capture: true })
      container?.removeEventListener("scroll", record)
    }
  }, [visible])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!visible || !root) return
    const container = root.parentElement
    if (container && !positionsRef.current.has(container)) {
      // A page seen for the first time starts at the top, not wherever the
      // previous page left the shared container.
      container.scrollTop = 0
    }
    for (const [element, top] of positionsRef.current) {
      if (element.isConnected) element.scrollTop = top
      else positionsRef.current.delete(element)
    }
  }, [visible])

  return (
    <div ref={rootRef} className="contents" {...{ [RETAINED_PAGE_ATTRIBUTE]: visible ? "visible" : "hidden" }}>
      {children}
    </div>
  )
}

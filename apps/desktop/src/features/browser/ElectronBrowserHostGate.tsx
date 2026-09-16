import { lazy, Suspense } from 'react'

import { useBrowserSurfaceRegistry } from './browserSurfaceRegistry'

const LazyElectronBrowserHost = lazy(() =>
  import('./ElectronBrowserHost').then((module) => ({ default: module.ElectronBrowserHost })),
)

export function ElectronBrowserHostGate() {
  const hasBrowserSurfaces = useBrowserSurfaceRegistry(
    (state) => Object.keys(state.byTabId).length > 0,
  )
  const shouldLoad = hasBrowserSurfaces

  if (!shouldLoad) return null

  return (
    <Suspense fallback={null}>
      <LazyElectronBrowserHost />
    </Suspense>
  )
}

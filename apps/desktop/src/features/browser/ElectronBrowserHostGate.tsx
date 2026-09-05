import { lazy, Suspense } from 'react'

import { featureFlags } from '@/lib/featureFlags'
import { useBrowserSurfaceRegistry } from './browserSurfaceRegistry'

const LazyElectronBrowserHost = lazy(() =>
  import('./ElectronBrowserHost').then((module) => ({ default: module.ElectronBrowserHost })),
)

export function ElectronBrowserHostGate() {
  const hasBrowserSurfaces = useBrowserSurfaceRegistry(
    (state) => Object.keys(state.byTabId).length > 0,
  )
  const shouldLoad = featureFlags.lazyRendererHosts ? hasBrowserSurfaces : true

  if (!shouldLoad) return null

  return (
    <Suspense fallback={null}>
      <LazyElectronBrowserHost />
    </Suspense>
  )
}

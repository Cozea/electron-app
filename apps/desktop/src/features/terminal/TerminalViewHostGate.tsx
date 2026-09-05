import { lazy, Suspense } from 'react'

import { featureFlags } from '@/lib/featureFlags'
import { useTerminalViewKeepAlive } from './terminalViewKeepAlive'

const LazyTerminalViewHost = lazy(() =>
  import('./TerminalViewHost').then((module) => ({ default: module.TerminalViewHost })),
)

export function TerminalViewHostGate() {
  const hasTerminalViews = useTerminalViewKeepAlive(
    (state) => Object.keys(state.views).length > 0,
  )
  const shouldLoad = featureFlags.lazyRendererHosts ? hasTerminalViews : true

  if (!shouldLoad) return null

  return (
    <Suspense fallback={null}>
      <LazyTerminalViewHost />
    </Suspense>
  )
}

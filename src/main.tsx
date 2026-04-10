import React from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from "@/lib/router"

import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@xterm/xterm/css/xterm.css'
import './lib/immer'
import './index.css'
import { ConvexProvider } from './contexts/ConvexProvider'
import { ToastProvider } from './features/projects/components/assistant/ui/toast'
import { applyThemeClass, getStoredThemePreference } from './lib/theme'

import { initJankDiagnostics } from './lib/performance/jankDiagnostics'
import { appRouter } from './router/routes'

const RENDERER_BOOTSTRAP_ROUTE_QUERY_KEY = 'cozeaRoute'

function applyBootstrapRouteFromSearch(): void {
  if (window.location.protocol !== 'file:') {
    return
  }

  let bootstrapRoute: string | null = null

  try {
    const url = new URL(window.location.href)
    bootstrapRoute = url.searchParams.get(RENDERER_BOOTSTRAP_ROUTE_QUERY_KEY)
  } catch {
    bootstrapRoute = null
  }

  if (!bootstrapRoute || !bootstrapRoute.startsWith('/')) {
    return
  }

  window.history.replaceState(window.history.state, '', bootstrapRoute)
}


;(globalThis as { __COZEA_OFFSCREEN_SCREENSHOT_FLAG__?: string }).__COZEA_OFFSCREEN_SCREENSHOT_FLAG__ =
  import.meta.env.VITE_FF_OFFSCREEN_SCREENSHOT

initJankDiagnostics()
applyBootstrapRouteFromSearch()

const platform = window.electronAPI?.platform
if (platform) {
  document.documentElement.dataset.platform = platform
  document.documentElement.classList.add(`platform-${platform}`)
}

applyThemeClass(getStoredThemePreference())

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConvexProvider>
      <ToastProvider>
        <RouterProvider router={appRouter} />
      </ToastProvider>
    </ConvexProvider>
  </React.StrictMode>,
)

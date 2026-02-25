import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, RouterProvider } from 'react-router-dom'

import './index.css'
import { ConvexProvider } from './contexts/ConvexProvider'
import { featureFlags } from './lib/featureFlags'
import { initJankDiagnostics } from './lib/performance/jankDiagnostics'
import { appRouter } from './router/createRouter'
import { LegacyRouterApp } from './router/LegacyRouterApp'

;(globalThis as { __COZEA_OFFSCREEN_SCREENSHOT_FLAG__?: string }).__COZEA_OFFSCREEN_SCREENSHOT_FLAG__ =
  import.meta.env.VITE_FF_OFFSCREEN_SCREENSHOT

initJankDiagnostics()

const platform = window.electronAPI?.platform
if (platform) {
  document.documentElement.dataset.platform = platform
  document.documentElement.classList.add(`platform-${platform}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProvider>
      {featureFlags.dataRouter ? (
        <RouterProvider router={appRouter} />
      ) : (
        <BrowserRouter>
          <LegacyRouterApp />
        </BrowserRouter>
      )}
    </ConvexProvider>
  </StrictMode>,
)

import React from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from "@tanstack/react-router"

import './lib/immer'
import './index.css'
import { ConvexProvider } from './contexts/ConvexProvider'
import { applyThemeClass, getStoredThemePreference } from './lib/theme'

import { initJankDiagnostics } from './lib/performance/jankDiagnostics'
import { appRouter } from './router/routes'


;(globalThis as { __COZEA_OFFSCREEN_SCREENSHOT_FLAG__?: string }).__COZEA_OFFSCREEN_SCREENSHOT_FLAG__ =
  import.meta.env.VITE_FF_OFFSCREEN_SCREENSHOT

initJankDiagnostics()

const platform = window.electronAPI?.platform
if (platform) {
  document.documentElement.dataset.platform = platform
  document.documentElement.classList.add(`platform-${platform}`)
}

applyThemeClass(getStoredThemePreference())

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConvexProvider>
      <RouterProvider router={appRouter} />
    </ConvexProvider>
  </React.StrictMode>,
)

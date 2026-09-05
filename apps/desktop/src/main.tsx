import React from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from "@/lib/router"

import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import './lib/immer'
import './index.css'
import { ConvexProvider } from './contexts/ConvexProvider'
import { ToastProvider } from './features/assistant/ui/toast'
import { applyThemeClass, getStoredThemePreference } from './lib/theme'
import { applyStoredLanguage } from './lib/i18n'

import { initJankDiagnostics } from './lib/performance/jankDiagnostics'
import { markCozeaPerformance, measureCozeaPerformance } from './lib/performance/marks'
import { appRouter } from './router/routes'
import { ElectronBrowserHostGate } from './features/browser/ElectronBrowserHostGate'
import {
  applyDesktopBootstrapRoute,
  initializeDesktopBootstrap,
} from './app/bootstrap/desktopBootstrap'
import { featureFlags } from './lib/featureFlags'
import type { DesktopBootstrapSnapshot } from '@shared/desktopBootstrapTypes'

const RENDERER_BOOTSTRAP_ROUTE_QUERY_KEY = 'cozeaRoute'
const rendererEntryMark = markCozeaPerformance('renderer:entry')

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

async function prewarmRestoredWorkbench(bootstrap: DesktopBootstrapSnapshot): Promise<void> {
  const locator = bootstrap.lastWorkbenchRoute
  const workbenchModule = await import('./lib/workbenchStore')

  const matchingWorkbenches = locator
    ? Object.values(workbenchModule.useProjectWorkbenchStore.getState().workbenches).filter(
        (workbench) =>
          workbench.projectId === locator.projectId &&
          workbench.laneId === locator.laneId,
      )
    : []
  const restoredTileTypes = new Set(
    matchingWorkbenches.flatMap((workbench) =>
      Object.values(workbench.tiles).map((tile) => tile.type),
    ),
  )

  const warmups: Array<Promise<unknown>> = [
    import('./features/projects/pages/ProjectWorkbenchPage'),
  ]

  if (featureFlags.lazyRendererHosts) {
    if (restoredTileTypes.has('terminal') || restoredTileTypes.has('devServer')) {
      warmups.push(import('./features/terminal/TerminalViewHost'))
    }
    if (
      restoredTileTypes.has('browser') ||
      restoredTileTypes.has('devServer') ||
      restoredTileTypes.has('devAppPreview') ||
      restoredTileTypes.has('orgDevApp')
    ) {
      warmups.push(import('./features/browser/ElectronBrowserHost'))
    }
  }

  await Promise.all(warmups)
}

;(globalThis as { __COZEA_OFFSCREEN_SCREENSHOT_FLAG__?: string }).__COZEA_OFFSCREEN_SCREENSHOT_FLAG__ =
  import.meta.env.VITE_FF_OFFSCREEN_SCREENSHOT

async function startRenderer(): Promise<void> {
  initJankDiagnostics()
  applyBootstrapRouteFromSearch()

  const bootstrapStartMark = markCozeaPerformance('renderer:desktop-bootstrap-start')
  const bootstrap = await initializeDesktopBootstrap()
  const bootstrapEndMark = markCozeaPerformance('renderer:desktop-bootstrap-ready')
  measureCozeaPerformance('renderer:desktop-bootstrap', bootstrapStartMark, bootstrapEndMark)
  applyDesktopBootstrapRoute(bootstrap)

  if (
    featureFlags.commonRoutePrewarm &&
    window.location.pathname.endsWith('/workbench')
  ) {
    const workbenchWarmStart = markCozeaPerformance('renderer:workbench-code-prewarm-start')
    await prewarmRestoredWorkbench(bootstrap)
    const workbenchWarmEnd = markCozeaPerformance('renderer:workbench-code-prewarm-end')
    measureCozeaPerformance('renderer:workbench-code-prewarm', workbenchWarmStart, workbenchWarmEnd)
  }

  const platform = window.electronAPI?.platform
  if (platform) {
    document.documentElement.dataset.platform = platform
    document.documentElement.classList.add(`platform-${platform}`)
  }

  applyThemeClass(getStoredThemePreference())
  applyStoredLanguage()

  const rootRenderStartMark = markCozeaPerformance('renderer:root-render-start')
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ConvexProvider>
        <ToastProvider>
          <RouterProvider router={appRouter} />
          <ElectronBrowserHostGate />
        </ToastProvider>
      </ConvexProvider>
    </React.StrictMode>,
  )

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const firstFrameMark = markCozeaPerformance('renderer:first-frame')
      measureCozeaPerformance('renderer:entry-to-root-render-start', rendererEntryMark, rootRenderStartMark)
      measureCozeaPerformance('renderer:entry-to-first-frame', rendererEntryMark, firstFrameMark)
    })
  })
}

void startRenderer().catch((error) => {
  console.error('[Renderer] Failed to initialize the desktop bootstrap.', error)
  const root = document.getElementById('root')
  if (root) {
    root.textContent = 'Cozea could not initialize its local desktop state. Restart the application to retry.'
  }
})

import { lazy, Suspense, useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import { Outlet, useLocation } from '@/lib/router'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { CreateProjectDialogHost } from './features/projects/components/CreateProjectDialogHost'
import { TooltipProvider } from './components/ui/tooltip'
import { useViewTransitionNavigate } from './lib/navigation'
import { getSettingsRouteFromLocation, writeSettingsRouteToUrl } from './lib/settingsDrawerUrl'
import { useSettingsDrawerStore } from './stores/useSettingsDrawerStore'
import { WorkspaceRuntimeHostsGate } from '@/features/projects/workspaces/WorkspaceRuntimeHostsGate'

const LazyLogin = lazy(() =>
  import('./pages/Login').then((module) => ({
    default: module.Login,
  })),
)
const LazyOnboarding = lazy(() =>
  import('./components/Onboarding').then((module) => ({
    default: module.Onboarding,
  })),
)
const LazyUpdateMenu = lazy(() =>
  import('./components/updates/UpdateMenu').then((module) => ({
    default: module.UpdateMenu,
  })),
)
const LazySettingsDrawer = lazy(() =>
  import('./components/settings/SettingsDrawer').then((module) => ({
    default: module.SettingsDrawer,
  })),
)

function LazySurface({ children }: { children: ReactNode }) {
  return <Suspense fallback={<FullscreenLoading />}>{children}</Suspense>
}

function DeferredUpdateMenu({ enabled }: { enabled: boolean }) {
  const [shouldLoad, setShouldLoad] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setShouldLoad(false)
      return
    }

    return scheduleIdleWarmup(() => {
      setShouldLoad(true)
    }, { delayMs: 5_000, timeoutMs: 15_000 })
  }, [enabled])

  if (!enabled || !shouldLoad) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <LazyUpdateMenu />
    </Suspense>
  )
}

function SettingsDrawerHost({ enabled }: { enabled: boolean }) {
  const isOpen = useSettingsDrawerStore((state) => state.isOpen)

  if (!enabled || !isOpen) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <LazySettingsDrawer />
    </Suspense>
  )
}

function scheduleIdleWarmup(
  callback: () => void,
  options: { delayMs: number; timeoutMs: number },
) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions,
    ) => number
    cancelIdleCallback?: (handle: number) => void
  }
  let idleHandle: number | null = null
  const timeoutHandle = window.setTimeout(() => {
    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(callback, {
        timeout: options.timeoutMs,
      })
      return
    }

    callback()
  }, options.delayMs)

  return () => {
    window.clearTimeout(timeoutHandle)
    if (idleHandle !== null) {
      idleWindow.cancelIdleCallback?.(idleHandle)
    }
  }
}

function FullscreenLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="preview-loading-spinner" aria-label="Loading Cozea" role="status">
        <div className="preview-loading-spinner-square" />
        <div className="preview-loading-spinner-square" />
        <div className="preview-loading-spinner-square" />
        <div className="preview-loading-spinner-square" />
        <div className="preview-loading-spinner-square" />
      </div>
    </div>
  )
}

function ElectronNavigationBridge() {
  const navigate = useViewTransitionNavigate()
  const handleElectronNavigation = useEffectEvent((path: string) => {
    if (typeof path === 'string' && path.startsWith('/')) {
      navigate(path)
    }
  })

  useEffect(() => {
    const unsubscribe = window.electronAPI?.app?.onNavigate?.((path) => {
      handleElectronNavigation(path)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  return null
}

function ElectronSettingsBridge() {
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.openFromRoute)
  const handleElectronSettingsOpen = useEffectEvent((route: string) => {
    openSettingsDrawer(route)
  })

  useEffect(() => {
    const unsubscribe = window.electronAPI?.app?.onOpenSettings?.((route) => {
      handleElectronSettingsOpen(route)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  return null
}

function SettingsDrawerUrlBridge() {
  const isOpen = useSettingsDrawerStore((state) => state.isOpen)
  const route = useSettingsDrawerStore((state) => state.route)
  const openFromRoute = useSettingsDrawerStore((state) => state.openFromRoute)
  const close = useSettingsDrawerStore((state) => state.close)

  const syncFromLocation = useEffectEvent(() => {
    const routeFromLocation = getSettingsRouteFromLocation(window.location)
    if (routeFromLocation) {
      if (!isOpen || route !== routeFromLocation) {
        openFromRoute(routeFromLocation)
      }
      return
    }

    if (isOpen) {
      close()
    }
  })

  useEffect(() => {
    syncFromLocation()

    const handleLocationChange = () => {
      syncFromLocation()
    }

    window.addEventListener('hashchange', handleLocationChange)
    window.addEventListener('popstate', handleLocationChange)

    return () => {
      window.removeEventListener('hashchange', handleLocationChange)
      window.removeEventListener('popstate', handleLocationChange)
    }
  }, [])

  useEffect(() => {
    writeSettingsRouteToUrl(isOpen ? route : null)
  }, [isOpen, route])

  return null
}

function AppContent() {
  const {
    isAuthenticated,
    isLoading,
    needsOnboarding,
  } = useAuth()
  const location = useLocation()
  const isSettingsWindow = window.electronAPI?.windowContext === 'settings'

  useEffect(() => {
    if (!isAuthenticated || isLoading || needsOnboarding) return

    const shouldWarmNewProject =
      location.pathname === "/projects" || location.pathname === "/projects/"
    const shouldWarmProjectEditor =
      location.pathname.startsWith('/projects/') &&
      !location.pathname.startsWith('/projects/new') &&
      !location.pathname.endsWith('/workbench')

    if (!shouldWarmNewProject && !shouldWarmProjectEditor) {
      return
    }

    return scheduleIdleWarmup(() => {
      if (shouldWarmNewProject) {
        void import('./pages/NewProject')
      }
      if (shouldWarmProjectEditor) {
        void import('./features/projects/pages/ProjectWorkbenchPage')
      }
    }, { delayMs: 3_500, timeoutMs: 12_000 })
  }, [isAuthenticated, isLoading, location.pathname, needsOnboarding])

  useEffect(() => {
    if (!isAuthenticated || isLoading || needsOnboarding) {
      return
    }

    if (location.pathname.endsWith('/workbench')) {
      return
    }

    return scheduleIdleWarmup(() => {
      void import('./pages/settings/Tooling').then((module) =>
        module.prewarmToolingSettings?.()
      )
    }, { delayMs: 6_000, timeoutMs: 15_000 })
  }, [isAuthenticated, isLoading, location.pathname, needsOnboarding])

  if (isLoading) {
    return <FullscreenLoading />
  }

  const isProjectJoinRoute =
    location.pathname.startsWith('/projects/join/') ||
    location.pathname.startsWith('/join/project/')
  const isProjectInviteRoute = location.pathname.startsWith('/projects/invite/')
  const isPublicProjectAccessRoute = isProjectJoinRoute || isProjectInviteRoute

  if (!isAuthenticated) {
    if (isPublicProjectAccessRoute) {
      return <Outlet />
    }
    return (
      <LazySurface>
        <LazyLogin />
      </LazySurface>
    )
  }

  if (needsOnboarding) {
    return (
      <>
        <LazySurface>
          <LazyOnboarding />
        </LazySurface>
        <CreateProjectDialogHost />
      </>
    )
  }

  return (
    <>
      <ElectronNavigationBridge />
      <ElectronSettingsBridge />
      <DeferredUpdateMenu enabled={!isSettingsWindow} />
      <Outlet />
      <WorkspaceRuntimeHostsGate />
      <CreateProjectDialogHost />
      {!isSettingsWindow && <SettingsDrawerUrlBridge />}
      <SettingsDrawerHost enabled={!isSettingsWindow} />
    </>
  )
}

export function AppRoot() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}

export { FullscreenLoading }

import { warmCommonNavigation } from '@/lib/navigationWarmup'
import { Activity, lazy, Suspense, useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import { SettingsDrawer } from '@/features/settings/ui/SettingsDrawer'
import { Outlet, useLocation } from '@/lib/router'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { LanguageProvider } from './lib/i18n'
import { CreateProjectDialogHost } from '@/features/projects/ui/CreateProjectDialogHost'
import { TooltipProvider } from './components/ui/tooltip'
import { useViewTransitionNavigate } from './lib/navigation'
import { getSettingsRouteFromLocation, writeSettingsRouteToUrl } from './lib/settingsDrawerUrl'
import { useSettingsDrawerStore } from '@/features/settings/model/settingsDrawerStore'
import { WorkspaceRuntimeHostsGate } from '@/features/workspace/WorkspaceRuntimeHostsGate'
import { TerminalViewHostGate } from '@/features/terminal/TerminalViewHostGate'
import { AppAgentRuntimeHost } from '@/substrate/AppAgentRuntimeHost'
import { featureFlags } from '@/lib/featureFlags'

const LazyDeviceSessionRecovery = lazy(() =>
  import('./pages/DeviceSessionRecovery').then((module) => ({
    default: module.DeviceSessionRecovery,
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
  const [hasOpened, setHasOpened] = useState(isOpen)
  if (isOpen && !hasOpened) setHasOpened(true)

  if (!enabled || !hasOpened) {
    return null
  }

  return (
    <Activity mode={isOpen ? 'visible' : 'hidden'}>
      <SettingsDrawer />
    </Activity>
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
  const pathname = useLocation({ select: (location) => location.pathname })
  const isSettingsWindow = window.electronAPI?.windowContext === 'settings'

  useEffect(() => {
    if (!isAuthenticated || isLoading || needsOnboarding) return
    const shouldWarmNewProject = pathname === "/projects" || pathname === "/projects/"
    const shouldWarmProjectEditor =
      pathname.startsWith('/projects/') &&
      !pathname.startsWith('/projects/new') &&
      !pathname.endsWith('/workbench')

    if (!featureFlags.commonRoutePrewarm && !shouldWarmNewProject && !shouldWarmProjectEditor) {
      return
    }

    return scheduleIdleWarmup(() => {
      warmCommonNavigation()
      if (shouldWarmNewProject) {
        void import('./pages/NewProject')
      }
      if (featureFlags.commonRoutePrewarm || shouldWarmProjectEditor) {
        void import('./features/projects/pages/ProjectWorkbenchPage')
        void import('./features/tasks/pages/TasksPage')
        void import('./features/settings/Account')
        void import('./features/settings/Appearance')
        void import('./features/settings/Organizations')
        void import('./features/settings/DevAppSettings')
      }
    }, {
      delayMs: featureFlags.commonRoutePrewarm ? 250 : 3_500,
      timeoutMs: featureFlags.commonRoutePrewarm ? 3_000 : 12_000,
    })
  }, [isAuthenticated, isLoading, pathname, needsOnboarding])

  useEffect(() => {
    if (!isAuthenticated || isLoading || needsOnboarding) {
      return
    }

    if (pathname.endsWith('/workbench')) {
      return
    }

    return scheduleIdleWarmup(() => {
      void import('@/features/settings/Tooling').then((module) =>
        module.prewarmToolingSettings?.()
      )
    }, { delayMs: featureFlags.commonRoutePrewarm ? 750 : 6_000, timeoutMs: 15_000 })
  }, [isAuthenticated, isLoading, pathname, needsOnboarding])

  if (isLoading) {
    return <FullscreenLoading />
  }

  const isProjectJoinRoute =
    pathname.startsWith('/projects/join/') ||
    pathname.startsWith('/join/project/')
  const isProjectInviteRoute = pathname.startsWith('/projects/invite/')
  const isPublicProjectAccessRoute = isProjectJoinRoute || isProjectInviteRoute

  if (!isAuthenticated) {
    if (isPublicProjectAccessRoute) {
      return <Outlet />
    }
    return (
      <LazySurface>
        <LazyDeviceSessionRecovery />
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
      <AppAgentRuntimeHost enableScheduledTasks={!isSettingsWindow} />
      <DeferredUpdateMenu enabled={!isSettingsWindow} />
      <Outlet />
      <WorkspaceRuntimeHostsGate />
      <TerminalViewHostGate />
      <CreateProjectDialogHost />
      {!isSettingsWindow && <SettingsDrawerUrlBridge />}
      <SettingsDrawerHost enabled={!isSettingsWindow} />
    </>
  )
}

export function AppRoot() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </LanguageProvider>
  )
}

export { FullscreenLoading }

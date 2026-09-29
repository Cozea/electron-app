import { warmCommonNavigation } from '@/lib/navigationWarmup'
import { lazy, Suspense, useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import { Outlet, useLocation } from '@/lib/router'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { LanguageProvider } from './lib/i18n'
import { CreateProjectDialogHost } from '@/features/projects/ui/CreateProjectDialogHost'
import { TooltipProvider } from './components/ui/tooltip'
import { useNavigateTo, useViewTransitionNavigate } from './lib/navigation'
import { settingsDestinationForRoute } from './lib/destinations'
import { useDesktopHistoryNavigation } from './app/navigation/useDesktopHistoryNavigation'
import { WorkspaceRuntimeHostsGate } from '@/features/workspace/WorkspaceRuntimeHostsGate'
import { TerminalViewHostGate } from '@/features/terminal/TerminalViewHostGate'
import { AppAgentRuntimeHost } from '@/substrate/AppAgentRuntimeHost'

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
const LazyProductTour = lazy(() =>
  import('@/features/tour/ProductTour').then((module) => ({
    default: module.ProductTour,
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
  useDesktopHistoryNavigation()
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
  // Settings is a page: the macOS Settings… menu and window:openSettings open it.
  const navigateTo = useNavigateTo()
  const handleElectronSettingsOpen = useEffectEvent((route: string) => {
    navigateTo(settingsDestinationForRoute(route))
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

    return scheduleIdleWarmup(() => {
      warmCommonNavigation()
      if (shouldWarmNewProject) {
        void import('./pages/NewProject')
      }
      void import('./features/projects/pages/ProjectWorkbenchPage')
      void import('./features/tasks/pages/TasksPage')
      void import('./features/settings/Account')
      void import('./features/settings/Appearance')
      void import('./features/settings/Organizations')
      void import('./features/settings/DevAppSettings')
      void import('./features/settings/ui/SettingsSidebar')
    }, {
      delayMs: 250,
      timeoutMs: 3_000,
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
    }, { delayMs: 750, timeoutMs: 15_000 })
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
      {/* First run tutorial. Silent unless this device has never finished it. */}
      {!isSettingsWindow && (
        <Suspense fallback={null}>
          <LazyProductTour />
        </Suspense>
      )}
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

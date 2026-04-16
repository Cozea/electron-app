import { useEffect, useEffectEvent } from 'react'
import { Outlet, useLocation } from '@/lib/router'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { SettingsDrawer } from './components/settings/SettingsDrawer'
import { CreateProjectDialogHost } from './features/projects/components/CreateProjectDialogHost'
import { UpdateMenu } from './components/updates/UpdateMenu'
import { TooltipProvider } from './components/ui/tooltip'
import { useViewTransitionNavigate } from './lib/navigation'
import { getSettingsRouteFromLocation, writeSettingsRouteToUrl } from './lib/settingsDrawerUrl'
import { useSettingsDrawerStore } from './stores/useSettingsDrawerStore'
import { Login } from './pages/Login'
import { Onboarding } from './components/Onboarding'

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

    const shouldWarmProjectEditor =
      location.pathname.startsWith('/projects/') &&
      !location.pathname.startsWith('/projects/new')

    const warmupTimer = window.setTimeout(() => {
      void import('./pages/NewProject')

      if (shouldWarmProjectEditor) {
        void import('./features/projects/pages/ProjectWorkbenchPage')
        void import('./features/projects/pages/ChangesPage')
      }
    }, 1200)

    return () => {
      window.clearTimeout(warmupTimer)
    }
  }, [isAuthenticated, isLoading, location.pathname, needsOnboarding])

  useEffect(() => {
    if (!isAuthenticated || isLoading || needsOnboarding) {
      return
    }

    const warmupTimer = window.setTimeout(() => {
      void import('./pages/settings/Tooling').then((module) =>
        module.prewarmToolingSettings?.()
      )
    }, 150)

    return () => {
      window.clearTimeout(warmupTimer)
    }
  }, [isAuthenticated, isLoading, needsOnboarding])

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
    return <Login />
  }

  if (needsOnboarding) {
    return (
      <>
        <Onboarding />
        <CreateProjectDialogHost />
      </>
    )
  }

  return (
    <>
      <ElectronNavigationBridge />
      <ElectronSettingsBridge />
      {!isSettingsWindow && <UpdateMenu />}
      <Outlet />
      <CreateProjectDialogHost />
      {!isSettingsWindow && <SettingsDrawerUrlBridge />}
      {!isSettingsWindow && <SettingsDrawer />}
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

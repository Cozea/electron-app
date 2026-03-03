import { Suspense, lazy, useEffect, useEffectEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import { OrganizationProvider } from './contexts/OrganizationContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { SettingsDrawer } from './components/settings/SettingsDrawer'
import { UpdateMenu } from './components/updates/UpdateMenu'
import { TooltipProvider } from './components/ui/tooltip'
import { useViewTransitionNavigate } from './lib/navigation'
import { getSettingsRouteFromLocation, writeSettingsRouteToUrl } from './lib/settingsDrawerUrl'
import { useSettingsDrawerStore } from './stores/useSettingsDrawerStore'

const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })))
const Onboarding = lazy(() =>
  import('./components/Onboarding').then((module) => ({ default: module.Onboarding }))
)

function FullscreenLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading your workspace...</span>
      </div>
    </div>
  )
}

function AppWithOrganization() {
  const { accessToken, organizations, refreshToken } = useAuth()

  return (
    <OrganizationProvider
      accessToken={accessToken}
      initialOrganizations={organizations}
      onTokenExpired={refreshToken}
    >
      <Suspense fallback={<FullscreenLoading />}>
        <AppContent />
      </Suspense>
    </OrganizationProvider>
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
      openFromRoute(routeFromLocation)
      return
    }

    close()
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
  const { isAuthenticated, isLoading, needsOnboarding, workspaceSelectionRequired } = useAuth()
  const location = useLocation()
  const isSettingsWindow = window.electronAPI?.windowContext === 'settings'

  useEffect(() => {
    if (!isAuthenticated || isLoading || needsOnboarding) return

    const shouldWarmProjectEditor =
      location.pathname.startsWith('/projects/') &&
      !location.pathname.startsWith('/projects/new')

    const warmupTimer = window.setTimeout(() => {
      void import('./pages/NewProject')
      void import('./pages/ProjectBuild')
      void import('./pages/workspace/Billing')

      if (shouldWarmProjectEditor) {
        void import('./features/projects/pages/ProjectPagesPage')
        void import('./features/projects/pages/ProjectBackendStudioPage')
        void import('./features/projects/pages/ChangesPage')
      }
    }, 1200)

    return () => {
      window.clearTimeout(warmupTimer)
    }
  }, [isAuthenticated, isLoading, location.pathname, needsOnboarding])

  if (!isAuthenticated) {
    return <Login />
  }

  if (isLoading) {
    return <FullscreenLoading />
  }

  if (needsOnboarding) {
    return <Onboarding />
  }

  const isWorkspaceSelectRoute = location.pathname === '/workspaces/select'
  const isWorkspaceCreateRoute = location.pathname === '/workspaces/new'
  const isInviteRoute = location.pathname.startsWith('/invite/')
  if (workspaceSelectionRequired && !isWorkspaceSelectRoute && !isWorkspaceCreateRoute && !isInviteRoute) {
    return <Navigate to="/workspaces/select" replace />
  }

  return (
    <>
      <ElectronNavigationBridge />
      <ElectronSettingsBridge />
      {!isSettingsWindow && <UpdateMenu />}
      <Outlet />
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
          <AppWithOrganization />
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}

export { FullscreenLoading }

import { Suspense, lazy, useEffect, useEffectEvent } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import { OrganizationProvider } from './contexts/OrganizationContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { SettingsDrawer } from './components/settings/SettingsDrawer'
import { CreateWorkspaceDialogHost } from './components/workspaces/CreateWorkspaceDialogHost'
import { UpdateMenu } from './components/updates/UpdateMenu'
import { TooltipProvider } from './components/ui/tooltip'
import { useViewTransitionNavigate } from './lib/navigation'
import { getSettingsRouteFromLocation, writeSettingsRouteToUrl } from './lib/settingsDrawerUrl'
import { useSettingsDrawerStore } from './stores/useSettingsDrawerStore'
import { useResolvedScope } from './hooks/useResolvedScope'

const warmedModelCatalogOrganizations = new Set<string>()
const attemptedModelCatalogWarmups = new Set<string>()
const suppressedModelCatalogWarmupOrganizations = new Set<string>()
let suppressModelCatalogWarmupForSession = false
let loggedModelCatalogUnauthorizedTokenDebug = false

interface DecodedTokenClaims {
  aud?: string | string[]
  exp?: number
  iat?: number
  iss?: string
  org_id?: string
  sub?: string
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return atob(padded)
  } catch {
    return null
  }
}

function decodeTokenClaims(token: string): DecodedTokenClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const rawPayload = decodeBase64Url(parts[1])
  if (!rawPayload) return null

  try {
    return JSON.parse(rawPayload) as DecodedTokenClaims
  } catch {
    return null
  }
}

function formatUnixTimestamp(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value * 1000).toISOString()
}

const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })))
const Onboarding = lazy(() =>
  import('./components/Onboarding').then((module) => ({ default: module.Onboarding }))
)

function FullscreenLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="preview-loading-spinner" aria-label="Loading workspace" role="status">
        <div className="preview-loading-spinner-square" />
        <div className="preview-loading-spinner-square" />
        <div className="preview-loading-spinner-square" />
        <div className="preview-loading-spinner-square" />
        <div className="preview-loading-spinner-square" />
      </div>
    </div>
  )
}

function AppWithOrganization() {
  const { accessToken, refreshToken } = useAuth()

  return (
    <OrganizationProvider
      accessToken={accessToken}
      onTokenExpired={async () => (await refreshToken()) === 'refreshed'}
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
    accessToken,
    isAuthenticated,
    isLoading,
    needsOnboarding,
    workspaceSelectionRequired,
  } = useAuth()
  const { activeOrganizationId: workspaceOrganizationId } = useResolvedScope({ ignoreLocation: true })
  const location = useLocation()
  const isSettingsWindow = window.electronAPI?.windowContext === 'settings'

  useEffect(() => {
    if (!isAuthenticated || isLoading || needsOnboarding) {
      warmedModelCatalogOrganizations.clear()
      attemptedModelCatalogWarmups.clear()
      suppressedModelCatalogWarmupOrganizations.clear()
      suppressModelCatalogWarmupForSession = false
      loggedModelCatalogUnauthorizedTokenDebug = false
      return
    }
    if (!accessToken || !workspaceOrganizationId) return
    const organizationId = workspaceOrganizationId

    if (warmedModelCatalogOrganizations.has(organizationId)) return
    if (suppressModelCatalogWarmupForSession) return
    if (suppressedModelCatalogWarmupOrganizations.has(organizationId)) return

    const warmupAttemptKey = `${organizationId}::${accessToken}`
    if (attemptedModelCatalogWarmups.has(warmupAttemptKey)) return
    attemptedModelCatalogWarmups.add(warmupAttemptKey)

    void Promise.resolve()
      .then(() => {
        warmedModelCatalogOrganizations.add(organizationId)
        suppressedModelCatalogWarmupOrganizations.delete(organizationId)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        if (message.toLowerCase().includes('unauthorized')) {
          if (import.meta.env.DEV && !loggedModelCatalogUnauthorizedTokenDebug) {
            loggedModelCatalogUnauthorizedTokenDebug = true
            const decodedClaims = decodeTokenClaims(accessToken)
            const debugPayload = {
              organizationId,
              now: new Date().toISOString(),
              tokenFormat: decodedClaims ? 'jwt' : 'opaque_or_invalid_jwt',
              claims: decodedClaims
                ? {
                    sub: decodedClaims.sub ?? null,
                    iss: decodedClaims.iss ?? null,
                    aud: decodedClaims.aud ?? null,
                    org_id: decodedClaims.org_id ?? null,
                    iat: formatUnixTimestamp(decodedClaims.iat),
                    exp: formatUnixTimestamp(decodedClaims.exp),
                  }
                : null,
            }
            console.warn('[ModelCatalog][Debug] Unauthorized warmup token claims', debugPayload)
            console.warn('[ModelCatalog][Debug] Unauthorized warmup token claims JSON', JSON.stringify(debugPayload))
          }
          suppressModelCatalogWarmupForSession = true
          suppressedModelCatalogWarmupOrganizations.add(organizationId)
          return
        }
        console.warn('Failed to refresh model catalog on app start:', error)
      })
  }, [accessToken, isAuthenticated, isLoading, needsOnboarding, workspaceOrganizationId])

  useEffect(() => {
    if (!isAuthenticated || isLoading || needsOnboarding) return

    const shouldWarmProjectEditor =
      location.pathname.startsWith('/projects/') &&
      !location.pathname.startsWith('/projects/new')

    const warmupTimer = window.setTimeout(() => {
      void import('./pages/NewProject')
      void import('./pages/ProjectBuild')

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

  if (isLoading) {
    return <FullscreenLoading />
  }

  const isWorkspaceSelectRoute = location.pathname === '/workspaces/select'
  const isWorkspaceCreateRoute = location.pathname === '/workspaces/new'
  const isInviteRoute = location.pathname.startsWith('/invite/')
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
        <CreateWorkspaceDialogHost />
      </>
    )
  }
  if (
    workspaceSelectionRequired &&
    !isWorkspaceSelectRoute &&
    !isWorkspaceCreateRoute &&
    !isInviteRoute &&
    !isPublicProjectAccessRoute
  ) {
    return <Navigate to="/workspaces/select" replace />
  }

  return (
    <>
      <ElectronNavigationBridge />
      <ElectronSettingsBridge />
      {!isSettingsWindow && <UpdateMenu />}
      <Outlet />
      <CreateWorkspaceDialogHost />
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

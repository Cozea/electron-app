import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { OrganizationProvider } from './contexts/OrganizationContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { UpdateMenu } from './components/updates/UpdateMenu'
// Eager load core pages for instant startup (VS Code style)
import { Projects } from './pages/Projects'
import { Members } from './pages/teams/Members'
import { ProjectLayout } from './features/projects/layouts/ProjectLayout'

// Lazy load other non-critical pages
const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })))
const NewProject = lazy(() => import('./pages/NewProject').then(m => ({ default: m.NewProject })))
const ProjectBuild = lazy(() => import('./pages/ProjectBuild').then(m => ({ default: m.ProjectBuild })))
const ProjectDetailPage = lazy(() => import('./features/projects/pages/ProjectDetailPage').then(m => ({ default: m.ProjectDetailPage })))
const ProjectPagesPage = lazy(() => import('./features/projects/pages/ProjectPagesPage').then(m => ({ default: m.ProjectPagesPage })))
const ProjectDatabasePage = lazy(() => import('./features/projects/pages/ProjectDatabasePage').then(m => ({ default: m.ProjectDatabasePage })))
const ProjectDependenciesPage = lazy(() => import('./features/projects/pages/ProjectDependenciesPage').then(m => ({ default: m.ProjectDependenciesPage })))
const ProjectBackendStudioPage = lazy(() => import('./features/projects/pages/ProjectBackendStudioPage').then(m => ({ default: m.ProjectBackendStudioPage })))
const ChangesPage = lazy(() => import('./features/projects/pages/ChangesPage').then(m => ({ default: m.ChangesPage })))
const TasksPage = lazy(() => import('./features/projects/pages/TasksPage').then(m => ({ default: m.TasksPage })))
const ProjectSettingsPage = lazy(() => import('./features/projects/pages/ProjectSettingsPage').then(m => ({ default: m.ProjectSettingsPage })))

// Other pages
const MemberDetails = lazy(() => import('./pages/teams/MemberDetails').then(m => ({ default: m.MemberDetails })))
const Roles = lazy(() => import('./pages/teams/Roles').then(m => ({ default: m.Roles })))
const General = lazy(() => import('./pages/workspace/General').then(m => ({ default: m.General })))
const Billing = lazy(() => import('./pages/workspace/Billing').then(m => ({ default: m.Billing })))
const AI = lazy(() => import('./pages/workspace/AI').then(m => ({ default: m.AI })))
const Integrations = lazy(() => import('./pages/workspace/Integrations').then(m => ({ default: m.Integrations })))
const Sync = lazy(() => import('./pages/workspace/Sync').then(m => ({ default: m.Sync })))
const Account = lazy(() => import('./pages/settings/Account').then(m => ({ default: m.Account })))
const Appearance = lazy(() => import('./pages/settings/Appearance').then(m => ({ default: m.Appearance })))
const Storage = lazy(() => import('./pages/settings/Storage').then(m => ({ default: m.Storage })))
const AcceptInvitation = lazy(() => import('./pages/AcceptInvitation').then(m => ({ default: m.AcceptInvitation })))
const Onboarding = lazy(() => import('./components/Onboarding').then(m => ({ default: m.Onboarding })))
import { TooltipProvider } from './components/ui/tooltip'



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

function RouteLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  )
}

function RouteSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<RouteLoading />}>
      {children}
    </Suspense>
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
      <AppContent />
    </OrganizationProvider>
  )
}

function ElectronNavigationBridge() {
  const navigate = useNavigate()

  useEffect(() => {
    const unsubscribe = window.electronAPI?.app?.onNavigate?.((path) => {
      if (typeof path === 'string' && path.startsWith('/')) {
        navigate(path)
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [navigate])

  return null
}

function AppContent() {
  const { isAuthenticated, isLoading, needsOnboarding } = useAuth()

  useEffect(() => {
    if (!isAuthenticated || isLoading || needsOnboarding) return

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    const warmupLoaders: Array<() => Promise<unknown>> = [
      () => import('./pages/NewProject'),
      () => import('./pages/ProjectBuild'),
      () => import('./pages/teams/Roles'),
      () => import('./pages/teams/MemberDetails'),
      () => import('./features/projects/pages/ProjectPagesPage'),
      () => import('./features/projects/pages/ProjectDependenciesPage'),
      () => import('./features/projects/pages/ProjectBackendStudioPage'),
      () => import('./features/projects/pages/ChangesPage'),
      () => import('./pages/workspace/Billing'),
      () => import('./pages/workspace/AI'),
      () => import('./pages/workspace/Integrations'),
    ]

    let nextIndex = 0
    let warmupTimer: number | null = null
    let warmupIdleHandle: number | null = null
    let warmupFallbackTimer: number | null = null

    const scheduleNextWarmup = () => {
      if (nextIndex >= warmupLoaders.length) return

      const runNextWarmup = () => {
        if (nextIndex >= warmupLoaders.length) return
        void warmupLoaders[nextIndex++]()
        scheduleNextWarmup()
      }

      if (typeof idleWindow.requestIdleCallback === 'function') {
        warmupIdleHandle = idleWindow.requestIdleCallback(
          () => runNextWarmup(),
          { timeout: 1200 }
        )
      } else {
        warmupFallbackTimer = window.setTimeout(runNextWarmup, 120)
      }
    }

    warmupTimer = window.setTimeout(() => {
      scheduleNextWarmup()
    }, 900)

    return () => {
      if (warmupTimer !== null) {
        window.clearTimeout(warmupTimer)
      }
      if (warmupFallbackTimer !== null) {
        window.clearTimeout(warmupFallbackTimer)
      }
      if (
        warmupIdleHandle !== null &&
        typeof idleWindow.cancelIdleCallback === 'function'
      ) {
        idleWindow.cancelIdleCallback(warmupIdleHandle)
      }
    }
  }, [isAuthenticated, isLoading, needsOnboarding])

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<FullscreenLoading />}>
        <Login />
      </Suspense>
    )
  }

  if (isLoading) {
    return <FullscreenLoading />
  }

  if (needsOnboarding) {
    return (
      <Suspense fallback={<FullscreenLoading />}>
        <Onboarding />
      </Suspense>
    )
  }

  return (
    <>
      <ElectronNavigationBridge />
      <UpdateMenu />
      <Routes>
        {/* Projects (default landing page) */}
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<Projects />} />
        <Route
          path="/projects/new"
          element={
            <RouteSuspense>
              <NewProject />
            </RouteSuspense>
          }
        />
        <Route
          path="/projects/:projectId/build"
          element={
            <RouteSuspense>
              <ProjectBuild />
            </RouteSuspense>
          }
        />

        {/* Project Editor - Nested Routes with ProjectLayout */}
        <Route path="/projects/:slug" element={<ProjectLayout />}>
          <Route
            index
            element={
              <RouteSuspense>
                <ProjectDetailPage />
              </RouteSuspense>
            }
          />
          <Route
            path="pages"
            element={
              <RouteSuspense>
                <ProjectPagesPage />
              </RouteSuspense>
            }
          />
          <Route
            path="database"
            element={
              <RouteSuspense>
                <ProjectDatabasePage />
              </RouteSuspense>
            }
          />
          <Route
            path="dependencies"
            element={
              <RouteSuspense>
                <ProjectDependenciesPage />
              </RouteSuspense>
            }
          />
          <Route
            path="backend"
            element={
              <RouteSuspense>
                <ProjectBackendStudioPage />
              </RouteSuspense>
            }
          />
          <Route
            path="changes"
            element={
              <RouteSuspense>
                <ChangesPage />
              </RouteSuspense>
            }
          />
          {/* Redirects for old routes */}
          <Route path="feed" element={<Navigate to="../changes" replace />} />
          <Route path="merge-queue" element={<Navigate to="../changes" replace />} />
          <Route path="version-control" element={<Navigate to="../changes" replace />} />
          <Route
            path="tasks"
            element={
              <RouteSuspense>
                <TasksPage />
              </RouteSuspense>
            }
          />
          <Route
            path="settings"
            element={
              <RouteSuspense>
                <ProjectSettingsPage />
              </RouteSuspense>
            }
          />
          <Route
            path="settings/:section"
            element={
              <RouteSuspense>
                <ProjectSettingsPage />
              </RouteSuspense>
            }
          />
          <Route
            path="*"
            element={
              <RouteSuspense>
                <ProjectDetailPage />
              </RouteSuspense>
            }
          />
        </Route>

        {/* Teams */}
        <Route path="/teams" element={<Members />} />
        <Route
          path="/teams/members/:memberId"
          element={
            <RouteSuspense>
              <MemberDetails />
            </RouteSuspense>
          }
        />
        <Route
          path="/teams/roles"
          element={
            <RouteSuspense>
              <Roles />
            </RouteSuspense>
          }
        />

        {/* Workspace Settings */}
        <Route
          path="/workspace/general"
          element={
            <RouteSuspense>
              <General />
            </RouteSuspense>
          }
        />
        <Route
          path="/workspace/billing"
          element={
            <RouteSuspense>
              <Billing />
            </RouteSuspense>
          }
        />
        <Route
          path="/workspace/ai"
          element={
            <RouteSuspense>
              <AI />
            </RouteSuspense>
          }
        />
        <Route
          path="/workspace/integrations"
          element={
            <RouteSuspense>
              <Integrations />
            </RouteSuspense>
          }
        />
        <Route
          path="/workspace/sync"
          element={
            <RouteSuspense>
              <Sync />
            </RouteSuspense>
          }
        />

        {/* Personal Settings */}
        <Route
          path="/settings/account"
          element={
            <RouteSuspense>
              <Account />
            </RouteSuspense>
          }
        />
        <Route
          path="/settings/appearance"
          element={
            <RouteSuspense>
              <Appearance />
            </RouteSuspense>
          }
        />
        <Route
          path="/settings/storage"
          element={
            <RouteSuspense>
              <Storage />
            </RouteSuspense>
          }
        />

        {/* Invitation */}
        <Route
          path="/invite/:token"
          element={
            <RouteSuspense>
              <AcceptInvitation />
            </RouteSuspense>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <AppWithOrganization />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App

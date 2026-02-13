import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { OrganizationProvider } from './contexts/OrganizationContext'
import { ThemeProvider } from './contexts/ThemeContext'
// Eager load core pages for instant startup (VS Code style)
import { Projects } from './pages/Projects'
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
const Members = lazy(() => import('./pages/teams/Members').then(m => ({ default: m.Members })))
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
const Tooling = lazy(() => import('./pages/settings/Tooling').then(m => ({ default: m.Tooling })))
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

    const warmupTimer = window.setTimeout(() => {
      void import('./pages/NewProject')
      void import('./pages/ProjectBuild')
      void import('./features/projects/pages/ProjectPagesPage')
      void import('./features/projects/pages/ProjectBackendStudioPage')
      void import('./features/projects/pages/ChangesPage')
      void import('./pages/workspace/Billing')
    }, 1200)

    return () => {
      window.clearTimeout(warmupTimer)
    }
  }, [isAuthenticated, isLoading, needsOnboarding])

  if (!isAuthenticated) {
    return <Login />
  }

  if (isLoading) {
    return <FullscreenLoading />
  }

  if (needsOnboarding) {
    return <Onboarding />
  }

  return (
    <>
      <ElectronNavigationBridge />
      <Routes>
        {/* Projects (default landing page) */}
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/new" element={<NewProject />} />
        <Route path="/projects/:projectId/build" element={<ProjectBuild />} />

        {/* Project Editor - Nested Routes with ProjectLayout */}
        <Route path="/projects/:slug" element={<ProjectLayout />}>
          <Route index element={<ProjectDetailPage />} />
          <Route path="pages" element={<ProjectPagesPage />} />
          <Route path="database" element={<ProjectDatabasePage />} />
          <Route path="dependencies" element={<ProjectDependenciesPage />} />
          <Route path="backend" element={<ProjectBackendStudioPage />} />
          <Route path="changes" element={<ChangesPage />} />
          {/* Redirects for old routes */}
          <Route path="feed" element={<Navigate to="../changes" replace />} />
          <Route path="merge-queue" element={<Navigate to="../changes" replace />} />
          <Route path="version-control" element={<Navigate to="../changes" replace />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="settings" element={<ProjectSettingsPage />} />
          <Route path="settings/:section" element={<ProjectSettingsPage />} />
          <Route path="*" element={<ProjectDetailPage />} />
        </Route>

        {/* Teams */}
        <Route path="/teams" element={<Members />} />
        <Route path="/teams/members/:memberId" element={<MemberDetails />} />
        <Route path="/teams/roles" element={<Roles />} />

        {/* Workspace Settings */}
        <Route path="/workspace/general" element={<General />} />
        <Route path="/workspace/billing" element={<Billing />} />
        <Route path="/workspace/ai" element={<AI />} />
        <Route path="/workspace/integrations" element={<Integrations />} />
        <Route path="/workspace/sync" element={<Sync />} />

        {/* Personal Settings */}
        <Route path="/settings/account" element={<Account />} />
        <Route path="/settings/appearance" element={<Appearance />} />
        <Route path="/settings/tooling" element={<Tooling />} />
        <Route path="/settings/storage" element={<Storage />} />

        {/* Invitation */}
        <Route path="/invite/:token" element={<AcceptInvitation />} />

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

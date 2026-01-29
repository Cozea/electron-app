import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { OrganizationProvider } from './contexts/OrganizationContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Projects } from './pages/Projects'
import { NewProject } from './pages/NewProject'
import { ProjectBuild } from './pages/ProjectBuild'
// Project pages (under ProjectLayout)
import { ProjectLayout } from './features/projects/layouts/ProjectLayout'
import { ProjectDetailPage } from './features/projects/pages/ProjectDetailPage'
import { ProjectPagesPage } from './features/projects/pages/ProjectPagesPage'
import { ProjectDatabasePage } from './features/projects/pages/ProjectDatabasePage'
import { ProjectDependenciesPage } from './features/projects/pages/ProjectDependenciesPage'
import { ProjectBackendStudioPage } from './features/projects/pages/ProjectBackendStudioPage'
import { ChangesPage } from './features/projects/pages/ChangesPage'
import { TasksPage } from './features/projects/pages/TasksPage'
import { ProjectSettingsPage } from './features/projects/pages/ProjectSettingsPage'
// Other pages
import { Members } from './pages/teams/Members'
import { MemberDetails } from './pages/teams/MemberDetails'
import { Roles } from './pages/teams/Roles'
import { General } from './pages/workspace/General'
import { Billing } from './pages/workspace/Billing'
import { AI } from './pages/workspace/AI'
import { Integrations } from './pages/workspace/Integrations'
import { Sync } from './pages/workspace/Sync'
import { Account } from './pages/settings/Account'
import { Appearance } from './pages/settings/Appearance'
import { Storage } from './pages/settings/Storage'
import { AcceptInvitation } from './pages/AcceptInvitation'
import { Onboarding } from './components/Onboarding'
import { TooltipProvider } from './components/ui/tooltip'

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

function AppContent() {
  const { isAuthenticated, isLoading, needsOnboarding } = useAuth()

  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="text-foreground text-lg font-semibold">Loading...</div>
          <div className="w-8 h-8 border-4 border-foreground border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Login />
  }

  if (needsOnboarding) {
    return <Onboarding />
  }

  return (
    <Routes>
      {/* Dashboard */}
      <Route path="/" element={<Dashboard />} />

      {/* Projects List and Wizard */}
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
      <Route path="/settings/storage" element={<Storage />} />

      {/* Invitation */}
      <Route path="/invite/:token" element={<AcceptInvitation />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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

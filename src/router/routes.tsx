import { lazy, type ReactNode } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'

import { AppRoot } from '@/App'
import { useAuth } from '@/contexts/AuthContext'
import { isPersonalWorkspace } from '@/lib/workspaces'
import { Projects } from '@/pages/Projects'
import { General } from '@/pages/workspace/General'
import { Billing } from '@/pages/workspace/Billing'
import { AI } from '@/pages/workspace/AI'
import { Integrations } from '@/pages/workspace/Integrations'
import { Sync } from '@/pages/workspace/Sync'
import { Account } from '@/pages/settings/Account'
import { Appearance } from '@/pages/settings/Appearance'
import { Storage } from '@/pages/settings/Storage'
import { Tooling } from '@/pages/settings/Tooling'

const ProjectLayout = lazy(() =>
  import('@/features/projects/layouts/ProjectLayout').then((module) => ({
    default: module.ProjectLayout,
  }))
)
const ProjectJoinPage = lazy(() =>
  import('@/features/projects/pages/ProjectJoinPage').then((module) => ({
    default: module.ProjectJoinPage,
  }))
)
const LegacyProjectRedirectPage = lazy(() =>
  import('@/features/projects/pages/LegacyProjectRedirectPage').then((module) => ({
    default: module.LegacyProjectRedirectPage,
  }))
)
const NewProject = lazy(() =>
  import('@/pages/NewProject').then((module) => ({ default: module.NewProject }))
)
const ProjectBuild = lazy(() =>
  import('@/pages/ProjectBuild').then((module) => ({ default: module.ProjectBuild }))
)
const ProjectDetailPage = lazy(() =>
  import('@/features/projects/pages/ProjectDetailPage').then((module) => ({
    default: module.ProjectDetailPage,
  }))
)
const ProjectPagesPage = lazy(() =>
  import('@/features/projects/pages/ProjectPagesPage').then((module) => ({
    default: module.ProjectPagesPage,
  }))
)
const ProjectDatabasePage = lazy(() =>
  import('@/features/projects/pages/ProjectDatabasePage').then((module) => ({
    default: module.ProjectDatabasePage,
  }))
)
const ProjectDependenciesPage = lazy(() =>
  import('@/features/projects/pages/ProjectDependenciesPage').then((module) => ({
    default: module.ProjectDependenciesPage,
  }))
)
const ProjectBackendStudioPage = lazy(() =>
  import('@/features/projects/pages/ProjectBackendStudioPage').then((module) => ({
    default: module.ProjectBackendStudioPage,
  }))
)
const ChangesPage = lazy(() =>
  import('@/features/projects/pages/ChangesPage').then((module) => ({
    default: module.ChangesPage,
  }))
)
const TasksPage = lazy(() =>
  import('@/features/projects/pages/TasksPage').then((module) => ({ default: module.TasksPage }))
)
const ProjectSettingsPage = lazy(() =>
  import('@/features/projects/pages/ProjectSettingsPage').then((module) => ({
    default: module.ProjectSettingsPage,
  }))
)
const ProjectTeamPage = lazy(() =>
  import('@/features/projects/pages/ProjectTeamPage').then((module) => ({
    default: module.ProjectTeamPage,
  }))
)
const Members = lazy(() =>
  import('@/pages/teams/Members').then((module) => ({ default: module.Members }))
)
const MemberDetails = lazy(() =>
  import('@/pages/teams/MemberDetails').then((module) => ({
    default: module.MemberDetails,
  }))
)
const Roles = lazy(() =>
  import('@/pages/teams/Roles').then((module) => ({ default: module.Roles }))
)
const AcceptInvitation = lazy(() =>
  import('@/pages/AcceptInvitation').then((module) => ({
    default: module.AcceptInvitation,
  }))
)
const WorkspaceSelect = lazy(() =>
  import('@/pages/WorkspaceSelect').then((module) => ({
    default: module.WorkspaceSelect,
  }))
)
const WorkspaceCreate = lazy(() =>
  import('@/pages/WorkspaceCreate').then((module) => ({
    default: module.WorkspaceCreate,
  }))
)

function OrganizationWorkspaceOnly({ children }: { children: ReactNode }) {
  const { currentOrganization, isLoading } = useAuth()

  if (isLoading) {
    return null
  }

  if (!currentOrganization || isPersonalWorkspace(currentOrganization)) {
    return <Navigate to="/projects" replace />
  }

  return <>{children}</>
}

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppRoot />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: 'projects', element: <Projects /> },
      { path: 'projects/new', element: <NewProject /> },
      { path: 'projects/join/:token', element: <ProjectJoinPage /> },
      { path: 'projects/:projectId/build', element: <ProjectBuild /> },
      {
        path: 'projects/p/:projectId',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <ProjectDetailPage /> },
          { path: 'pages', element: <ProjectPagesPage /> },
          { path: 'database', element: <ProjectDatabasePage /> },
          { path: 'dependencies', element: <ProjectDependenciesPage /> },
          { path: 'backend', element: <ProjectBackendStudioPage /> },
          { path: 'changes', element: <ChangesPage /> },
          { path: 'feed', element: <Navigate to="../changes" replace /> },
          { path: 'merge-queue', element: <Navigate to="../changes" replace /> },
          { path: 'version-control', element: <Navigate to="../changes" replace /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'team', element: <ProjectTeamPage /> },
          { path: 'settings', element: <ProjectSettingsPage /> },
          { path: 'settings/team', element: <Navigate to="../team" replace /> },
          { path: 'settings/:section', element: <ProjectSettingsPage /> },
          { path: '*', element: <ProjectDetailPage /> },
        ],
      },
      { path: 'projects/:slug', element: <LegacyProjectRedirectPage /> },
      { path: 'projects/:slug/*', element: <LegacyProjectRedirectPage /> },
      {
        path: 'teams',
        element: (
          <OrganizationWorkspaceOnly>
            <Members />
          </OrganizationWorkspaceOnly>
        ),
      },
      {
        path: 'teams/members/:memberId',
        element: (
          <OrganizationWorkspaceOnly>
            <MemberDetails />
          </OrganizationWorkspaceOnly>
        ),
      },
      {
        path: 'teams/roles',
        element: (
          <OrganizationWorkspaceOnly>
            <Roles />
          </OrganizationWorkspaceOnly>
        ),
      },
      { path: 'workspaces/select', element: <WorkspaceSelect /> },
      { path: 'workspaces/new', element: <WorkspaceCreate /> },
      {
        path: 'workspace/general',
        element: (
          <OrganizationWorkspaceOnly>
            <General />
          </OrganizationWorkspaceOnly>
        ),
      },
      { path: 'workspace/billing', element: <Navigate to="/settings/billing" replace /> },
      { path: 'workspace/ai', element: <Navigate to="/settings/ai" replace /> },
      { path: 'workspace/integrations', element: <Integrations /> },
      { path: 'workspace/sync', element: <Sync /> },
      { path: 'settings/account', element: <Account /> },
      { path: 'settings/billing', element: <Billing /> },
      { path: 'settings/ai', element: <AI /> },
      { path: 'settings/appearance', element: <Appearance /> },
      { path: 'settings/tooling', element: <Tooling /> },
      { path: 'settings/storage', element: <Storage /> },
      { path: 'invite/:token', element: <AcceptInvitation /> },
      { path: '*', element: <Navigate to="/projects" replace /> },
    ],
  },
]

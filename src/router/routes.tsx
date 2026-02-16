import { lazy } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'

import { AppRoot } from '@/App'
import { Projects } from '@/pages/Projects'

const ProjectLayout = lazy(() =>
  import('@/features/projects/layouts/ProjectLayout').then((module) => ({
    default: module.ProjectLayout,
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
const General = lazy(() =>
  import('@/pages/workspace/General').then((module) => ({ default: module.General }))
)
const Billing = lazy(() =>
  import('@/pages/workspace/Billing').then((module) => ({ default: module.Billing }))
)
const AI = lazy(() =>
  import('@/pages/workspace/AI').then((module) => ({ default: module.AI }))
)
const Integrations = lazy(() =>
  import('@/pages/workspace/Integrations').then((module) => ({
    default: module.Integrations,
  }))
)
const Sync = lazy(() =>
  import('@/pages/workspace/Sync').then((module) => ({ default: module.Sync }))
)
const Account = lazy(() =>
  import('@/pages/settings/Account').then((module) => ({ default: module.Account }))
)
const Appearance = lazy(() =>
  import('@/pages/settings/Appearance').then((module) => ({
    default: module.Appearance,
  }))
)
const Storage = lazy(() =>
  import('@/pages/settings/Storage').then((module) => ({ default: module.Storage }))
)
const Tooling = lazy(() =>
  import('@/pages/settings/Tooling').then((module) => ({ default: module.Tooling }))
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

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppRoot />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: 'projects', element: <Projects /> },
      { path: 'projects/new', element: <NewProject /> },
      { path: 'projects/:projectId/build', element: <ProjectBuild /> },
      {
        path: 'projects/:slug',
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
          { path: 'settings', element: <ProjectSettingsPage /> },
          { path: 'settings/:section', element: <ProjectSettingsPage /> },
          { path: '*', element: <ProjectDetailPage /> },
        ],
      },
      { path: 'teams', element: <Members /> },
      { path: 'teams/members/:memberId', element: <MemberDetails /> },
      { path: 'teams/roles', element: <Roles /> },
      { path: 'workspaces/select', element: <WorkspaceSelect /> },
      { path: 'workspace/general', element: <General /> },
      { path: 'workspace/billing', element: <Billing /> },
      { path: 'workspace/ai', element: <AI /> },
      { path: 'workspace/integrations', element: <Integrations /> },
      { path: 'workspace/sync', element: <Sync /> },
      { path: 'settings/account', element: <Account /> },
      { path: 'settings/appearance', element: <Appearance /> },
      { path: 'settings/tooling', element: <Tooling /> },
      { path: 'settings/storage', element: <Storage /> },
      { path: 'invite/:token', element: <AcceptInvitation /> },
      { path: '*', element: <Navigate to="/projects" replace /> },
    ],
  },
]


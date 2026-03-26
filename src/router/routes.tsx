import { lazy, type ReactNode } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'

import { AppRoot } from '@/App'
import { useAuth } from '@/contexts/AuthContext'
import { useResolvedScope } from '@/hooks/useResolvedScope'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'
import { Projects } from '@/pages/Projects'
import { General } from '@/pages/workspace/General'
import { Billing } from '@/pages/workspace/Billing'
import AI from "@/pages/workspace/AI"
import { Integrations } from '@/pages/workspace/Integrations'
import { SourceControl } from '@/pages/workspace/SourceControl'
import { Sync } from '@/pages/workspace/Sync'
import { Account } from '@/pages/settings/Account'
import { Appearance } from '@/pages/settings/Appearance'
import { ModelSelection } from '@/pages/settings/ModelSelection'
import { Storage } from '@/pages/settings/Storage'
import { Tooling } from '@/pages/settings/Tooling'
import {
  canAccessWorkspaceSurface,
  getSettingsSurface,
  getSettingsSurfaceRoute,
} from '@/lib/settings/settingsRegistry'
import type {
  SettingsSurfaceId,
  WorkspaceSurfaceAccessState,
} from '@/lib/settings/settingsSurfaceTypes'

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
const ProjectInvitePage = lazy(() =>
  import('@/features/projects/pages/ProjectInvitePage').then((module) => ({
    default: module.ProjectInvitePage,
  }))
)
const LegacyProjectRedirectPage = lazy(() =>
  import('@/features/projects/pages/LegacyProjectRedirectPage').then((module) => ({
    default: module.LegacyProjectRedirectPage,
  }))
)
const NewProject = lazy(() =>
  import('@/pages/NewProject').then((module) => ({ default: module.default }))
)
const ProjectBuild = lazy(() =>
  import('@/pages/ProjectBuild').then((module) => ({ default: module.default }))
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
const ProjectConflictsPage = lazy(() =>
  import('@/features/projects/pages/ProjectConflictsPage').then((module) => ({
    default: module.ProjectConflictsPage,
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
const Policies = lazy(() =>
  import('@/pages/workspace/Policies').then((module) => ({ default: module.Policies }))
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

const WORKSPACE_MEMBERS_ROUTE = getSettingsSurfaceRoute('members', 'workspace') ?? '/teams'
const WORKSPACE_PERMISSIONS_ROUTE = getSettingsSurfaceRoute('permissions', 'workspace') ?? '/teams/roles'
const WORKSPACE_GENERAL_ROUTE = getSettingsSurfaceRoute('general', 'workspace') ?? '/workspace/general'
const PERSONAL_GENERAL_ROUTE = getSettingsSurfaceRoute('general', 'personal') ?? '/settings/general'
const WORKSPACE_POLICIES_ROUTE = getSettingsSurfaceRoute('policies', 'workspace') ?? '/workspace/policies'
const WORKSPACE_BILLING_ROUTE = getSettingsSurfaceRoute('billing', 'workspace') ?? '/workspace/billing'
const PERSONAL_BILLING_ROUTE = getSettingsSurfaceRoute('billing', 'personal') ?? '/settings/billing'
const WORKSPACE_AI_ROUTE = getSettingsSurfaceRoute('ai', 'workspace') ?? '/workspace/ai'
const PERSONAL_AI_ROUTE = getSettingsSurfaceRoute('ai', 'personal') ?? '/settings/ai'
const WORKSPACE_MODEL_SELECTION_ROUTE =
  getSettingsSurfaceRoute('modelSelection', 'workspace') ?? '/workspace/ai/model-selection'
const PERSONAL_MODEL_SELECTION_ROUTE =
  getSettingsSurfaceRoute('modelSelection', 'personal') ?? '/settings/ai/model-selection'
const WORKSPACE_INTEGRATIONS_ROUTE =
  getSettingsSurfaceRoute('cliTools', 'workspace') ?? '/workspace/integrations'
const PERSONAL_INTEGRATIONS_ROUTE =
  getSettingsSurfaceRoute('cliTools', 'personal') ?? '/settings/cli-tools'
const WORKSPACE_SOURCE_CONTROL_ROUTE =
  getSettingsSurfaceRoute('sourceControl', 'workspace') ?? '/workspace/source-control'
const PERSONAL_SOURCE_CONTROL_ROUTE =
  getSettingsSurfaceRoute('sourceControl', 'personal') ?? '/settings/source-control'
const WORKSPACE_CLOUD_STORAGE_ROUTE =
  getSettingsSurfaceRoute('cloudStorage', 'workspace') ?? '/workspace/sync'
const PERSONAL_CLOUD_STORAGE_ROUTE =
  getSettingsSurfaceRoute('cloudStorage', 'personal') ?? '/settings/cloud-storage'
const PERSONAL_ACCOUNT_ROUTE = getSettingsSurfaceRoute('account', 'personal') ?? '/settings/account'
const PERSONAL_APPEARANCE_ROUTE =
  getSettingsSurfaceRoute('appearance', 'personal') ?? '/settings/appearance'
const PERSONAL_TOOLING_ROUTE = getSettingsSurfaceRoute('tooling', 'personal') ?? '/settings/tooling'
const PERSONAL_STORAGE_ROUTE = getSettingsSurfaceRoute('storage', 'personal') ?? '/settings/storage'

function toRoutePath(route: string): string {
  return route.replace(/^\//, '')
}

function OrganizationWorkspacePermissionOnly({
  children,
  surfaceId,
  fallback = '/projects',
}: {
  children: ReactNode
  surfaceId: SettingsSurfaceId
  fallback?: string
}) {
  const { isLoading } = useAuth()
  const {
    workspaceScoped,
    surfaceAccess,
  } = useScopedAppContext({ route: '/workspace/general' })

  if (isLoading) {
    return null
  }

  if (!workspaceScoped) {
    return <Navigate to="/projects" replace />
  }

  const surface = getSettingsSurface(surfaceId)
  const allowed = surface
    ? canAccessWorkspaceSurface(
        surface,
        surfaceAccess satisfies WorkspaceSurfaceAccessState
      )
    : false

  if (!allowed) {
    return <Navigate to={fallback} replace />
  }

  return <>{children}</>
}

function WorkspaceScopedSettingRoute({
  personalRedirect,
  children,
}: {
  personalRedirect: string
  children: ReactNode
}) {
  const { isLoading } = useAuth()
  const { currentOrganizationWorkspace, currentPersonalWorkspace } = useResolvedScope({
    ignoreLocation: true,
  })

  if (isLoading) {
    return null
  }

  if (!currentOrganizationWorkspace && !currentPersonalWorkspace) {
    return <Navigate to="/projects" replace />
  }

  if (currentPersonalWorkspace && !currentOrganizationWorkspace) {
    return <Navigate to={personalRedirect} replace />
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
      { path: 'projects/invite/:inviteId', element: <ProjectInvitePage /> },
      { path: 'join/project/:token', element: <ProjectJoinPage /> },
      { path: 'projects/:projectId/build', element: <ProjectBuild /> },
      {
        path: 'projects/p/:projectId',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <Navigate to="pages" replace /> },
          { path: 'files', element: <Navigate to="../pages" replace /> },
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
          { path: 'conflicts', element: <ProjectConflictsPage /> },
          { path: 'settings', element: <ProjectSettingsPage /> },
          { path: 'settings/team', element: <Navigate to="../team" replace /> },
          { path: 'settings/:section', element: <ProjectSettingsPage /> },
          { path: '*', element: <Navigate to="../pages" replace /> },
        ],
      },
      { path: 'projects/:slug', element: <LegacyProjectRedirectPage /> },
      { path: 'projects/:slug/*', element: <LegacyProjectRedirectPage /> },
      {
        path: toRoutePath(WORKSPACE_MEMBERS_ROUTE),
        element: (
          <OrganizationWorkspacePermissionOnly surfaceId="members">
            <Members />
          </OrganizationWorkspacePermissionOnly>
        ),
      },
      {
        path: 'teams/members/:memberId',
        element: (
          <OrganizationWorkspacePermissionOnly surfaceId="members">
            <MemberDetails />
          </OrganizationWorkspacePermissionOnly>
        ),
      },
      {
        path: toRoutePath(WORKSPACE_PERMISSIONS_ROUTE),
        element: (
          <OrganizationWorkspacePermissionOnly surfaceId="permissions">
            <Roles />
          </OrganizationWorkspacePermissionOnly>
        ),
      },
      {
        path: toRoutePath(WORKSPACE_POLICIES_ROUTE),
        element: (
          <OrganizationWorkspacePermissionOnly surfaceId="policies">
            <Policies />
          </OrganizationWorkspacePermissionOnly>
        ),
      },
      { path: 'workspaces/select', element: <WorkspaceSelect /> },
      { path: 'workspaces/new', element: <WorkspaceCreate /> },
      {
        path: toRoutePath(PERSONAL_GENERAL_ROUTE),
        element: <General />,
      },
      {
        path: toRoutePath(WORKSPACE_GENERAL_ROUTE),
        element: (
          <OrganizationWorkspacePermissionOnly surfaceId="general">
            <General />
          </OrganizationWorkspacePermissionOnly>
        ),
      },
      {
        path: toRoutePath(WORKSPACE_BILLING_ROUTE),
        element: (
          <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_BILLING_ROUTE}>
            <OrganizationWorkspacePermissionOnly surfaceId="billing" fallback="/projects">
              <Billing />
            </OrganizationWorkspacePermissionOnly>
          </WorkspaceScopedSettingRoute>
        ),
      },
      {
        path: toRoutePath(WORKSPACE_AI_ROUTE),
        element: (
          <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_AI_ROUTE}>
            <OrganizationWorkspacePermissionOnly surfaceId="ai" fallback="/projects">
              <AI />
            </OrganizationWorkspacePermissionOnly>
          </WorkspaceScopedSettingRoute>
        ),
      },
      {
        path: toRoutePath(WORKSPACE_MODEL_SELECTION_ROUTE),
        element: (
          <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_MODEL_SELECTION_ROUTE}>
            <OrganizationWorkspacePermissionOnly surfaceId="modelSelection" fallback="/projects">
              <ModelSelection />
            </OrganizationWorkspacePermissionOnly>
          </WorkspaceScopedSettingRoute>
        ),
      },
      {
        path: toRoutePath(WORKSPACE_INTEGRATIONS_ROUTE),
        element: (
          <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_INTEGRATIONS_ROUTE}>
            <OrganizationWorkspacePermissionOnly surfaceId="cliTools">
              <Integrations />
            </OrganizationWorkspacePermissionOnly>
          </WorkspaceScopedSettingRoute>
        ),
      },
      { path: toRoutePath(PERSONAL_INTEGRATIONS_ROUTE), element: <Integrations /> },
      {
        path: toRoutePath(WORKSPACE_SOURCE_CONTROL_ROUTE),
        element: (
          <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_SOURCE_CONTROL_ROUTE}>
            <OrganizationWorkspacePermissionOnly surfaceId="sourceControl">
              <SourceControl />
            </OrganizationWorkspacePermissionOnly>
          </WorkspaceScopedSettingRoute>
        ),
      },
      { path: toRoutePath(PERSONAL_SOURCE_CONTROL_ROUTE), element: <SourceControl /> },
      {
        path: toRoutePath(WORKSPACE_CLOUD_STORAGE_ROUTE),
        element: (
          <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_CLOUD_STORAGE_ROUTE}>
            <OrganizationWorkspacePermissionOnly surfaceId="cloudStorage">
              <Sync />
            </OrganizationWorkspacePermissionOnly>
          </WorkspaceScopedSettingRoute>
        ),
      },
      { path: toRoutePath(PERSONAL_CLOUD_STORAGE_ROUTE), element: <Sync /> },
      { path: toRoutePath(PERSONAL_ACCOUNT_ROUTE), element: <Account /> },
      { path: toRoutePath(PERSONAL_BILLING_ROUTE), element: <Billing /> },
      { path: toRoutePath(PERSONAL_AI_ROUTE), element: <AI /> },
      { path: toRoutePath(PERSONAL_MODEL_SELECTION_ROUTE), element: <ModelSelection /> },
      { path: toRoutePath(PERSONAL_APPEARANCE_ROUTE), element: <Appearance /> },
      { path: toRoutePath(PERSONAL_TOOLING_ROUTE), element: <Tooling /> },
      { path: toRoutePath(PERSONAL_STORAGE_ROUTE), element: <Storage /> },
      { path: 'invite/:token', element: <AcceptInvitation /> },
      { path: '*', element: <Navigate to="/projects" replace /> },
    ],
  },
]

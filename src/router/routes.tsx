import { lazy, type ReactNode } from 'react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  useParams,
} from '@tanstack/react-router'

import { AppRoot } from '@/App'
import { Outlet } from '@/lib/router'
import { useAuth } from '@/contexts/AuthContext'
import { useResolvedScope } from '@/hooks/useResolvedScope'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'
import { ProjectsLaunchPage } from '@/features/projects/pages/ProjectsLaunchPage'
import { ProjectLayout } from '@/features/projects/layouts/ProjectLayout'
import { ProjectJoinPage } from '@/features/projects/pages/ProjectJoinPage'
import { ProjectInvitePage } from '@/features/projects/pages/ProjectInvitePage'
import { LegacyProjectRedirectPage } from '@/features/projects/pages/LegacyProjectRedirectPage'
import { ProjectWorkbenchPage } from '@/features/projects/pages/ProjectWorkbenchPage'
import { TasksPage } from '@/features/projects/pages/TasksPage'
import { ProjectSettingsPage } from '@/features/projects/pages/ProjectSettingsPage'
import { ProjectConflictsPage } from '@/features/projects/pages/ProjectConflictsPage'
import { ProjectTeamPage } from '@/features/projects/pages/ProjectTeamPage'
import { General } from '@/pages/workspace/General'
import { Billing } from '@/pages/workspace/Billing'
import { Integrations } from '@/pages/workspace/Integrations'
import { SourceControl } from '@/pages/workspace/SourceControl'
import { Sync } from '@/pages/workspace/Sync'
import { Account } from '@/pages/settings/Account'
import { Appearance } from '@/pages/settings/Appearance'
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
const NewProject = lazy(() =>
  import('@/pages/NewProject').then((module) => ({ default: module.default }))
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
const WORKSPACE_PERMISSIONS_ROUTE =
  getSettingsSurfaceRoute('permissions', 'workspace') ?? '/teams/roles'
const WORKSPACE_GENERAL_ROUTE =
  getSettingsSurfaceRoute('general', 'workspace') ?? '/workspace/general'
const PERSONAL_GENERAL_ROUTE =
  getSettingsSurfaceRoute('general', 'personal') ?? '/settings/general'
const WORKSPACE_POLICIES_ROUTE =
  getSettingsSurfaceRoute('policies', 'workspace') ?? '/workspace/policies'
const WORKSPACE_BILLING_ROUTE =
  getSettingsSurfaceRoute('billing', 'workspace') ?? '/workspace/billing'
const PERSONAL_BILLING_ROUTE =
  getSettingsSurfaceRoute('billing', 'personal') ?? '/settings/billing'
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
const PERSONAL_ACCOUNT_ROUTE =
  getSettingsSurfaceRoute('account', 'personal') ?? '/settings/account'
const PERSONAL_APPEARANCE_ROUTE =
  getSettingsSurfaceRoute('appearance', 'personal') ?? '/settings/appearance'
const PERSONAL_TOOLING_ROUTE =
  getSettingsSurfaceRoute('tooling', 'personal') ?? '/settings/tooling'
const PERSONAL_STORAGE_ROUTE =
  getSettingsSurfaceRoute('storage', 'personal') ?? '/settings/storage'

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
  const { workspaceScoped, surfaceAccess } = useScopedAppContext({ route: '/workspace/general' })

  if (isLoading) {
    return null
  }

  if (!workspaceScoped) {
    return <Navigate to="/projects" replace />
  }

  const surface = getSettingsSurface(surfaceId)
  const allowed = surface
    ? canAccessWorkspaceSurface(surface, surfaceAccess satisfies WorkspaceSurfaceAccessState)
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

function ProjectIndexRedirect() {
  const params = useParams({ strict: false }) as { projectId?: string }
  return <Navigate to="/projects/p/$projectId/workbench" params={{ projectId: params.projectId ?? '' }} replace />
}

function ProjectFilesRedirect() {
  const params = useParams({ strict: false }) as { projectId?: string }
  return <Navigate to="/projects/p/$projectId/workbench" params={{ projectId: params.projectId ?? '' }} replace />
}

function ProjectChangesRedirect() {
  const params = useParams({ strict: false }) as { projectId?: string }
  return (
    <Navigate
      to="/projects/p/$projectId/workbench"
      params={{ projectId: params.projectId ?? "" }}
      search={{ changes: "1" } as never}
      replace
    />
  )
}

function ProjectWorkbenchRedirect() {
  const params = useParams({ strict: false }) as { projectId?: string }
  return <Navigate to="/projects/p/$projectId/workbench" params={{ projectId: params.projectId ?? '' }} replace />
}

function ProjectSettingsTeamRedirect() {
  const params = useParams({ strict: false }) as { projectId?: string }
  return <Navigate to="/projects/p/$projectId/team" params={{ projectId: params.projectId ?? '' }} replace />
}

export const rootRoute = createRootRoute({
  component: AppRoot,
  notFoundComponent: () => <Navigate to="/projects" replace />,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <Navigate to="/projects" replace />,
})

const projectsShellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectLayout,
})

const projectsIndexRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: '/',
  component: ProjectsLaunchPage,
})

const projectNewRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: '/new',
  component: NewProject,
})

const projectJoinRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: '/join/$token',
  component: ProjectJoinPage,
})

const projectInviteRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: '/invite/$inviteId',
  component: ProjectInvitePage,
})

const joinProjectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join/project/$token',
  component: ProjectJoinPage,
})

const projectBuildRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: '/$projectId/build',
  component: ProjectWorkbenchRedirect,
})

const projectRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: '/p/$projectId',
  component: Outlet,
})

const projectIndexRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/',
  component: ProjectIndexRedirect,
})

const projectFilesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/files',
  component: ProjectFilesRedirect,
})

const projectPagesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/pages',
  component: ProjectWorkbenchRedirect,
})

const projectWorkbenchRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/workbench',
  component: ProjectWorkbenchPage,
})

const projectChangesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/changes',
  component: ProjectChangesRedirect,
})

const projectFeedRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/feed',
  component: ProjectChangesRedirect,
})

const projectMergeQueueRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/merge-queue',
  component: ProjectChangesRedirect,
})

const projectVersionControlRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/version-control',
  component: ProjectChangesRedirect,
})

const projectTasksRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/tasks',
  component: TasksPage,
})

const projectTeamRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/team',
  component: ProjectTeamPage,
})

const projectConflictsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/conflicts',
  component: ProjectConflictsPage,
})

const projectSettingsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/settings',
  component: ProjectSettingsPage,
})

const projectSettingsTeamRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/settings/team',
  component: ProjectSettingsTeamRedirect,
})

const projectSettingsSectionRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/settings/$section',
  component: ProjectSettingsPage,
})

const legacyProjectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$slug',
  component: LegacyProjectRedirectPage,
})

const teamsMembersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_MEMBERS_ROUTE),
  component: () => (
    <OrganizationWorkspacePermissionOnly surfaceId="members">
      <Members />
    </OrganizationWorkspacePermissionOnly>
  ),
})

const teamMemberDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/teams/members/$memberId',
  component: () => (
    <OrganizationWorkspacePermissionOnly surfaceId="members">
      <MemberDetails />
    </OrganizationWorkspacePermissionOnly>
  ),
})

const teamsRolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_PERMISSIONS_ROUTE),
  component: () => (
    <OrganizationWorkspacePermissionOnly surfaceId="permissions">
      <Roles />
    </OrganizationWorkspacePermissionOnly>
  ),
})

const workspacePoliciesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_POLICIES_ROUTE),
  component: () => (
    <OrganizationWorkspacePermissionOnly surfaceId="policies">
      <Policies />
    </OrganizationWorkspacePermissionOnly>
  ),
})

const workspaceSelectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces/select',
  component: WorkspaceSelect,
})

const workspaceCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces/new',
  component: WorkspaceCreate,
})

const personalGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_GENERAL_ROUTE),
  component: General,
})

const workspaceGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_GENERAL_ROUTE),
  component: () => (
    <OrganizationWorkspacePermissionOnly surfaceId="general">
      <General />
    </OrganizationWorkspacePermissionOnly>
  ),
})

const workspaceBillingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_BILLING_ROUTE),
  component: () => (
    <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_BILLING_ROUTE}>
      <OrganizationWorkspacePermissionOnly surfaceId="billing" fallback="/projects">
        <Billing />
      </OrganizationWorkspacePermissionOnly>
    </WorkspaceScopedSettingRoute>
  ),
})

const workspaceIntegrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_INTEGRATIONS_ROUTE),
  component: () => (
    <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_INTEGRATIONS_ROUTE}>
      <OrganizationWorkspacePermissionOnly surfaceId="cliTools">
        <Integrations />
      </OrganizationWorkspacePermissionOnly>
    </WorkspaceScopedSettingRoute>
  ),
})

const personalIntegrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_INTEGRATIONS_ROUTE),
  component: Integrations,
})

const workspaceSourceControlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_SOURCE_CONTROL_ROUTE),
  component: () => (
    <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_SOURCE_CONTROL_ROUTE}>
      <OrganizationWorkspacePermissionOnly surfaceId="sourceControl">
        <SourceControl />
      </OrganizationWorkspacePermissionOnly>
    </WorkspaceScopedSettingRoute>
  ),
})

const personalSourceControlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_SOURCE_CONTROL_ROUTE),
  component: SourceControl,
})

const workspaceCloudStorageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_CLOUD_STORAGE_ROUTE),
  component: () => (
    <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_CLOUD_STORAGE_ROUTE}>
      <OrganizationWorkspacePermissionOnly surfaceId="cloudStorage">
        <Sync />
      </OrganizationWorkspacePermissionOnly>
    </WorkspaceScopedSettingRoute>
  ),
})

const personalCloudStorageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_CLOUD_STORAGE_ROUTE),
  component: Sync,
})

const personalAccountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_ACCOUNT_ROUTE),
  component: Account,
})

const personalBillingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_BILLING_ROUTE),
  component: Billing,
})

const personalAppearanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_APPEARANCE_ROUTE),
  component: Appearance,
})

const personalToolingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_TOOLING_ROUTE),
  component: Tooling,
})

const personalStorageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_STORAGE_ROUTE),
  component: Storage,
})

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: AcceptInvitation,
})

export const routeTree = rootRoute.addChildren([
  indexRoute,
  joinProjectRoute,
  projectsShellRoute.addChildren([
    projectsIndexRoute,
    projectNewRoute,
    projectJoinRoute,
    projectInviteRoute,
    projectBuildRoute,
    projectRoute.addChildren([
      projectIndexRoute,
      projectFilesRoute,
      projectWorkbenchRoute,
      projectPagesRoute,
      projectChangesRoute,
      projectFeedRoute,
      projectMergeQueueRoute,
      projectVersionControlRoute,
      projectTasksRoute,
      projectTeamRoute,
      projectConflictsRoute,
      projectSettingsRoute,
      projectSettingsTeamRoute,
      projectSettingsSectionRoute,
    ]),
  ]),
  legacyProjectRoute,
  teamsMembersRoute,
  teamMemberDetailsRoute,
  teamsRolesRoute,
  workspacePoliciesRoute,
  workspaceSelectRoute,
  workspaceCreateRoute,
  personalGeneralRoute,
  workspaceGeneralRoute,
  workspaceBillingRoute,
  workspaceIntegrationsRoute,
  personalIntegrationsRoute,
  workspaceSourceControlRoute,
  personalSourceControlRoute,
  workspaceCloudStorageRoute,
  personalCloudStorageRoute,
  personalAccountRoute,
  personalBillingRoute,
  personalAppearanceRoute,
  personalToolingRoute,
  personalStorageRoute,
  inviteRoute,
])

export const appRouter = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof appRouter
  }
}

import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/router/routes.tsx', 'utf8');

// The file exports `export const appRoutes: RouteObject[] = [`
// We will replace the entire file with a new TanStack router compatible version.
// But doing it via AST is hard in a simple script. 
// Let's just generate a new file.

const newRoutes = `import { lazy, type ReactNode } from 'react'
import { createRootRoute, createRoute, createRouter, Navigate, Outlet } from '@tanstack/react-router'

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
import { Account } from '@/pages/settings/Account'
import { Appearance } from '@/pages/settings/Appearance'
import ModelSelection from "@/pages/settings/ModelSelection"
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

const ProjectLayout = lazy(() => import('@/features/projects/layouts/ProjectLayout').then((m) => ({ default: m.ProjectLayout })))
const ProjectJoinPage = lazy(() => import('@/features/projects/pages/ProjectJoinPage').then((m) => ({ default: m.ProjectJoinPage })))
const ProjectInvitePage = lazy(() => import('@/features/projects/pages/ProjectInvitePage').then((m) => ({ default: m.ProjectInvitePage })))
const LegacyProjectRedirectPage = lazy(() => import('@/features/projects/pages/LegacyProjectRedirectPage').then((m) => ({ default: m.LegacyProjectRedirectPage })))
const NewProject = lazy(() => import('@/pages/NewProject').then((m) => ({ default: m.default })))
const ProjectBuild = lazy(() => import('@/pages/ProjectBuild').then((m) => ({ default: m.default })))
const ProjectPagesPage = lazy(() => import('@/features/projects/pages/ProjectPagesPage').then((m) => ({ default: m.ProjectPagesPage })))
const ProjectDatabasePage = lazy(() => import('@/features/projects/pages/ProjectDatabasePage').then((m) => ({ default: m.ProjectDatabasePage })))
const ProjectDependenciesPage = lazy(() => import('@/features/projects/pages/ProjectDependenciesPage').then((m) => ({ default: m.ProjectDependenciesPage })))
const ProjectBackendStudioPage = lazy(() => import('@/features/projects/pages/ProjectBackendStudioPage').then((m) => ({ default: m.ProjectBackendStudioPage })))
const ChangesPage = lazy(() => import('@/features/projects/pages/ChangesPage').then((m) => ({ default: m.ChangesPage })))
const TasksPage = lazy(() => import('@/features/projects/pages/TasksPage').then((m) => ({ default: m.TasksPage })))
const ProjectSettingsPage = lazy(() => import('@/features/projects/pages/ProjectSettingsPage').then((m) => ({ default: m.ProjectSettingsPage })))
const ProjectConflictsPage = lazy(() => import('@/features/projects/pages/ProjectConflictsPage').then((m) => ({ default: m.ProjectConflictsPage })))
const ProjectTeamPage = lazy(() => import('@/features/projects/pages/ProjectTeamPage').then((m) => ({ default: m.ProjectTeamPage })))
const Members = lazy(() => import('@/pages/teams/Members').then((m) => ({ default: m.Members })))
const MemberDetails = lazy(() => import('@/pages/teams/MemberDetails').then((m) => ({ default: m.MemberDetails })))
const Roles = lazy(() => import('@/pages/teams/Roles').then((m) => ({ default: m.Roles })))
const Policies = lazy(() => import('@/pages/workspace/Policies').then((m) => ({ default: m.Policies })))
const AcceptInvitation = lazy(() => import('@/pages/AcceptInvitation').then((m) => ({ default: m.AcceptInvitation })))
const WorkspaceSelect = lazy(() => import('@/pages/WorkspaceSelect').then((m) => ({ default: m.WorkspaceSelect })))
const WorkspaceCreate = lazy(() => import('@/pages/WorkspaceCreate').then((m) => ({ default: m.WorkspaceCreate })))

const WORKSPACE_MEMBERS_ROUTE = getSettingsSurfaceRoute('members', 'workspace') ?? '/teams'
const WORKSPACE_PERMISSIONS_ROUTE = getSettingsSurfaceRoute('permissions', 'workspace') ?? '/teams/roles'
const WORKSPACE_GENERAL_ROUTE = getSettingsSurfaceRoute('general', 'workspace') ?? '/workspace/general'
const PERSONAL_GENERAL_ROUTE = getSettingsSurfaceRoute('general', 'personal') ?? '/settings/general'
const WORKSPACE_POLICIES_ROUTE = getSettingsSurfaceRoute('policies', 'workspace') ?? '/workspace/policies'
const WORKSPACE_BILLING_ROUTE = getSettingsSurfaceRoute('billing', 'workspace') ?? '/workspace/billing'
const PERSONAL_BILLING_ROUTE = getSettingsSurfaceRoute('billing', 'personal') ?? '/settings/billing'
const WORKSPACE_AI_ROUTE = getSettingsSurfaceRoute('ai', 'workspace') ?? '/workspace/ai'
const PERSONAL_AI_ROUTE = getSettingsSurfaceRoute('ai', 'personal') ?? '/settings/ai'
const WORKSPACE_MODEL_SELECTION_ROUTE = getSettingsSurfaceRoute('modelSelection', 'workspace') ?? '/workspace/ai/model-selection'
const PERSONAL_MODEL_SELECTION_ROUTE = getSettingsSurfaceRoute('modelSelection', 'personal') ?? '/settings/ai/model-selection'
const WORKSPACE_INTEGRATIONS_ROUTE = getSettingsSurfaceRoute('cliTools', 'workspace') ?? '/workspace/integrations'
const PERSONAL_INTEGRATIONS_ROUTE = getSettingsSurfaceRoute('cliTools', 'personal') ?? '/settings/cli-tools'
const WORKSPACE_SOURCE_CONTROL_ROUTE = getSettingsSurfaceRoute('sourceControl', 'workspace') ?? '/workspace/source-control'
const PERSONAL_SOURCE_CONTROL_ROUTE = getSettingsSurfaceRoute('sourceControl', 'personal') ?? '/settings/source-control'
const PERSONAL_ACCOUNT_ROUTE = getSettingsSurfaceRoute('account', 'personal') ?? '/settings/account'
const PERSONAL_APPEARANCE_ROUTE = getSettingsSurfaceRoute('appearance', 'personal') ?? '/settings/appearance'
const PERSONAL_TOOLING_ROUTE = getSettingsSurfaceRoute('tooling', 'personal') ?? '/settings/tooling'
const PERSONAL_STORAGE_ROUTE = getSettingsSurfaceRoute('storage', 'personal') ?? '/settings/storage'

function toRoutePath(route: string): string {
  return route.replace(/^\\//, '')
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

  if (isLoading) return null
  if (!workspaceScoped) return <Navigate to="/projects" replace />

  const surface = getSettingsSurface(surfaceId)
  const allowed = surface ? canAccessWorkspaceSurface(surface, surfaceAccess satisfies WorkspaceSurfaceAccessState) : false

  if (!allowed) return <Navigate to={fallback} replace />
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
  const { currentOrganizationWorkspace, currentPersonalWorkspace } = useResolvedScope({ ignoreLocation: true })

  if (isLoading) return null
  if (!currentOrganizationWorkspace && !currentPersonalWorkspace) return <Navigate to="/projects" replace />
  if (currentPersonalWorkspace && !currentOrganizationWorkspace) return <Navigate to={personalRedirect} replace />

  return <>{children}</>
}

export const rootRoute = createRootRoute({
  component: AppRoot,
})

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <Navigate to="/projects" replace /> })
const projectsListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: Projects })
const projectNewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/new', component: NewProject })
const projectJoinRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/join/$token', component: ProjectJoinPage })
const projectInviteRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/invite/$inviteId', component: ProjectInvitePage })
const projectBuildRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$projectId/build', component: ProjectBuild })

const projectLayoutRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/p/$projectId', component: ProjectLayout })
const projectPagesRoute = createRoute({ getParentRoute: () => projectLayoutRoute, path: '/pages', component: ProjectPagesPage })
const projectDatabaseRoute = createRoute({ getParentRoute: () => projectLayoutRoute, path: '/database', component: ProjectDatabasePage })
const projectDependenciesRoute = createRoute({ getParentRoute: () => projectLayoutRoute, path: '/dependencies', component: ProjectDependenciesPage })
const projectBackendRoute = createRoute({ getParentRoute: () => projectLayoutRoute, path: '/backend', component: ProjectBackendStudioPage })
const projectChangesRoute = createRoute({ getParentRoute: () => projectLayoutRoute, path: '/changes', component: ChangesPage })
const projectTasksRoute = createRoute({ getParentRoute: () => projectLayoutRoute, path: '/tasks', component: TasksPage })
const projectTeamRoute = createRoute({ getParentRoute: () => projectLayoutRoute, path: '/team', component: ProjectTeamPage })
const projectConflictsRoute = createRoute({ getParentRoute: () => projectLayoutRoute, path: '/conflicts', component: ProjectConflictsPage })
const projectSettingsRoute = createRoute({ getParentRoute: () => projectLayoutRoute, path: '/settings', component: ProjectSettingsPage })
const projectSettingsSectionRoute = createRoute({ getParentRoute: () => projectLayoutRoute, path: '/settings/$section', component: ProjectSettingsPage })
const projectIndexRoute = createRoute({ getParentRoute: () => projectLayoutRoute, path: '/', component: () => <Navigate to="/projects/p/$projectId/pages" replace /> })

const workspaceMembersRoute = createRoute({ getParentRoute: () => rootRoute, path: toRoutePath(WORKSPACE_MEMBERS_ROUTE), component: () => <OrganizationWorkspacePermissionOnly surfaceId="members"><Members /></OrganizationWorkspacePermissionOnly> })
const workspacePermissionsRoute = createRoute({ getParentRoute: () => rootRoute, path: toRoutePath(WORKSPACE_PERMISSIONS_ROUTE), component: () => <OrganizationWorkspacePermissionOnly surfaceId="permissions"><Roles /></OrganizationWorkspacePermissionOnly> })
const workspaceGeneralRoute = createRoute({ getParentRoute: () => rootRoute, path: toRoutePath(WORKSPACE_GENERAL_ROUTE), component: () => <OrganizationWorkspacePermissionOnly surfaceId="general"><General /></OrganizationWorkspacePermissionOnly> })
const personalGeneralRoute = createRoute({ getParentRoute: () => rootRoute, path: toRoutePath(PERSONAL_GENERAL_ROUTE), component: General })

export const routeTree = rootRoute.addChildren([
  indexRoute,
  projectsListRoute,
  projectNewRoute,
  projectJoinRoute,
  projectInviteRoute,
  projectBuildRoute,
  projectLayoutRoute.addChildren([
    projectIndexRoute,
    projectPagesRoute,
    projectDatabaseRoute,
    projectDependenciesRoute,
    projectBackendRoute,
    projectChangesRoute,
    projectTasksRoute,
    projectTeamRoute,
    projectConflictsRoute,
    projectSettingsRoute,
    projectSettingsSectionRoute,
  ]),
  workspaceMembersRoute,
  workspacePermissionsRoute,
  workspaceGeneralRoute,
  personalGeneralRoute,
])

export const appRouter = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof appRouter
  }
}
`;

writeFileSync('src/router/routes.tsx', newRoutes);
console.log('Done rewriting routes.tsx');

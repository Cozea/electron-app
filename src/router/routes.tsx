import { Suspense, lazy, type ComponentType, type ReactNode } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  useParams,
} from "@tanstack/react-router";

import { AppRoot } from "@/App";
import { RouteLoading } from "@/router/RouteLoading";
import { Outlet } from "@/lib/router";
import { useAuth } from "@/contexts/AuthContext";
import { useResolvedScope } from "@/hooks/useResolvedScope";
import { useScopedAppContext } from "@/hooks/useScopedAppContext";
import { ProjectsLaunchPage } from "@/features/projects/pages/ProjectsLaunchPage";
import { ProjectLayout } from "@/features/projects/layouts/ProjectLayout";
import { ProjectWorkbenchPage } from "@/features/projects/pages/ProjectWorkbenchPage";
import { TasksPage } from "@/features/projects/pages/TasksPage";
import { ProjectConflictsPage } from "@/features/projects/pages/ProjectConflictsPage";
import { ProjectTeamPage } from "@/features/projects/pages/ProjectTeamPage";
import { AppStorePage } from "@/features/projects/pages/AppStorePage";
import NewProject from "@/pages/NewProject";
import { General } from "@/pages/workspace/General";
import { Billing } from "@/pages/workspace/Billing";
import { Integrations } from "@/pages/workspace/Integrations";
import { SourceControl } from "@/pages/workspace/SourceControl";
import { Account } from "@/pages/settings/Account";
import { Appearance } from "@/pages/settings/Appearance";
import { Storage } from "@/pages/settings/Storage";
import { Tooling } from "@/pages/settings/Tooling";
import { Members } from "@/pages/teams/Members";
import { MemberDetails } from "@/pages/teams/MemberDetails";
import { Roles } from "@/pages/teams/Roles";
import { Policies } from "@/pages/workspace/Policies";
import { AcceptInvitation } from "@/pages/AcceptInvitation";
import { WorkspaceSelect } from "@/pages/WorkspaceSelect";
import { WorkspaceCreate } from "@/pages/WorkspaceCreate";
import {
  canAccessWorkspaceSurface,
  getSettingsSurface,
  getSettingsSurfaceRoute,
} from "@/lib/settings/settingsRegistry";
import type {
  SettingsSurfaceId,
  WorkspaceSurfaceAccessState,
} from "@/lib/settings/settingsSurfaceTypes";

function createLazyRouteComponent(
  loader: () => Promise<{ default: ComponentType }>,
  label: string,
) {
  const LazyComponent = lazy(loader);

  function LazyRouteComponent() {
    return (
      <Suspense fallback={<RouteLoading label={label} />}>
        <LazyComponent />
      </Suspense>
    );
  }

  return LazyRouteComponent;
}

const ProjectJoinPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/ProjectJoinPage").then((module) => ({
      default: module.ProjectJoinPage,
    })),
  "Loading project invite…",
);
const ProjectInvitePage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/ProjectInvitePage").then((module) => ({
      default: module.ProjectInvitePage,
    })),
  "Loading project invite…",
);
const LegacyProjectRedirectPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/LegacyProjectRedirectPage").then((module) => ({
      default: module.LegacyProjectRedirectPage,
    })),
  "Loading project…",
);
const WORKSPACE_MEMBERS_ROUTE = getSettingsSurfaceRoute("members", "workspace") ?? "/teams";
const WORKSPACE_ROLES_ROUTE =
  getSettingsSurfaceRoute("roles", "workspace") ?? "/teams/roles";
const WORKSPACE_GENERAL_ROUTE =
  getSettingsSurfaceRoute("general", "workspace") ?? "/workspace/general";
const PERSONAL_GENERAL_ROUTE =
  getSettingsSurfaceRoute("general", "personal") ?? "/settings/general";
const WORKSPACE_POLICIES_ROUTE =
  getSettingsSurfaceRoute("policies", "workspace") ?? "/workspace/policies";
const WORKSPACE_BILLING_ROUTE =
  getSettingsSurfaceRoute("billing", "workspace") ?? "/workspace/billing";
const PERSONAL_BILLING_ROUTE =
  getSettingsSurfaceRoute("billing", "personal") ?? "/settings/billing";
const WORKSPACE_INTEGRATIONS_ROUTE =
  getSettingsSurfaceRoute("cliTools", "workspace") ?? "/workspace/integrations";
const PERSONAL_INTEGRATIONS_ROUTE =
  getSettingsSurfaceRoute("cliTools", "personal") ?? "/settings/cli-tools";
/** Legacy URL only; source control is user-scoped and lives under `/settings/source-control`. */
const LEGACY_WORKSPACE_SOURCE_CONTROL_ROUTE = "/workspace/source-control";
const PERSONAL_SOURCE_CONTROL_ROUTE =
  getSettingsSurfaceRoute("sourceControl", "personal") ?? "/settings/source-control";
const PERSONAL_ACCOUNT_ROUTE =
  getSettingsSurfaceRoute("account", "personal") ?? "/settings/account";
const PERSONAL_APPEARANCE_ROUTE =
  getSettingsSurfaceRoute("appearance", "personal") ?? "/settings/appearance";
const PERSONAL_TOOLING_ROUTE =
  getSettingsSurfaceRoute("tooling", "personal") ?? "/settings/tooling";
const PERSONAL_STORAGE_ROUTE =
  getSettingsSurfaceRoute("storage", "personal") ?? "/settings/storage";

function toRoutePath(route: string): string {
  return route.replace(/^\//, "");
}

function OrganizationWorkspacePermissionOnly({
  children,
  surfaceId,
  fallback = "/projects",
}: {
  children: ReactNode;
  surfaceId: SettingsSurfaceId;
  fallback?: string;
}) {
  const { isLoading } = useAuth();
  const { workspaceScoped, surfaceAccess } = useScopedAppContext({ route: "/workspace/general" });

  if (isLoading) {
    return null;
  }

  if (!workspaceScoped) {
    return <Navigate to="/projects" replace />;
  }

  const surface = getSettingsSurface(surfaceId);
  const allowed = surface
    ? canAccessWorkspaceSurface(surface, surfaceAccess satisfies WorkspaceSurfaceAccessState)
    : false;

  if (!allowed) {
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}

function WorkspaceScopedSettingRoute({
  personalRedirect,
  children,
}: {
  personalRedirect: string;
  children: ReactNode;
}) {
  const { isLoading } = useAuth();
  const { currentOrganizationWorkspace, currentPersonalWorkspace } = useResolvedScope({
    ignoreLocation: true,
  });

  if (isLoading) {
    return null;
  }

  if (!currentOrganizationWorkspace && !currentPersonalWorkspace) {
    return <Navigate to="/projects" replace />;
  }

  if (currentPersonalWorkspace && !currentOrganizationWorkspace) {
    return <Navigate to={personalRedirect} replace />;
  }

  return <>{children}</>;
}

function ProjectIndexRedirect() {
  const params = useParams({ strict: false }) as { projectId?: string };
  return (
    <Navigate
      to="/projects/p/$projectId/workbench"
      params={{ projectId: params.projectId ?? "" }}
      replace
    />
  );
}

function ProjectFilesRedirect() {
  const params = useParams({ strict: false }) as { projectId?: string };
  return (
    <Navigate
      to="/projects/p/$projectId/workbench"
      params={{ projectId: params.projectId ?? "" }}
      replace
    />
  );
}

function ProjectChangesRedirect() {
  const params = useParams({ strict: false }) as { projectId?: string };
  return (
    <Navigate
      to="/projects/p/$projectId/workbench"
      params={{ projectId: params.projectId ?? "" }}
      search={{ changes: "1" } as never}
      replace
    />
  );
}

function ProjectWorkbenchRedirect() {
  const params = useParams({ strict: false }) as { projectId?: string };
  return (
    <Navigate
      to="/projects/p/$projectId/workbench"
      params={{ projectId: params.projectId ?? "" }}
      replace
    />
  );
}

function LegacyProjectJoinRedirect() {
  const params = useParams({ strict: false }) as { token?: string };
  return (
    <Navigate
      to="/projects/join/$token"
      params={{ token: params.token ?? "" }}
      replace
    />
  );
}

function ProjectSettingsTeamRedirect() {
  const params = useParams({ strict: false }) as { projectId?: string };
  return (
    <Navigate
      to="/projects/p/$projectId/team"
      params={{ projectId: params.projectId ?? "" }}
      replace
    />
  );
}

function ProjectSettingsRedirect() {
  const params = useParams({ strict: false }) as { projectId?: string };
  return (
    <Navigate
      to="/projects/p/$projectId/workbench"
      params={{ projectId: params.projectId ?? "" }}
      search={{ settings: "1" } as never}
      replace
    />
  );
}

export const rootRoute = createRootRoute({
  component: AppRoot,
  notFoundComponent: () => <Navigate to="/projects" replace />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/projects" replace />,
});

const projectsShellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: ProjectLayout,
});

const projectsIndexRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/",
  component: ProjectsLaunchPage,
});

const projectsStoreRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/store",
  component: AppStorePage,
});

const projectNewRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/new",
  component: NewProject,
});

const projectJoinRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/join/$token",
  component: ProjectJoinPage,
});

const projectInviteRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/invite/$inviteId",
  component: ProjectInvitePage,
});

const joinProjectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/join/project/$token",
  component: LegacyProjectJoinRedirect,
});

const projectBuildRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/$projectId/build",
  component: ProjectWorkbenchRedirect,
});

const projectRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/p/$projectId",
  component: Outlet,
});

const projectIndexRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/",
  component: ProjectIndexRedirect,
});

const projectFilesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/files",
  component: ProjectFilesRedirect,
});

const projectPagesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/pages",
  component: ProjectWorkbenchRedirect,
});

const projectWorkbenchRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/workbench",
  component: ProjectWorkbenchPage,
});

const projectChangesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/changes",
  component: ProjectChangesRedirect,
});

const projectFeedRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/feed",
  component: ProjectChangesRedirect,
});

const projectMergeQueueRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/merge-queue",
  component: ProjectChangesRedirect,
});

const projectVersionControlRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/version-control",
  component: ProjectChangesRedirect,
});

const projectTasksRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/tasks",
  component: TasksPage,
});

const projectTeamRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/team",
  component: ProjectTeamPage,
});

const projectConflictsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/conflicts",
  component: ProjectConflictsPage,
});

const projectSettingsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/settings",
  component: ProjectSettingsRedirect,
});

const projectSettingsTeamRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/settings/team",
  component: ProjectSettingsTeamRedirect,
});

const projectSettingsSectionRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/settings/$section",
  component: ProjectSettingsRedirect,
});

const legacyProjectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$slug",
  component: LegacyProjectRedirectPage,
});

const projectsTeamsMembersRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_MEMBERS_ROUTE),
  component: () => (
    <OrganizationWorkspacePermissionOnly surfaceId="members">
      <Members />
    </OrganizationWorkspacePermissionOnly>
  ),
});

const projectsTeamMemberDetailsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/teams/members/$memberId",
  component: () => (
    <OrganizationWorkspacePermissionOnly surfaceId="members">
      <MemberDetails />
    </OrganizationWorkspacePermissionOnly>
  ),
});

const projectsTeamsRolesRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_ROLES_ROUTE),
  component: () => (
    <OrganizationWorkspacePermissionOnly surfaceId="roles">
      <Roles />
    </OrganizationWorkspacePermissionOnly>
  ),
});

const projectsWorkspacePoliciesRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_POLICIES_ROUTE),
  component: () => (
    <OrganizationWorkspacePermissionOnly surfaceId="policies">
      <Policies />
    </OrganizationWorkspacePermissionOnly>
  ),
});

const projectsPersonalGeneralRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_GENERAL_ROUTE),
  component: General,
});

const projectsWorkspaceGeneralRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_GENERAL_ROUTE),
  component: () => (
    <OrganizationWorkspacePermissionOnly surfaceId="general">
      <General />
    </OrganizationWorkspacePermissionOnly>
  ),
});

const projectsWorkspaceBillingRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_BILLING_ROUTE),
  component: () => (
    <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_BILLING_ROUTE}>
      <OrganizationWorkspacePermissionOnly surfaceId="billing" fallback="/projects">
        <Billing />
      </OrganizationWorkspacePermissionOnly>
    </WorkspaceScopedSettingRoute>
  ),
});

const projectsWorkspaceIntegrationsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_INTEGRATIONS_ROUTE),
  component: () => (
    <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_INTEGRATIONS_ROUTE}>
      <OrganizationWorkspacePermissionOnly surfaceId="cliTools">
        <Integrations />
      </OrganizationWorkspacePermissionOnly>
    </WorkspaceScopedSettingRoute>
  ),
});

const projectsPersonalIntegrationsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_INTEGRATIONS_ROUTE),
  component: Integrations,
});

const projectsWorkspaceSourceControlRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(LEGACY_WORKSPACE_SOURCE_CONTROL_ROUTE),
  component: () => <Navigate to={"/projects/settings/source-control" as never} replace />,
});

const projectsPersonalSourceControlRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_SOURCE_CONTROL_ROUTE),
  component: SourceControl,
});

/** Legacy cloud storage settings (removed); send users to workspace / personal general settings. */
const projectsLegacyWorkspaceSyncRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "workspace/sync",
  component: () => <Navigate to={"/projects/workspace/general" as never} replace />,
});

const projectsLegacyPersonalCloudStorageRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "settings/cloud-storage",
  component: () => <Navigate to={"/projects/settings/general" as never} replace />,
});

const projectsPersonalAccountRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_ACCOUNT_ROUTE),
  component: Account,
});

const projectsPersonalBillingRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_BILLING_ROUTE),
  component: Billing,
});

const projectsPersonalAppearanceRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_APPEARANCE_ROUTE),
  component: Appearance,
});

const projectsPersonalToolingRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_TOOLING_ROUTE),
  component: Tooling,
});

const projectsPersonalStorageRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_STORAGE_ROUTE),
  component: Storage,
});

const teamsMembersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_MEMBERS_ROUTE),
  component: () => <Navigate to={"/projects/teams" as never} replace />,
});

const teamMemberDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/teams/members/$memberId",
  component: () => {
    const params = useParams({ strict: false }) as { memberId?: string };
    return (
      <Navigate
        to="/projects/teams/members/$memberId"
        params={{ memberId: params.memberId ?? "" }}
        replace
      />
    );
  },
});

const teamsRolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_ROLES_ROUTE),
  component: () => <Navigate to={"/projects/teams/roles" as never} replace />,
});

const workspacePoliciesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_POLICIES_ROUTE),
  component: () => <Navigate to={"/projects/workspace/policies" as never} replace />,
});

const workspaceSelectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspaces/select",
  component: WorkspaceSelect,
});

const workspaceCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspaces/new",
  component: WorkspaceCreate,
});

const personalGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_GENERAL_ROUTE),
  component: () => <Navigate to={"/projects/settings/general" as never} replace />,
});

const workspaceGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_GENERAL_ROUTE),
  component: () => <Navigate to={"/projects/workspace/general" as never} replace />,
});

const workspaceBillingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_BILLING_ROUTE),
  component: () => <Navigate to={"/projects/workspace/billing" as never} replace />,
});

const workspaceIntegrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_INTEGRATIONS_ROUTE),
  component: () => <Navigate to={"/projects/workspace/integrations" as never} replace />,
});

const personalIntegrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_INTEGRATIONS_ROUTE),
  component: () => <Navigate to={"/projects/settings/cli-tools" as never} replace />,
});

const workspaceSourceControlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(LEGACY_WORKSPACE_SOURCE_CONTROL_ROUTE),
  component: () => <Navigate to={"/projects/settings/source-control" as never} replace />,
});

const personalSourceControlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_SOURCE_CONTROL_ROUTE),
  component: () => <Navigate to={"/projects/settings/source-control" as never} replace />,
});

const workspaceSyncLegacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "workspace/sync",
  component: () => <Navigate to={"/projects/workspace/general" as never} replace />,
});

const personalCloudStorageLegacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings/cloud-storage",
  component: () => <Navigate to={"/projects/settings/general" as never} replace />,
});

const personalAccountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_ACCOUNT_ROUTE),
  component: () => <Navigate to={"/projects/settings/account" as never} replace />,
});

const personalBillingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_BILLING_ROUTE),
  component: () => <Navigate to={"/projects/settings/billing" as never} replace />,
});

const personalAppearanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_APPEARANCE_ROUTE),
  component: () => <Navigate to={"/projects/settings/appearance" as never} replace />,
});

const personalToolingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_TOOLING_ROUTE),
  component: () => <Navigate to={"/projects/settings/tooling" as never} replace />,
});

const personalStorageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_STORAGE_ROUTE),
  component: () => <Navigate to={"/projects/settings/storage" as never} replace />,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: AcceptInvitation,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  joinProjectRoute,
  projectsShellRoute.addChildren([
    projectsIndexRoute,
    projectsStoreRoute,
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
    projectsTeamsMembersRoute,
    projectsTeamMemberDetailsRoute,
    projectsTeamsRolesRoute,
    projectsWorkspacePoliciesRoute,
    projectsPersonalGeneralRoute,
    projectsWorkspaceGeneralRoute,
    projectsWorkspaceBillingRoute,
    projectsWorkspaceIntegrationsRoute,
    projectsPersonalIntegrationsRoute,
    projectsWorkspaceSourceControlRoute,
    projectsPersonalSourceControlRoute,
    projectsLegacyWorkspaceSyncRoute,
    projectsLegacyPersonalCloudStorageRoute,
    projectsPersonalAccountRoute,
    projectsPersonalBillingRoute,
    projectsPersonalAppearanceRoute,
    projectsPersonalToolingRoute,
    projectsPersonalStorageRoute,
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
  workspaceSyncLegacyRoute,
  personalCloudStorageLegacyRoute,
  personalAccountRoute,
  personalBillingRoute,
  personalAppearanceRoute,
  personalToolingRoute,
  personalStorageRoute,
  inviteRoute,
]);

export const appRouter = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof appRouter;
  }
}

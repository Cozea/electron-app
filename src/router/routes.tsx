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

const ProjectsLaunchPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/ProjectsLaunchPage").then((module) => ({
      default: module.ProjectsLaunchPage,
    })),
  "Loading projects…",
);
const ProjectLayout = createLazyRouteComponent(
  () =>
    import("@/features/projects/layouts/ProjectLayout").then((module) => ({
      default: module.ProjectLayout,
    })),
  "Loading project…",
);
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
const ProjectWorkbenchPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/ProjectWorkbenchPage").then((module) => ({
      default: module.ProjectWorkbenchPage,
    })),
  "Loading workbench…",
);
const TasksPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/TasksPage").then((module) => ({
      default: module.TasksPage,
    })),
  "Loading tasks…",
);
const ProjectConflictsPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/ProjectConflictsPage").then((module) => ({
      default: module.ProjectConflictsPage,
    })),
  "Loading conflicts…",
);
const ProjectTeamPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/ProjectTeamPage").then((module) => ({
      default: module.ProjectTeamPage,
    })),
  "Loading project team…",
);
const General = createLazyRouteComponent(
  () =>
    import("@/pages/workspace/General").then((module) => ({
      default: module.General,
    })),
  "Loading settings…",
);
const Billing = createLazyRouteComponent(
  () =>
    import("@/pages/workspace/Billing").then((module) => ({
      default: module.Billing,
    })),
  "Loading billing…",
);
const Integrations = createLazyRouteComponent(
  () =>
    import("@/pages/workspace/Integrations").then((module) => ({
      default: module.Integrations,
    })),
  "Loading integrations…",
);
const SourceControl = createLazyRouteComponent(
  () =>
    import("@/pages/workspace/SourceControl").then((module) => ({
      default: module.SourceControl,
    })),
  "Loading source control…",
);
const Sync = createLazyRouteComponent(
  () =>
    import("@/pages/workspace/Sync").then((module) => ({
      default: module.Sync,
    })),
  "Loading cloud storage…",
);
const Account = createLazyRouteComponent(
  () =>
    import("@/pages/settings/Account").then((module) => ({
      default: module.Account,
    })),
  "Loading account settings…",
);
const Appearance = createLazyRouteComponent(
  () =>
    import("@/pages/settings/Appearance").then((module) => ({
      default: module.Appearance,
    })),
  "Loading appearance settings…",
);
const Storage = createLazyRouteComponent(
  () =>
    import("@/pages/settings/Storage").then((module) => ({
      default: module.Storage,
    })),
  "Loading storage settings…",
);
const Tooling = createLazyRouteComponent(
  () =>
    import("@/pages/settings/Tooling").then((module) => ({
      default: module.Tooling,
    })),
  "Loading tooling settings…",
);
const NewProject = createLazyRouteComponent(
  () => import("@/pages/NewProject").then((module) => ({ default: module.default })),
  "Loading project setup…",
);
const Members = createLazyRouteComponent(
  () => import("@/pages/teams/Members").then((module) => ({ default: module.Members })),
  "Loading team members…",
);
const MemberDetails = createLazyRouteComponent(
  () =>
    import("@/pages/teams/MemberDetails").then((module) => ({
      default: module.MemberDetails,
    })),
  "Loading member details…",
);
const Roles = createLazyRouteComponent(
  () => import("@/pages/teams/Roles").then((module) => ({ default: module.Roles })),
  "Loading roles…",
);
const Policies = createLazyRouteComponent(
  () =>
    import("@/pages/workspace/Policies").then((module) => ({ default: module.Policies })),
  "Loading policies…",
);
const AcceptInvitation = createLazyRouteComponent(
  () =>
    import("@/pages/AcceptInvitation").then((module) => ({
      default: module.AcceptInvitation,
    })),
  "Loading invitation…",
);
const WorkspaceSelect = createLazyRouteComponent(
  () =>
    import("@/pages/WorkspaceSelect").then((module) => ({
      default: module.WorkspaceSelect,
    })),
  "Loading workspaces…",
);
const WorkspaceCreate = createLazyRouteComponent(
  () =>
    import("@/pages/WorkspaceCreate").then((module) => ({
      default: module.WorkspaceCreate,
    })),
  "Loading workspace setup…",
);

const WORKSPACE_MEMBERS_ROUTE = getSettingsSurfaceRoute("members", "workspace") ?? "/teams";
const WORKSPACE_PERMISSIONS_ROUTE =
  getSettingsSurfaceRoute("permissions", "workspace") ?? "/teams/roles";
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
const WORKSPACE_CLOUD_STORAGE_ROUTE =
  getSettingsSurfaceRoute("cloudStorage", "workspace") ?? "/workspace/sync";
const PERSONAL_CLOUD_STORAGE_ROUTE =
  getSettingsSurfaceRoute("cloudStorage", "personal") ?? "/settings/cloud-storage";
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
    return <RouteLoading label="Loading workspace…" />;
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
    return <RouteLoading label="Resolving workspace…" />;
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
  component: ProjectJoinPage,
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
  path: toRoutePath(WORKSPACE_PERMISSIONS_ROUTE),
  component: () => (
    <OrganizationWorkspacePermissionOnly surfaceId="permissions">
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

const projectsWorkspaceCloudStorageRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_CLOUD_STORAGE_ROUTE),
  component: () => (
    <WorkspaceScopedSettingRoute personalRedirect={PERSONAL_CLOUD_STORAGE_ROUTE}>
      <OrganizationWorkspacePermissionOnly surfaceId="cloudStorage">
        <Sync />
      </OrganizationWorkspacePermissionOnly>
    </WorkspaceScopedSettingRoute>
  ),
});

const projectsPersonalCloudStorageRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_CLOUD_STORAGE_ROUTE),
  component: Sync,
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
  path: toRoutePath(WORKSPACE_PERMISSIONS_ROUTE),
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

const workspaceCloudStorageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_CLOUD_STORAGE_ROUTE),
  component: () => <Navigate to={"/projects/workspace/sync" as never} replace />,
});

const personalCloudStorageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_CLOUD_STORAGE_ROUTE),
  component: () => <Navigate to={"/projects/settings/cloud-storage" as never} replace />,
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
    projectsWorkspaceCloudStorageRoute,
    projectsPersonalCloudStorageRoute,
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
  workspaceCloudStorageRoute,
  personalCloudStorageRoute,
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

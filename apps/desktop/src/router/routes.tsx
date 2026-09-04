import { Suspense, lazy, type ComponentType } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  useParams,
} from "@tanstack/react-router";

import { AppRoot } from "@/App";
import { AppErrorScreen } from "@/components/AppErrorScreen";
import type { TranslationKey } from "@/lib/i18n/en";
import { RouteLoading } from "@/router/RouteLoading";
import { Outlet } from "@/lib/router";
import { ProjectLayout } from "@/features/projects/layouts/ProjectLayout";

function createLazyRouteComponent(
  loader: () => Promise<{ default: ComponentType }>,
  labelKey: TranslationKey,
) {
  const LazyComponent = lazy(loader);

  function LazyRouteComponent() {
    return (
      <Suspense fallback={<RouteLoading labelKey={labelKey} />}>
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
  "routeLoading.projectInvite",
);
const ProjectInvitePage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/ProjectInvitePage").then((module) => ({
      default: module.ProjectInvitePage,
    })),
  "routeLoading.projectInvite",
);
const LegacyProjectRedirectPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/LegacyProjectRedirectPage").then((module) => ({
      default: module.LegacyProjectRedirectPage,
    })),
  "routeLoading.project",
);
const ProjectsLaunchPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/ProjectsLaunchPage").then((module) => ({
      default: module.ProjectsLaunchPage,
    })),
  "routeLoading.projects",
);
const ProjectWorkbenchPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/ProjectWorkbenchPage").then((module) => ({
      default: module.ProjectWorkbenchPage,
    })),
  "routeLoading.workbench",
);
const TasksPage = createLazyRouteComponent(
  () =>
    import("@/features/tasks/pages/TasksPage").then((module) => ({
      default: module.TasksPage,
    })),
  "routeLoading.tasks",
);
const ProjectConflictsPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/ProjectConflictsPage").then((module) => ({
      default: module.ProjectConflictsPage,
    })),
  "routeLoading.conflicts",
);
const ProjectTeamPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/ProjectTeamPage").then((module) => ({
      default: module.ProjectTeamPage,
    })),
  "routeLoading.team",
);
const AppStorePage = createLazyRouteComponent(
  () =>
    import("@/features/devapps/pages/AppStorePage").then((module) => ({
      default: module.AppStorePage,
    })),
  "routeLoading.store",
);
const AgentSkillsPage = createLazyRouteComponent(
  () =>
    import("@/features/projects/pages/AgentSkillsPage").then((module) => ({
      default: module.AgentSkillsPage,
    })),
  "routeLoading.agentSkills",
);
const NewProject = createLazyRouteComponent(
  () =>
    import("@/pages/NewProject").then((module) => ({
      default: module.default,
    })),
  "routeLoading.newProject",
);
const Account = createLazyRouteComponent(
  () =>
    import("@/features/settings/Account").then((module) => ({
      default: module.Account,
    })),
  "routeLoading.account",
);
const Appearance = createLazyRouteComponent(
  () =>
    import("@/features/settings/Appearance").then((module) => ({
      default: module.Appearance,
    })),
  "routeLoading.appearance",
);
const Organizations = createLazyRouteComponent(
  () =>
    import("@/features/settings/Organizations").then((module) => ({
      default: module.Organizations,
    })),
  "routeLoading.organizations",
);
const DevAppSettings = createLazyRouteComponent(
  () =>
    import("@/features/settings/DevAppSettings").then((module) => ({
      default: module.DevAppSettings,
    })),
  "routeLoading.devapps",
);
const Tooling = createLazyRouteComponent(
  () =>
    import("@/features/settings/Tooling").then((module) => ({
      default: module.Tooling,
    })),
  "routeLoading.tooling",
);
const WORKSPACE_MEMBERS_ROUTE = "/teams";
const WORKSPACE_ROLES_ROUTE = "/teams/roles";
const WORKSPACE_GENERAL_ROUTE = "/workspace/general";
const PERSONAL_GENERAL_ROUTE = "/settings/general";
const WORKSPACE_POLICIES_ROUTE = "/workspace/policies";
const WORKSPACE_BILLING_ROUTE = "/workspace/billing";
const PERSONAL_BILLING_ROUTE = "/settings/billing";
const WORKSPACE_INTEGRATIONS_ROUTE = "/workspace/integrations";
const PERSONAL_INTEGRATIONS_ROUTE = "/settings/cli-tools";
const LEGACY_WORKSPACE_SOURCE_CONTROL_ROUTE = "/workspace/source-control";
const PERSONAL_SOURCE_CONTROL_ROUTE = "/settings/source-control";
const PERSONAL_ACCOUNT_ROUTE = "/settings/account";
const PERSONAL_APPEARANCE_ROUTE = "/settings/appearance";
const PERSONAL_DEVAPPS_ROUTE = "/settings/devapps";
const PERSONAL_ORGANIZATIONS_ROUTE = "/settings/organizations";
const PERSONAL_TOOLING_ROUTE = "/settings/tooling";
function toRoutePath(route: string): string {
  return route.replace(/^\//, "");
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
  errorComponent: AppErrorScreen,
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

const projectsAgentSkillsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/skills",
  component: AgentSkillsPage,
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
  component: () => <Navigate to="/projects" replace />,
});

const projectsTeamMemberDetailsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/teams/members/$memberId",
  component: () => <Navigate to="/projects" replace />,
});

const projectsTeamsRolesRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_ROLES_ROUTE),
  component: () => <Navigate to="/projects" replace />,
});

const projectsWorkspacePoliciesRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_POLICIES_ROUTE),
  component: () => <Navigate to="/projects" replace />,
});

const projectsPersonalGeneralRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_GENERAL_ROUTE),
  component: () => <Navigate to={"/projects/settings/account" as never} replace />,
});

const projectsWorkspaceGeneralRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_GENERAL_ROUTE),
  component: () => <Navigate to="/projects" replace />,
});

const projectsWorkspaceBillingRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_BILLING_ROUTE),
  component: () => <Navigate to="/projects" replace />,
});

const projectsWorkspaceIntegrationsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(WORKSPACE_INTEGRATIONS_ROUTE),
  component: () => <Navigate to={"/projects/settings/tooling" as never} replace />,
});

const projectsPersonalIntegrationsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_INTEGRATIONS_ROUTE),
  component: () => <Navigate to={"/projects/settings/tooling" as never} replace />,
});

const projectsWorkspaceSourceControlRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(LEGACY_WORKSPACE_SOURCE_CONTROL_ROUTE),
  component: () => <Navigate to="/projects" replace />,
});

const projectsPersonalSourceControlRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_SOURCE_CONTROL_ROUTE),
  component: () => <Navigate to="/projects" replace />,
});

/** Legacy cloud storage settings (removed); send users to workspace / personal general settings. */
const projectsLegacyWorkspaceSyncRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "workspace/sync",
  component: () => <Navigate to={"/projects/settings/account" as never} replace />,
});

const projectsLegacyPersonalCloudStorageRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "settings/cloud-storage",
  component: () => <Navigate to={"/projects/settings/account" as never} replace />,
});

const projectsPersonalAccountRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_ACCOUNT_ROUTE),
  component: Account,
});

const projectsPersonalBillingRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_BILLING_ROUTE),
  component: () => <Navigate to="/projects" replace />,
});

const projectsPersonalAppearanceRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_APPEARANCE_ROUTE),
  component: Appearance,
});

const projectsPersonalDevAppsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_DEVAPPS_ROUTE),
  component: DevAppSettings,
});

const projectsPersonalOrganizationsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_ORGANIZATIONS_ROUTE),
  component: Organizations,
});

const projectsPersonalToolingRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_TOOLING_ROUTE),
  component: Tooling,
});

const teamsMembersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_MEMBERS_ROUTE),
  component: () => <Navigate to="/projects" replace />,
});

const teamMemberDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/teams/members/$memberId",
  component: () => <Navigate to="/projects" replace />,
});

const teamsRolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_ROLES_ROUTE),
  component: () => <Navigate to="/projects" replace />,
});

const workspacePoliciesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_POLICIES_ROUTE),
  component: () => <Navigate to={"/projects" as never} replace />,
});

const workspaceSelectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspaces/select",
  component: () => <Navigate to="/projects" replace />,
});

const workspaceCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspaces/new",
  component: () => <Navigate to="/projects" replace />,
});

const personalGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_GENERAL_ROUTE),
  component: () => <Navigate to={"/projects/settings/account" as never} replace />,
});

const workspaceGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_GENERAL_ROUTE),
  component: () => <Navigate to={"/projects" as never} replace />,
});

const workspaceBillingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_BILLING_ROUTE),
  component: () => <Navigate to={"/projects" as never} replace />,
});

const workspaceIntegrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(WORKSPACE_INTEGRATIONS_ROUTE),
  component: () => <Navigate to={"/projects" as never} replace />,
});

const personalIntegrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_INTEGRATIONS_ROUTE),
  component: () => <Navigate to={"/projects/settings/tooling" as never} replace />,
});

const workspaceSourceControlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(LEGACY_WORKSPACE_SOURCE_CONTROL_ROUTE),
  component: () => <Navigate to={"/projects" as never} replace />,
});

const personalSourceControlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_SOURCE_CONTROL_ROUTE),
  component: () => <Navigate to={"/projects" as never} replace />,
});

const workspaceSyncLegacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "workspace/sync",
  component: () => <Navigate to={"/projects" as never} replace />,
});

const personalCloudStorageLegacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings/cloud-storage",
  component: () => <Navigate to={"/projects/settings/account" as never} replace />,
});

const personalAccountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_ACCOUNT_ROUTE),
  component: () => <Navigate to={"/projects/settings/account" as never} replace />,
});

const personalBillingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_BILLING_ROUTE),
  component: () => <Navigate to={"/projects" as never} replace />,
});

const personalAppearanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_APPEARANCE_ROUTE),
  component: () => <Navigate to={"/projects/settings/appearance" as never} replace />,
});

const personalDevAppsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_DEVAPPS_ROUTE),
  component: () => <Navigate to={"/projects/settings/devapps" as never} replace />,
});

const personalOrganizationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_ORGANIZATIONS_ROUTE),
  component: () => <Navigate to={"/projects/settings/organizations" as never} replace />,
});

const personalToolingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_TOOLING_ROUTE),
  component: () => <Navigate to={"/projects/settings/tooling" as never} replace />,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: () => <Navigate to="/projects" replace />,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  joinProjectRoute,
  projectsShellRoute.addChildren([
    projectsIndexRoute,
    projectsStoreRoute,
    projectsAgentSkillsRoute,
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
    projectsPersonalDevAppsRoute,
    projectsPersonalOrganizationsRoute,
    projectsPersonalToolingRoute,
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
  personalDevAppsRoute,
  personalOrganizationsRoute,
  personalToolingRoute,
  inviteRoute,
]);

export const appRouter = createRouter({
  routeTree,
  defaultErrorComponent: AppErrorScreen,
  // Keep selected router-state slices (search/params projections) identity-
  // stable across transitions so subscribers only re-render on real changes.
  defaultStructuralSharing: true,
});

if (import.meta.env.DEV && typeof window !== "undefined") {
  // Exposed for render-performance diagnostics (router state churn analysis).
  (window as unknown as Record<string, unknown>).__appRouter = appRouter;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof appRouter;
  }
}

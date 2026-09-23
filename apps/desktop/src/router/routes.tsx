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
import { destinationModules } from "@/app/navigation/destinationModules";
import { settingsModules } from "@/lib/settings/settingsModules";

// Ordinary pages the shell keeps mounted (hidden) after you leave them, so a
// return shows them instantly with their scroll, filters and data. See
// app/navigation/RetainedPageOutlet.tsx. Redirects, the workbench (retained by
// its own surface) and one-off flows such as join links are not marked.
const RETAINED_PAGE = { retainPage: true } as const;

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
const ProjectsLaunchPage = createLazyRouteComponent(
  () =>
    destinationModules.projects().then((module) => ({
      default: module.ProjectsLaunchPage,
    })),
  "routeLoading.projects",
);
const ProjectWorkbenchPage = createLazyRouteComponent(
  () =>
    destinationModules.workbench().then((module) => ({
      default: module.ProjectWorkbenchPage,
    })),
  "routeLoading.workbench",
);
const TasksPage = createLazyRouteComponent(
  () =>
    destinationModules.tasks().then((module) => ({
      default: module.TasksPage,
    })),
  "routeLoading.tasks",
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
    destinationModules.store().then((module) => ({
      default: module.AppStorePage,
    })),
  "routeLoading.store",
);
const AgentSkillsPage = createLazyRouteComponent(
  () =>
    destinationModules.skills().then((module) => ({
      default: module.AgentSkillsPage,
    })),
  "routeLoading.agentSkills",
);
const InboxPage = createLazyRouteComponent(
  () =>
    destinationModules.inbox().then((module) => ({
      default: module.InboxPage,
    })),
  "routeLoading.inbox",
);
const NewProject = createLazyRouteComponent(
  () =>
    destinationModules.newProject().then((module) => ({
      default: module.default,
    })),
  "routeLoading.newProject",
);
const Account = createLazyRouteComponent(
  () =>
    settingsModules.account().then((module) => ({
      default: module.Account,
    })),
  "routeLoading.account",
);
const Appearance = createLazyRouteComponent(
  () =>
    settingsModules.appearance().then((module) => ({
      default: module.Appearance,
    })),
  "routeLoading.appearance",
);
const Organizations = createLazyRouteComponent(
  () =>
    settingsModules.organizations().then((module) => ({
      default: module.Organizations,
    })),
  "routeLoading.organizations",
);
const DevAppSettings = createLazyRouteComponent(
  () =>
    settingsModules.devapps().then((module) => ({
      default: module.DevAppSettings,
    })),
  "routeLoading.devapps",
);
const Tooling = createLazyRouteComponent(
  () =>
    settingsModules.tooling().then((module) => ({
      default: module.Tooling,
    })),
  "routeLoading.tooling",
);
const ComputerUse = createLazyRouteComponent(
  () =>
    settingsModules.computerUse().then((module) => ({
      default: module.ComputerUse,
    })),
  "routeLoading.computerUse",
);
const GitHubSettings = createLazyRouteComponent(
  () =>
    settingsModules.github().then((module) => ({
      default: module.GitHubSettings,
    })),
  "routeLoading.github",
);
const PERSONAL_ACCOUNT_ROUTE = "/settings/account";
const PERSONAL_APPEARANCE_ROUTE = "/settings/appearance";
const PERSONAL_DEVAPPS_ROUTE = "/settings/devapps";
const PERSONAL_ORGANIZATIONS_ROUTE = "/settings/organizations";
const PERSONAL_TOOLING_ROUTE = "/settings/tooling";
const PERSONAL_COMPUTER_USE_ROUTE = "/settings/computer-use";
const PERSONAL_GITHUB_ROUTE = "/settings/github";
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
  staticData: RETAINED_PAGE,
});

const projectsStoreRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/store",
  component: AppStorePage,
  staticData: RETAINED_PAGE,
});

const projectsAgentSkillsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/skills",
  component: AgentSkillsPage,
  staticData: RETAINED_PAGE,
});

const projectsInboxRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/inbox",
  component: InboxPage,
  staticData: RETAINED_PAGE,
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
  staticData: RETAINED_PAGE,
});

const projectTeamRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/team",
  component: ProjectTeamPage,
  staticData: RETAINED_PAGE,
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

const projectsPersonalAccountRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_ACCOUNT_ROUTE),
  component: Account,
  staticData: RETAINED_PAGE,
});

const projectsPersonalAppearanceRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_APPEARANCE_ROUTE),
  component: Appearance,
  staticData: RETAINED_PAGE,
});

const projectsPersonalDevAppsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_DEVAPPS_ROUTE),
  component: DevAppSettings,
  staticData: RETAINED_PAGE,
});

const projectsPersonalOrganizationsRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_ORGANIZATIONS_ROUTE),
  component: Organizations,
  staticData: RETAINED_PAGE,
});

const projectsPersonalToolingRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_TOOLING_ROUTE),
  component: Tooling,
  staticData: RETAINED_PAGE,
});

const projectsPersonalComputerUseRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_COMPUTER_USE_ROUTE),
  component: ComputerUse,
  staticData: RETAINED_PAGE,
});

const projectsPersonalGitHubRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: toRoutePath(PERSONAL_GITHUB_ROUTE),
  component: GitHubSettings,
  staticData: RETAINED_PAGE,
});

const personalAccountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_ACCOUNT_ROUTE),
  component: () => <Navigate to={"/projects/settings/account" as never} replace />,
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

const personalComputerUseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_COMPUTER_USE_ROUTE),
  component: () => <Navigate to={"/projects/settings/computer-use" as never} replace />,
});

const personalGitHubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: toRoutePath(PERSONAL_GITHUB_ROUTE),
  component: () => <Navigate to={"/projects/settings/github" as never} replace />,
});

const inboxRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  component: () => <Navigate to={"/projects/inbox" as never} replace />,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  joinProjectRoute,
  inboxRedirectRoute,
  projectsShellRoute.addChildren([
    projectsIndexRoute,
    projectsStoreRoute,
    projectsAgentSkillsRoute,
    projectsInboxRoute,
    projectNewRoute,
    projectJoinRoute,
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
      projectSettingsRoute,
      projectSettingsTeamRoute,
      projectSettingsSectionRoute,
    ]),
    projectsPersonalAccountRoute,
    projectsPersonalAppearanceRoute,
    projectsPersonalDevAppsRoute,
    projectsPersonalOrganizationsRoute,
    projectsPersonalToolingRoute,
    projectsPersonalComputerUseRoute,
    projectsPersonalGitHubRoute,
  ]),
  personalAccountRoute,
  personalAppearanceRoute,
  personalDevAppsRoute,
  personalOrganizationsRoute,
  personalToolingRoute,
  personalComputerUseRoute,
  personalGitHubRoute,
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
  interface StaticDataRouteOption {
    retainPage?: boolean;
  }
}

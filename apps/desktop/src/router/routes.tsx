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
const ProjectSettingsPage = createLazyRouteComponent(
  () =>
    import("@/features/settings/pages/ProjectSettingsPage").then((module) => ({
      default: module.ProjectSettingsPage,
    })),
  "routeLoading.projectSettings",
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


const projectRoute = createRoute({
  getParentRoute: () => projectsShellRoute,
  path: "/p/$projectId",
  component: Outlet,
});




const projectWorkbenchRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/workbench",
  component: ProjectWorkbenchPage,
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
  component: ProjectSettingsPage,
  staticData: RETAINED_PAGE,
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









export const routeTree = rootRoute.addChildren([
  indexRoute,
  joinProjectRoute,
  projectsShellRoute.addChildren([
    projectsIndexRoute,
    projectsStoreRoute,
    projectsAgentSkillsRoute,
    projectsInboxRoute,
    projectNewRoute,
    projectJoinRoute,
    projectRoute.addChildren([
      projectWorkbenchRoute,
      projectTasksRoute,
      projectTeamRoute,
      projectSettingsRoute,
    ]),
    projectsPersonalAccountRoute,
    projectsPersonalAppearanceRoute,
    projectsPersonalDevAppsRoute,
    projectsPersonalOrganizationsRoute,
    projectsPersonalToolingRoute,
    projectsPersonalComputerUseRoute,
    projectsPersonalGitHubRoute,
  ]),
]);

export const appRouter = createRouter({
  routeTree,
  defaultErrorComponent: AppErrorScreen,
  // Old URLs are not kept alive as redirect routes. Anything that no longer
  // matches — a route restored from an older build, a stale deep link — lands
  // on Projects instead of an empty shell.
  defaultNotFoundComponent: () => <Navigate to="/projects" replace />,
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

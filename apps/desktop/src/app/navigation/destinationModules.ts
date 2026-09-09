/** Leaf module loaders shared by route rendering and speculative navigation warming. */
export const destinationModules = {
  projects: () => import("@/features/projects/pages/ProjectsLaunchPage"),
  workbench: () => import("@/features/projects/pages/ProjectWorkbenchPage"),
  store: () => import("@/features/devapps/pages/AppStorePage"),
  skills: () => import("@/features/projects/pages/AgentSkillsPage"),
  inbox: () => import("@/features/inbox/pages/InboxPage"),
  tasks: () => import("@/features/tasks/pages/TasksPage"),
  newProject: () => import("@/pages/NewProject"),
} as const

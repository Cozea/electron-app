import type { DevAppLauncherGroup, DevAppManifest } from "@/features/devapps/registry/types";

export type WorkbenchSelectionCategory =
  | "All"
  | "Your org"
  | DevAppLauncherGroup
  | "Explore DevApps Store";

const BASE_CATEGORIES: WorkbenchSelectionCategory[] = [
  "All",
  "Development",
  "Assistant",
  "Explore DevApps Store",
];

export function getWorkbenchSelectionCategories(
  hasOrgDevApps: boolean,
): WorkbenchSelectionCategory[] {
  if (!hasOrgDevApps) {
    return BASE_CATEGORIES;
  }

  return ["All", "Your org", ...BASE_CATEGORIES.slice(1)];
}

export function resolveWorkbenchSelectionCategory(
  category: WorkbenchSelectionCategory,
  hasOrgDevApps: boolean,
): WorkbenchSelectionCategory {
  return category === "Your org" && !hasOrgDevApps ? "All" : category;
}

export function filterWorkbenchSelectionApps(
  apps: DevAppManifest[],
  category: WorkbenchSelectionCategory,
): DevAppManifest[] {
  if (category === "Your org") {
    return apps.filter((app) => app.launch.kind === "publishedDevApp");
  }

  if (category === "Development" || category === "Assistant") {
    return apps.filter((app) => app.launcher.group === category);
  }

  return apps;
}

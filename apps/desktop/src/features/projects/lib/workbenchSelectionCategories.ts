import type { DevAppLauncherGroup, DevAppManifest } from "@/features/devapps/registry/types";

export type WorkbenchSelectionCategory =
  | "All"
  | "Local"
  | DevAppLauncherGroup
  | "Explore DevApps Store";

const BASE_CATEGORIES: WorkbenchSelectionCategory[] = [
  "All",
  "Development",
  "Assistant",
  "Explore DevApps Store",
];

export function getWorkbenchSelectionCategories(
  hasLocalDevApps: boolean,
): WorkbenchSelectionCategory[] {
  if (!hasLocalDevApps) {
    return BASE_CATEGORIES;
  }

  return ["All", "Local", ...BASE_CATEGORIES.slice(1)];
}

export function resolveWorkbenchSelectionCategory(
  category: WorkbenchSelectionCategory,
  hasLocalDevApps: boolean,
): WorkbenchSelectionCategory {
  return category === "Local" && !hasLocalDevApps ? "All" : category;
}

export function filterWorkbenchSelectionApps(
  apps: DevAppManifest[],
  category: WorkbenchSelectionCategory,
): DevAppManifest[] {
  if (category === "Local") {
    return apps.filter((app) => app.launch.kind === "projectDevApp");
  }

  if (category === "Development" || category === "Assistant") {
    return apps.filter((app) => app.launcher.group === category);
  }

  return apps;
}

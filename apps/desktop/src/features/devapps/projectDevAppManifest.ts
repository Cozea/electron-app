import iconSrc from "@/features/devapps/apps/dev-server/icon.png";
import type { AccessibleProjectDevApp } from "@/features/devapps/projectDevAppApi";
import { isProjectDevAppLogoDataUrl } from "@/features/devapps/projectDevAppLogo";
import { partsForLaunchSpec } from "@/features/devapps/registry/parts";
import type { DevAppManifest, ProjectDevAppLaunchSpec } from "@/features/devapps/registry/types";

export interface ProjectDevAppRuntimeLocation {
  workspaceId: string;
  laneId: string;
}

export function buildProjectDevAppId(publicationId: string): string {
  return `project-devapp:${publicationId}`;
}

export function buildProjectDevAppLaunchSpec(
  entry: AccessibleProjectDevApp,
  runtimeLocation?: ProjectDevAppRuntimeLocation | null,
): ProjectDevAppLaunchSpec {
  return {
    kind: "projectDevApp",
    tileType: "devServer",
    singleton: true,
    publicationId: entry.publication._id,
    releaseId: entry.activeRelease._id,
    releaseVersion: entry.activeRelease.version,
    projectId: String(entry.sourceProject._id),
    ...(runtimeLocation
      ? {
          sourceWorkspaceId: runtimeLocation.workspaceId,
          sourceLaneId: runtimeLocation.laneId,
        }
      : {}),
    name: entry.publication.name,
    framework: entry.activeRelease.framework,
    devCommand: entry.activeRelease.devCommand,
    ...(entry.activeRelease.devPort ? { devPort: entry.activeRelease.devPort } : {}),
  };
}

export function buildProjectDevAppManifest(
  entry: AccessibleProjectDevApp,
  runtimeLocation?: ProjectDevAppRuntimeLocation | null,
): DevAppManifest {
  const projectName = entry.sourceProject.name.trim() || entry.publication.name;
  const logoDataUrl = isProjectDevAppLogoDataUrl(entry.logoDataUrl) ? entry.logoDataUrl : null;
  const description =
    entry.publication.description?.trim() ||
    entry.sourceProject.description?.trim() ||
    `Local DevApp launched from ${projectName}.`;
  const launch = buildProjectDevAppLaunchSpec(entry, runtimeLocation);

  return {
    id: buildProjectDevAppId(entry.publication._id),
    name: entry.publication.name,
    description,
    categories: ["discover", "build-release"],
    icon: {
      src: logoDataUrl ?? iconSrc,
      alt: `${entry.publication.name} DevApp`,
      ...(logoDataUrl ? {} : { className: "scale-[1.25]" }),
    },
    launcher: {
      enabled: true,
      order: 5,
      group: "Development",
      searchTerms: [
        "local",
        "this mac",
        "project",
        "devapp",
        projectName,
        entry.activeRelease.framework,
      ],
    },
    store: {
      categoryLabel: "Local project",
      accentClassName: "from-emerald-500/18 via-teal-500/8 to-transparent",
      badgeLabel: "This Mac",
      featured: true,
    },
    parts: partsForLaunchSpec(launch),
    launch,
  };
}

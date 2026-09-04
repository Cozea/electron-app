import type { DevAppInstallationV3, DevAppInstalledReleaseV3 } from "@shared/devAppInstallationV3";
import type {
  DevAppReleaseManifestV1,
  DevAppReleaseServiceV1,
  DevAppSurfaceContributionV3,
} from "@shared/devAppManifestV3";
import type { DevAppParts, DevAppStateScope as LegacyDevAppStateScope } from "@shared/devAppParts";

import type {
  DevAppCategoryId,
  DevAppLauncherGroup,
  DevAppManifest,
  InstalledDevAppLaunchSpec,
} from "@/features/devapps/registry/types";

function activeRelease(installation: DevAppInstallationV3): DevAppInstalledReleaseV3 {
  const release = installation.releases.find(
    (candidate) => candidate.releaseId === installation.activeReleaseId,
  );
  if (!release) throw new Error(`DevApp ${installation.appId} has no active installed release.`);
  return release;
}

function stateScopeForParts(state: DevAppReleaseServiceV1["state"]): LegacyDevAppStateScope {
  if (state === "organization") return "organization";
  if (state === "none") return "none";
  return "device";
}

function partsForInstalledRelease(release: DevAppReleaseManifestV1): DevAppParts {
  const service = Object.values(release.services ?? {})[0];
  const capabilities = [...release.permissions.required, ...release.permissions.optional];
  return {
    view: { source: "package" },
    ...(release.extension
      ? {
          worker: {
            capabilities,
            protocolVersion: 1,
          },
        }
      : {}),
    ...(service
      ? {
          service: { runtimeKind: "node" as const, network: true },
          runtime: {
            kind: "container" as const,
            location: service.location,
            state: stateScopeForParts(service.state),
          },
        }
      : {}),
  };
}

function fallbackIcon(name: string, appId: string): string {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "D";
  let hue = 0;
  for (const character of appId) hue = (hue * 31 + character.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="hsl(${hue} 58% 45%)"/><text x="32" y="39" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="white">${initials.replace(/[<>&"']/g, "")}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function launcherGroup(surface: DevAppSurfaceContributionV3): DevAppLauncherGroup {
  return surface.placement?.group === "Assistant" ? "Assistant" : "Development";
}

function categoriesFor(group: DevAppLauncherGroup): DevAppCategoryId[] {
  return group === "Assistant" ? ["discover", "agent-kits"] : ["discover", "preview-tools"];
}

function sourceLabel(installation: DevAppInstallationV3): string {
  switch (installation.source.kind) {
    case "system":
      return "System";
    case "organization":
      return "Organization";
    case "development":
      return "Local";
  }
}

export function buildInstalledDevAppManifest(
  installation: DevAppInstallationV3,
  surface: DevAppSurfaceContributionV3,
  order = 0,
): DevAppManifest {
  const release = activeRelease(installation);
  const group = launcherGroup(surface);
  const launch: InstalledDevAppLaunchSpec = {
    kind: "installedDevApp",
    tileType: "devApp",
    singleton: surface.singleton === true,
    installationId: installation.installationId,
    releaseId: release.releaseId,
    appId: installation.appId,
    appVersion: release.appVersion,
    surfaceId: surface.id,
    name: surface.title,
  };
  return {
    id: `installed-devapp:${installation.installationId}:${surface.id}`,
    name:
      release.manifest.contributes.surfaces.length === 1
        ? installation.name
        : `${installation.name} · ${surface.title}`,
    description: surface.description ?? installation.description ?? "Installed Cozea DevApp",
    categories: categoriesFor(group),
    icon: {
      src: fallbackIcon(installation.name, installation.appId),
      alt: installation.name,
      className: "scale-100",
    },
    launcher: {
      enabled: true,
      order: 5_000 + order,
      group,
      searchTerms: [
        installation.appId,
        installation.name,
        surface.title,
        sourceLabel(installation),
      ],
    },
    store: {
      categoryLabel: sourceLabel(installation),
      accentClassName: "bg-muted text-foreground",
      badgeLabel: `v${release.appVersion}`,
    },
    parts: partsForInstalledRelease(release.manifest),
    launch,
  };
}

export function buildInstalledDevAppManifests(
  installations: ReadonlyArray<DevAppInstallationV3>,
): DevAppManifest[] {
  return installations.flatMap((installation, installationIndex) => {
    const release = activeRelease(installation);
    return release.manifest.contributes.surfaces.map((surface, surfaceIndex) =>
      buildInstalledDevAppManifest(installation, surface, installationIndex * 100 + surfaceIndex),
    );
  });
}

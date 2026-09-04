import devAppIcon from "@/features/devapps/apps/dev-server/icon.png";
import type {
  DevAppManifest,
  DevelopmentDevAppLaunchSpec,
} from "@/features/devapps/registry/types";
import { partsForPackage } from "@/features/devapps/registry/parts";
import type { DevAppDevelopmentSource } from "@shared/devAppAuthoringTypes";

export function buildDevelopmentDevAppLaunchSpec(
  source: DevAppDevelopmentSource,
): DevelopmentDevAppLaunchSpec {
  return {
    kind: "developmentDevApp",
    tileType: "devAppPreview",
    ref: source.ref,
    sourceId: source.sourceId,
    projectId: source.projectId,
    workspaceId: source.workspaceId,
    relativePath: source.relativePath,
    name: source.name,
  };
}

export function buildDevelopmentDevAppManifest(source: DevAppDevelopmentSource): DevAppManifest {
  return {
    id: `development-devapp:${source.sourceId}`,
    name: source.name,
    description: source.description ?? "Local native DevApp development package.",
    categories: ["preview-tools", "build-release"],
    icon: {
      src: devAppIcon,
      alt: `${source.name} development preview`,
      className: "scale-[1.25]",
    },
    launcher: {
      enabled: true,
      order: 3,
      group: "Development",
      searchTerms: ["local", "development", "devapp", "test", source.ref],
    },
    store: {
      categoryLabel: "Local development",
      accentClassName: "from-cyan-500/18 via-sky-500/8 to-transparent",
      badgeLabel: "Development",
    },
    parts: partsForPackage(source.manifest),
    launch: buildDevelopmentDevAppLaunchSpec(source),
  };
}

import devAppIcon from "@/features/devapps/apps/dev-server/icon.png";
import type {
  DevAppManifest,
  DevelopmentDevAppLaunchSpec,
} from "@/features/devapps/registry/types";
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
    icon: { src: devAppIcon, alt: `${source.name} development preview` },
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
    parts: {
      ...(source.manifest.view ? { view: { source: "package" as const } } : {}),
      ...(source.manifest.worker
        ? {
            worker: {
              capabilities: source.manifest.worker.capabilities,
              protocolVersion: source.manifest.worker.protocolVersion,
              tools: source.manifest.worker.tools,
            },
          }
        : {}),
      ...(source.manifest.service
        ? {
            service: {
              runtimeKind: source.manifest.service.runtimeKind,
              location: "device" as const,
            },
          }
        : {}),
    },
    launch: buildDevelopmentDevAppLaunchSpec(source),
  };
}

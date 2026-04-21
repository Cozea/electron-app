import type { VersionControlSetupMode } from "@shared/versionControl"

type RepositoryLike = {
  provider?: string | null
  url?: string | null
  defaultBranch?: string | null
}

type SourceControlLike = {
  provider?: string | null
  repoUrl?: string | null
  defaultBranch?: string | null
  setupMode?: VersionControlSetupMode | null
  workingCopyMode?: "managed" | "attached" | null
}

type ProjectRepositoryIntegrationProjectLike = {
  gitRepository?: RepositoryLike | null
  sourceControl?: SourceControlLike | null
}

export interface ProjectRepositoryIntegration {
  provider: "github" | "local"
  repoUrl: string
  defaultBranch: string
  setupMode: VersionControlSetupMode | null
  workingCopyMode: "managed" | "attached"
  hasRepository: boolean
}

function normalizeProvider(
  value: string | null | undefined,
): "github" | "local" {
  return value?.trim().toLowerCase() === "github" ? "github" : "local"
}

export function resolveProjectSharedBranch(
  project: ProjectRepositoryIntegrationProjectLike | null | undefined,
): string {
  return (
    project?.sourceControl?.defaultBranch?.trim() ||
    project?.gitRepository?.defaultBranch?.trim() ||
    "main"
  )
}

export function resolveProjectRepositoryIntegration(
  project: ProjectRepositoryIntegrationProjectLike | null | undefined,
): ProjectRepositoryIntegration {
  const provider = normalizeProvider(
    project?.sourceControl?.provider ?? project?.gitRepository?.provider,
  )
  const repoUrl =
    project?.sourceControl?.repoUrl?.trim() ||
    project?.gitRepository?.url?.trim() ||
    ""

  return {
    provider,
    repoUrl,
    defaultBranch: resolveProjectSharedBranch(project),
    setupMode: project?.sourceControl?.setupMode ?? null,
    workingCopyMode:
      project?.sourceControl?.workingCopyMode === "attached"
        ? "attached"
        : "managed",
    hasRepository: provider !== "local" && Boolean(repoUrl),
  }
}

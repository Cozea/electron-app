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

type CanonicalRepoLike = {
  provider?: string | null
  url?: string | null
  defaultBranch?: string | null
  setupMode?: VersionControlSetupMode | null
  workingCopyMode?: "managed" | "attached" | null
}

type ProjectRepositoryIntegrationProjectLike = {
  /** Canonical descriptor; preferred over the legacy pair below. */
  repo?: CanonicalRepoLike | null
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

/** Last-resort shared branch for display, when nothing records a real one. */
export const FALLBACK_SHARED_BRANCH = "main"

/**
 * The default branch the project actually *records*, or null when nothing does.
 *
 * Lane ids are the comparison `activeBranch === collabBranch`, so this operand
 * must never be guessed. A local-only project records no default branch, and
 * answering "main" for a repo that is really on `master` makes the two operands
 * differ forever: the workbench scope key flips to a branch lane and strands
 * every open tile under the previous key. Callers that only need a label may
 * fall back via `resolveProjectSharedBranch`; callers that build a lane id must
 * treat null as "learn it from the repo" instead.
 */
export function resolveProjectRecordedDefaultBranch(
  project: ProjectRepositoryIntegrationProjectLike | null | undefined,
): string | null {
  return (
    project?.repo?.defaultBranch?.trim() ||
    project?.sourceControl?.defaultBranch?.trim() ||
    project?.gitRepository?.defaultBranch?.trim() ||
    null
  )
}

export function resolveProjectSharedBranch(
  project: ProjectRepositoryIntegrationProjectLike | null | undefined,
): string {
  return resolveProjectRecordedDefaultBranch(project) ?? FALLBACK_SHARED_BRANCH
}

export function resolveProjectRepositoryIntegration(
  project: ProjectRepositoryIntegrationProjectLike | null | undefined,
): ProjectRepositoryIntegration {
  const provider = normalizeProvider(
    project?.repo?.provider ??
      project?.sourceControl?.provider ??
      project?.gitRepository?.provider,
  )
  const repoUrl =
    project?.repo?.url?.trim() ||
    project?.sourceControl?.repoUrl?.trim() ||
    project?.gitRepository?.url?.trim() ||
    ""

  return {
    provider,
    repoUrl,
    defaultBranch: resolveProjectSharedBranch(project),
    setupMode: project?.repo?.setupMode ?? project?.sourceControl?.setupMode ?? null,
    workingCopyMode:
      (project?.repo?.workingCopyMode ?? project?.sourceControl?.workingCopyMode) === "attached"
        ? "attached"
        : "managed",
    hasRepository: provider !== "local" && Boolean(repoUrl),
  }
}

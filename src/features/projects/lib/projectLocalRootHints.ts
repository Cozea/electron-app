import type { ProjectOpenGitProjectLike } from "@/features/projects/lib/projectOpenTypes"

function normalizeLocalPathHint(projectPath: string | null | undefined): string | null {
  if (typeof projectPath !== "string") {
    return null
  }

  const trimmedPath = projectPath.trim()
  return trimmedPath.length > 0 ? trimmedPath : null
}

export function resolveAttachedLocalProjectPathHint(
  project: Pick<ProjectOpenGitProjectLike, "importedFrom"> | null | undefined,
): string | null {
  if (project?.importedFrom?.provider !== "local") {
    return null
  }

  return normalizeLocalPathHint(project.importedFrom.repoFullName)
}

export function buildProjectLocalPathLookupOptions(args: {
  project: Pick<ProjectOpenGitProjectLike, "_id" | "slug" | "localPath" | "importedFrom">
  localPathHint?: string | null
}) {
  return {
    slug: args.project.slug,
    projectId: String(args.project._id),
    localPathHint:
      normalizeLocalPathHint(args.localPathHint) ??
      normalizeLocalPathHint(args.project.localPath) ??
      null,
    attachedPathHint: resolveAttachedLocalProjectPathHint(args.project),
  }
}

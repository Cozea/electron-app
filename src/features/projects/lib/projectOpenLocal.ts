import type { Id } from "../../../../convex/_generated/dataModel"
import { buildFilesystemSlug } from "@/features/projects/lib/localProjectImport"
import { projectOpenDesktopClient } from "@/features/projects/lib/projectOpenDesktopClient"
import { buildProjectLocalPathLookupOptions } from "@/features/projects/lib/projectLocalRootHints"
import type { ProjectOpenGitProjectLike } from "@/features/projects/lib/projectOpenTypes"

async function mirrorProjectPath(args: {
  projectId: string
  projectPath: string
  userId?: Id<"users"> | null
  updateMemberLocalPath?: (args: {
    projectId: Id<"projects">
    userId: Id<"users">
    localPath: string
  }) => Promise<unknown>
}): Promise<void> {
  const localPathResult = await projectOpenDesktopClient.rememberLocalPath({
    projectId: args.projectId,
    projectPath: args.projectPath,
  })

  if (!localPathResult.success) {
    console.warn("[ProjectOpenLocal] Failed to persist project path:", localPathResult.error)
  }

  if (!args.userId || !args.updateMemberLocalPath) {
    return
  }

  try {
    await args.updateMemberLocalPath({
      projectId: args.projectId as Id<"projects">,
      userId: args.userId,
      localPath: args.projectPath,
    })
  } catch (error) {
    console.warn("[ProjectOpenLocal] Failed to mirror local project path:", error)
  }
}

export async function rememberLocalProjectPath(args: {
  projectId: string
  projectPath: string
  userId?: Id<"users"> | null
  updateMemberLocalPath?: (args: {
    projectId: Id<"projects">
    userId: Id<"users">
    localPath: string
  }) => Promise<unknown>
}): Promise<void> {
  await mirrorProjectPath(args)
}

export async function clearRememberedLocalProjectPath(args: {
  projectId: string
}): Promise<void> {
  const result = await projectOpenDesktopClient.clearLocalPath({
    projectId: args.projectId,
  })

  if (!result.success) {
    console.warn("[ProjectOpenLocal] Failed to clear local project path")
  }
}

export async function prepareLocalProjectForOpen(args: {
  project: ProjectOpenGitProjectLike
  localPath: string | null
  userId?: Id<"users"> | null
  updateMemberLocalPath?: (args: {
    projectId: Id<"projects">
    userId: Id<"users">
    localPath: string
  }) => Promise<unknown>
}): Promise<{ localPath: string; created: boolean }> {
  const existingPath =
    args.localPath ??
    (await projectOpenDesktopClient.getLocalPath(
      buildProjectLocalPathLookupOptions({
        project: args.project,
        localPathHint: args.localPath,
      }),
    ))

  if (existingPath) {
    await mirrorProjectPath({
      projectId: String(args.project._id),
      projectPath: existingPath,
      userId: args.userId,
      updateMemberLocalPath: args.updateMemberLocalPath,
    })
    return { localPath: existingPath, created: false }
  }

  const settings = await projectOpenDesktopClient.getSettings()
  const createFolderResult = await projectOpenDesktopClient.createFolder({
    slug: buildFilesystemSlug(args.project.slug || args.project.name || "project"),
    initGit: false,
    projectId: String(args.project._id),
    baseDirectory: settings.projectsDirectory,
  })

  if (!createFolderResult.success || !createFolderResult.localPath) {
    throw new Error(createFolderResult.error || "Failed to prepare a local project folder.")
  }

  await mirrorProjectPath({
    projectId: String(args.project._id),
    projectPath: createFolderResult.localPath,
    userId: args.userId,
    updateMemberLocalPath: args.updateMemberLocalPath,
  })

  return {
    localPath: createFolderResult.localPath,
    created: true,
  }
}

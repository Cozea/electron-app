import { ConvexError } from "convex/values"
import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { canAccessProject, canEditProject } from "./lib/projectAccess"
import {
  applyProjectStorageDeltas,
  getProjectStorageAccountingState,
} from "./lib/workspaceLimits"

/** Membership gate: reading project files requires project access. */
async function requireProjectAccess(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  projectId: Id<"projects">,
  userId: Id<"users">,
): Promise<void> {
  if (!(await canAccessProject(ctx, projectId, userId))) {
    throw new ConvexError("You do not have access to this project")
  }
}

/** Membership gate: mutating project files requires non-viewer access. */
async function requireProjectEdit(
  ctx: Pick<MutationCtx, "db">,
  projectId: Id<"projects">,
  userId: Id<"users">,
): Promise<void> {
  if (!(await canEditProject(ctx, projectId, userId))) {
    throw new ConvexError("You do not have permission to modify this project's files")
  }
}

// Generate upload URL for a project file
export const generateUploadUrl = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireProjectEdit(ctx, args.projectId, args.userId)
    return await ctx.storage.generateUploadUrl()
  },
})

// Get download URL for a file by storage ID
export const getFileUrl = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, args.userId)
    return await ctx.storage.getUrl(args.storageId)
  },
})

// Save uploaded file reference
export const saveFile = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    filePath: v.string(),
    fileType: v.string(),
    sizeBytes: v.number(),
    checksum: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectEdit(ctx, args.projectId, args.userId)
    const now = Date.now()

    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")
    const storageAccounting = await getProjectStorageAccountingState(ctx, args.projectId)
    let sourceAndConfigDelta = 0
    let gitHistoryDelta = 0

    // Check if file already exists at this path
    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", args.filePath)
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .first()

    // Mark existing as superseded
    if (existing) {
      await ctx.db.patch(existing._id, { status: "superseded" })
      if (!storageAccounting.usesGitRepoAccounting) {
        sourceAndConfigDelta -= existing.sizeBytes
        gitHistoryDelta += existing.sizeBytes
      }
    }

    // Insert new file record
    const fileId = await ctx.db.insert("projectFiles", {
      projectId: args.projectId,
      fileName: args.fileName,
      filePath: args.filePath,
      fileType: args.fileType,
      storageId: args.storageId,
      sizeBytes: args.sizeBytes,
      checksum: args.checksum,
      version: existing ? existing.version + 1 : 1,
      previousVersionId: existing?._id,
      uploadedBy: args.userId,
      uploadedAt: now,
      status: "active",
    })

    if (!storageAccounting.usesGitRepoAccounting) {
      sourceAndConfigDelta += args.sizeBytes
    }

    await applyProjectStorageDeltas(ctx, args.projectId, {
      sourceAndConfig: sourceAndConfigDelta,
      gitHistory: gitHistoryDelta,
    })

    return { fileId }
  },
})

// List all active files for a project
export const listForProject = query({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, args.userId)
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "active")
      )
      .collect()

    // Get download URLs for each file
    return Promise.all(
      files.map(async (file) => ({
        ...file,
        url: await ctx.storage.getUrl(file.storageId),
      }))
    )
  },
})

// Get download URL for a specific file
export const getDownloadUrl = query({
  args: { fileId: v.id("projectFiles"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId)
    if (!file) throw new Error("File not found")
    await requireProjectAccess(ctx, file.projectId, args.userId)

    const url = await ctx.storage.getUrl(file.storageId)
    return { file, url }
  },
})

// Delete a file (soft delete)
export const deleteFile = mutation({
  args: {
    fileId: v.id("projectFiles"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId)
    if (!file) throw new Error("File not found")
    await requireProjectEdit(ctx, file.projectId, args.userId)
    const project = await ctx.db.get(file.projectId)
    if (!project) throw new Error("Project not found")
    const storageAccounting = await getProjectStorageAccountingState(ctx, file.projectId)

    let sourceAndConfigDelta = 0
    let gitHistoryDelta = 0
    if (!storageAccounting.usesGitRepoAccounting) {
      if (file.status === "active") {
        sourceAndConfigDelta -= file.sizeBytes
      } else if (file.status === "superseded") {
        gitHistoryDelta -= file.sizeBytes
      }
    }

    await ctx.db.patch(args.fileId, { status: "deleted" })

    // Optionally delete from storage (or keep for recovery)
    // await ctx.storage.delete(file.storageId)

    await applyProjectStorageDeltas(ctx, file.projectId, {
      sourceAndConfig: sourceAndConfigDelta,
      gitHistory: gitHistoryDelta,
    })

    return { success: true }
  },
})

// Get file count for a project
export const getFileCount = query({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, args.userId)
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "active")
      )
      .collect()

    return files.length
  },
})

// ============================================
// SYNC-SPECIFIC FUNCTIONS
// ============================================

// Get manifest of all active files for sync comparison
export const getManifestForProject = query({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, args.userId)
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "active")
      )
      .collect()

    return files.map((file) => ({
      _id: file._id,
      path: file.filePath,
      hash: file.checksum || "",
      size: file.sizeBytes,
      version: file.version,
      storageId: file.storageId,
      uploadedAt: file.uploadedAt,
    }))
  },
})

// Batch save multiple files (more efficient for sync)
export const saveFiles = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    files: v.array(
      v.object({
        storageId: v.id("_storage"),
        fileName: v.string(),
        filePath: v.string(),
        fileType: v.string(),
        sizeBytes: v.number(),
        checksum: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireProjectEdit(ctx, args.projectId, args.userId)
    const now = Date.now()
    const results: Array<{ path: string; fileId: string }> = []

    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")
    const storageAccounting = await getProjectStorageAccountingState(ctx, args.projectId)
    let sourceAndConfigDelta = 0
    let gitHistoryDelta = 0

    for (const file of args.files) {
      // Check if file already exists at this path
      const existing = await ctx.db
        .query("projectFiles")
        .withIndex("by_project_and_path", (q) =>
          q.eq("projectId", args.projectId).eq("filePath", file.filePath)
        )
        .filter((q) => q.eq(q.field("status"), "active"))
        .first()

      // If existing file has same checksum, skip
      if (existing && existing.checksum === file.checksum) {
        results.push({ path: file.filePath, fileId: existing._id })
        continue
      }

      // Mark existing as superseded if hash differs
      if (existing && existing.checksum !== file.checksum) {
        await ctx.db.patch(existing._id, { status: "superseded" })
        if (!storageAccounting.usesGitRepoAccounting) {
          sourceAndConfigDelta -= existing.sizeBytes
          gitHistoryDelta += existing.sizeBytes
        }
      }

      // Insert new file record
      const fileId = await ctx.db.insert("projectFiles", {
        projectId: args.projectId,
        fileName: file.fileName,
        filePath: file.filePath,
        fileType: file.fileType,
        storageId: file.storageId,
        sizeBytes: file.sizeBytes,
        checksum: file.checksum,
        version: existing ? existing.version + 1 : 1,
        previousVersionId: existing?._id,
        uploadedBy: args.userId,
        uploadedAt: now,
        status: "active",
      })

      results.push({ path: file.filePath, fileId })

      if (!storageAccounting.usesGitRepoAccounting) {
        sourceAndConfigDelta += file.sizeBytes
      }
    }

    await applyProjectStorageDeltas(ctx, args.projectId, {
      sourceAndConfig: sourceAndConfigDelta,
      gitHistory: gitHistoryDelta,
    })

    return { results, savedCount: results.length }
  },
})

// Save file content directly (for Yjs persistence - no storage upload)
// This updates the checksum/mtime when content changes via Yjs
export const saveFileContent = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    path: v.string(),
    content: v.string(),
    checksum: v.string(),
    mtime: v.number(),
  },
  handler: async (ctx, args) => {
    await requireProjectEdit(ctx, args.projectId, args.userId)
    // Find existing file at this path
    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", args.path)
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .first()

    if (!existing) {
      // File doesn't exist in projectFiles yet - this can happen
      // if Yjs has the file but it wasn't synced to projectFiles
      // For now, just log and skip (the sync will catch it)
      console.log(`[saveFileContent] File not found: ${args.path}`)
      return { updated: false, reason: "file_not_found" }
    }

    // Check if checksum actually changed
    if (existing.checksum === args.checksum) {
      return { updated: false, reason: "unchanged" }
    }

    // Update the existing file record with new checksum
    await ctx.db.patch(existing._id, {
      checksum: args.checksum,
      uploadedAt: args.mtime,
    })

    return { updated: true, fileId: existing._id }
  },
})

// Mark files as deleted (for sync deletions)
export const markFilesDeleted = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    filePaths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectEdit(ctx, args.projectId, args.userId)
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")
    const storageAccounting = await getProjectStorageAccountingState(ctx, args.projectId)
    let deletedCount = 0
    let sourceAndConfigDelta = 0
    const gitHistoryDelta = 0

    for (const filePath of args.filePaths) {
      const file = await ctx.db
        .query("projectFiles")
        .withIndex("by_project_and_path", (q) =>
          q.eq("projectId", args.projectId).eq("filePath", filePath)
        )
        .filter((q) => q.eq(q.field("status"), "active"))
        .first()

      if (file) {
        await ctx.db.patch(file._id, { status: "deleted" })
        deletedCount++
        if (!storageAccounting.usesGitRepoAccounting) {
          sourceAndConfigDelta -= file.sizeBytes
        }
      }
    }

    await applyProjectStorageDeltas(ctx, args.projectId, {
      sourceAndConfig: sourceAndConfigDelta,
      gitHistory: gitHistoryDelta,
    })

    return { deletedCount }
  },
})

import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

// Generate upload URL for a project file
export const generateUploadUrl = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    // Verify project exists
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    return await ctx.storage.generateUploadUrl()
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
    const now = Date.now()

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

    return { fileId }
  },
})

// List all active files for a project
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("status"), "active"))
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
  args: { fileId: v.id("projectFiles") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId)
    if (!file) throw new Error("File not found")

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

    await ctx.db.patch(args.fileId, { status: "deleted" })

    // Optionally delete from storage (or keep for recovery)
    // await ctx.storage.delete(file.storageId)

    return { success: true }
  },
})

// Get file count for a project
export const getFileCount = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect()

    return files.length
  },
})

// ============================================
// SYNC-SPECIFIC FUNCTIONS
// ============================================

// Get manifest of all active files for sync comparison
export const getManifestForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("status"), "active"))
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
    const now = Date.now()
    const results: Array<{ path: string; fileId: string }> = []

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
    }

    return { results, savedCount: results.length }
  },
})

// Save file content directly (for Yjs persistence - no storage upload)
// This updates the checksum/mtime when content changes via Yjs
export const saveFileContent = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    content: v.string(),
    checksum: v.string(),
    mtime: v.number(),
  },
  handler: async (ctx, args) => {
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
    filePaths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    let deletedCount = 0

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
      }
    }

    return { deletedCount }
  },
})

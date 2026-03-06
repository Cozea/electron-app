import type { MutationCtx } from "./_generated/server"
import { mutation, query } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { v } from "convex/values"
import { applyProjectStorageDeltas } from "./lib/workspaceLimits"

async function hasSiblingStorageReference(
  ctx: MutationCtx,
  assetId: string,
  projectId: Id<"projects">,
  storageId: string
): Promise<boolean> {
  const assets = await ctx.db
    .query("projectAssets")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect()

  return assets.some(
    (asset) => String(asset._id) !== assetId && String(asset.storageId) === storageId
  )
}

// Generate upload URL for an asset
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

// Create asset record after upload (or folder)
export const create = mutation({
  args: {
    projectId: v.id("projects"),
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    storageId: v.optional(v.id("_storage")), // Optional for folders
    name: v.string(),
    mimeType: v.string(),
    size: v.number(),
    folderPath: v.optional(v.string()),
    label: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    // Infer category from MIME type if not provided
    let category = args.category
    if (!category) {
      if (args.mimeType.startsWith("image/")) {
        category = "image"
      } else if (args.mimeType.startsWith("audio/")) {
        category = "audio"
      } else if (args.mimeType.startsWith("video/")) {
        category = "video"
      } else if (
        args.mimeType === "application/pdf" ||
        args.mimeType.includes("document") ||
        args.mimeType.includes("text/")
      ) {
        category = "document"
      } else {
        category = "other"
      }
    }

    const assetId = await ctx.db.insert("projectAssets", {
      projectId: args.projectId,
      organizationId: project.organizationId,
      name: args.name,
      storageId: args.storageId,
      mimeType: args.mimeType,
      size: args.size,
      folderPath: args.folderPath,
      label: args.label,
      description: args.description,
      category,
      tags: args.tags,
      uploadedBy: args.userId,
      uploadedAt: now,
    })

    if (args.storageId && args.mimeType !== "application/x-directory") {
      await applyProjectStorageDeltas(ctx, project.organizationId, args.projectId, {
        assets: Math.max(0, args.size),
      })
    }

    return { assetId }
  },
})

// Update asset metadata
export const update = mutation({
  args: {
    assetId: v.id("projectAssets"),
    name: v.optional(v.string()),
    folderPath: v.optional(v.string()),
    label: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    if (!asset) throw new Error("Asset not found")

    const updates: Record<string, unknown> = {}
    if (args.name !== undefined) updates.name = args.name
    if (args.folderPath !== undefined) updates.folderPath = args.folderPath
    if (args.label !== undefined) updates.label = args.label
    if (args.description !== undefined) updates.description = args.description
    if (args.category !== undefined) updates.category = args.category
    if (args.tags !== undefined) updates.tags = args.tags

    await ctx.db.patch(args.assetId, updates)

    return { success: true }
  },
})

// Delete asset and storage file
export const remove = mutation({
  args: {
    assetId: v.id("projectAssets"),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    if (!asset) throw new Error("Asset not found")

    const hasSiblingReference =
      asset.storageId && asset.mimeType !== "application/x-directory"
        ? await hasSiblingStorageReference(
            ctx,
            String(asset._id),
            asset.projectId,
            String(asset.storageId)
          )
        : false

    // Delete from storage (only if it's a real file, not a folder placeholder)
    if (asset.storageId && asset.mimeType !== "application/x-directory" && !hasSiblingReference) {
      try {
        await ctx.storage.delete(asset.storageId)
      } catch (e) {
        // Storage file may already be deleted
        console.warn("Could not delete storage file:", e)
      }
    }

    // Delete the record
    await ctx.db.delete(args.assetId)

    if (asset.storageId && asset.mimeType !== "application/x-directory" && !hasSiblingReference) {
      await applyProjectStorageDeltas(ctx, asset.organizationId, asset.projectId, {
        assets: -Math.max(0, asset.size),
      })
    }

    return { success: true }
  },
})

// List all assets for a project
export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const assetsQuery = ctx.db
      .query("projectAssets")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))

    const assets = await assetsQuery.collect()

    // Filter by category if provided
    const filtered = args.category
      ? assets.filter((a) => a.category === args.category)
      : assets

    // Get download URLs for each asset (skip for folders and assets without storageId)
    return Promise.all(
      filtered.map(async (asset) => ({
        ...asset,
        url: asset.mimeType === "application/x-directory" || !asset.storageId
          ? null
          : await ctx.storage.getUrl(asset.storageId),
      }))
    )
  },
})

// Get single asset by ID
export const getById = query({
  args: {
    assetId: v.id("projectAssets"),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    if (!asset) return null

    const url = asset.storageId ? await ctx.storage.getUrl(asset.storageId) : null
    return { ...asset, url }
  },
})

// Search assets by name
export const searchAssets = query({
  args: {
    projectId: v.id("projects"),
    searchQuery: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.searchQuery.trim()) {
      return []
    }

    // Use search index
    const results = await ctx.db
      .query("projectAssets")
      .withSearchIndex("search_assets", (q) =>
        q.search("name", args.searchQuery).eq("projectId", args.projectId)
      )
      .take(50)

    // Get download URLs (skip for folders/assets without storageId)
    return Promise.all(
      results.map(async (asset) => ({
        ...asset,
        url: asset.storageId ? await ctx.storage.getUrl(asset.storageId) : null,
      }))
    )
  },
})

// Get assets by category
export const getByCategory = query({
  args: {
    projectId: v.id("projects"),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("projectAssets")
      .withIndex("by_category", (q) =>
        q.eq("projectId", args.projectId).eq("category", args.category)
      )
      .collect()

    return Promise.all(
      assets.map(async (asset) => ({
        ...asset,
        url: asset.storageId ? await ctx.storage.getUrl(asset.storageId) : null,
      }))
    )
  },
})

// Get asset metadata formatted for AI context
export const getForAIContext = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("projectAssets")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()

    // Format for AI consumption - include URLs for reference
    return Promise.all(
      assets.map(async (asset) => ({
        name: asset.name,
        label: asset.label,
        description: asset.description,
        category: asset.category,
        mimeType: asset.mimeType,
        tags: asset.tags,
        aiAnalysis: asset.aiAnalysis,
        url: asset.storageId ? await ctx.storage.getUrl(asset.storageId) : null,
      }))
    )
  },
})

// Get asset count for a project
export const getAssetCount = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("projectAssets")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()

    return assets.length
  },
})

// Store AI analysis results for an asset
export const saveAIAnalysis = mutation({
  args: {
    assetId: v.id("projectAssets"),
    aiAnalysis: v.object({
      summary: v.string(),
      detectedContent: v.optional(v.array(v.string())),
      suggestedTags: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    if (!asset) throw new Error("Asset not found")

    await ctx.db.patch(args.assetId, {
      aiAnalysis: args.aiAnalysis,
    })

    return { success: true }
  },
})

// Bulk move assets to a folder
export const bulkMove = mutation({
  args: {
    assetIds: v.array(v.id("projectAssets")),
    targetFolderPath: v.string(),
  },
  handler: async (ctx, args) => {
    const results = await Promise.all(
      args.assetIds.map(async (assetId) => {
        const asset = await ctx.db.get(assetId)
        if (!asset) return { assetId, success: false, error: "Not found" }

        await ctx.db.patch(assetId, {
          folderPath: args.targetFolderPath || undefined,
        })
        return { assetId, success: true }
      })
    )

    return { results, movedCount: results.filter((r) => r.success).length }
  },
})

// Bulk delete assets
export const bulkDelete = mutation({
  args: {
    assetIds: v.array(v.id("projectAssets")),
  },
  handler: async (ctx, args) => {
    const deletingIds = new Set(args.assetIds.map((assetId) => String(assetId)))
    const assets = await Promise.all(args.assetIds.map(async (assetId) => await ctx.db.get(assetId)))
    type AssetDoc = NonNullable<(typeof assets)[number]>
    const uniqueProjectIds = Array.from(
      new Set(assets.filter((asset) => asset).map((asset) => String(asset!.projectId)))
    )
    const projectAssets = new Map<string, AssetDoc[]>()
    for (const projectId of uniqueProjectIds) {
      const assetsForProject = await ctx.db
        .query("projectAssets")
        .withIndex("by_project", (q) => q.eq("projectId", projectId as Id<"projects">))
        .collect()
      projectAssets.set(projectId, assetsForProject)
    }

    const deletedStorageIds = new Set<string>()
    const results: Array<{
      assetId: Id<"projectAssets">
      success: boolean
      error?: string
      freedBytes: number
      projectId?: Id<"projects">
      organizationId?: Id<"organizations">
    }> = []

    for (let index = 0; index < args.assetIds.length; index += 1) {
      const assetId = args.assetIds[index]
      const asset = assets[index]
      if (!asset) {
        results.push({ assetId, success: false, error: "Not found", freedBytes: 0 })
        continue
      }

      const assetsForProject = projectAssets.get(String(asset.projectId)) ?? []
      const storageKey = asset.storageId ? String(asset.storageId) : null
      const hasRemainingReference =
        storageKey && asset.mimeType !== "application/x-directory"
          ? assetsForProject.some(
              (candidate) =>
                String(candidate._id) !== String(asset._id) &&
                !deletingIds.has(String(candidate._id)) &&
                String(candidate.storageId) === storageKey
            )
          : false

      const shouldDeleteUnderlyingStorage =
        !!storageKey &&
        asset.mimeType !== "application/x-directory" &&
        !hasRemainingReference &&
        !deletedStorageIds.has(storageKey)

      if (shouldDeleteUnderlyingStorage) {
        try {
          await ctx.storage.delete(asset.storageId!)
        } catch (e) {
          console.warn("Could not delete storage file:", e)
        }
        deletedStorageIds.add(storageKey)
      }

      await ctx.db.delete(assetId)
      results.push({
        assetId,
        success: true,
        freedBytes: shouldDeleteUnderlyingStorage ? Math.max(0, asset.size) : 0,
        projectId: asset.projectId,
        organizationId: asset.organizationId,
      })
    }

    const freedBytesByProject = new Map<string, {
      organizationId: Id<"organizations">
      projectId: Id<"projects">
      bytes: number
    }>()
    for (const result of results) {
      if (
        !result.success ||
        !result.organizationId ||
        !result.projectId ||
        result.freedBytes <= 0
      ) {
        continue
      }
      const key = String(result.projectId)
      const existing = freedBytesByProject.get(key)
      if (existing) {
        existing.bytes += result.freedBytes
      } else {
        freedBytesByProject.set(key, {
          organizationId: result.organizationId,
          projectId: result.projectId,
          bytes: result.freedBytes,
        })
      }
    }

    for (const entry of freedBytesByProject.values()) {
      await applyProjectStorageDeltas(ctx, entry.organizationId, entry.projectId, {
        assets: -entry.bytes,
      })
    }

    return { results, deletedCount: results.filter((r) => r.success).length }
  },
})

// Duplicate an asset
export const duplicate = mutation({
  args: {
    assetId: v.id("projectAssets"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    if (!asset) throw new Error("Asset not found")

    // Cannot duplicate folders
    if (asset.mimeType === "application/x-directory") {
      throw new Error("Cannot duplicate folders")
    }

    // Generate copy name
    const baseName = asset.name.replace(/\.[^/.]+$/, "")
    const ext = asset.name.includes(".") ? asset.name.split(".").pop() : ""
    const copyName = ext ? `${baseName} (copy).${ext}` : `${baseName} (copy)`

    const now = Date.now()
    const newAssetId = await ctx.db.insert("projectAssets", {
      projectId: asset.projectId,
      organizationId: asset.organizationId,
      name: copyName,
      storageId: asset.storageId, // Share the same storage file
      mimeType: asset.mimeType,
      size: asset.size,
      folderPath: asset.folderPath,
      label: asset.label,
      description: asset.description,
      category: asset.category,
      tags: asset.tags,
      uploadedBy: args.userId,
      uploadedAt: now,
    })

    return { assetId: newAssetId }
  },
})

// Get all folder paths for a project (for move dialog)
export const getAllFolders = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("projectAssets")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()

    // Extract unique folder paths
    const folderPaths = new Set<string>()
    folderPaths.add("") // Root

    assets.forEach((asset) => {
      if (asset.folderPath) {
        // Add this folder and all parent folders
        const parts = asset.folderPath.split("/").filter(Boolean)
        let path = ""
        parts.forEach((part) => {
          path = path ? `${path}/${part}` : `/${part}`
          folderPaths.add(path)
        })
      }
    })

    return Array.from(folderPaths).sort()
  },
})

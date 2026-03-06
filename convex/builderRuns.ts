import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import {
  applyStorageDeltas,
  estimateBuilderRunBytes,
} from "./lib/workspaceLimits"

const buildTaskValidator = v.object({
  content: v.string(),
  activeForm: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("in_progress"),
    v.literal("completed")
  ),
  files: v.optional(v.array(v.string())),
})

const runStatusValidator = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("interrupted")
)

export const startRun = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    runId: v.string(),
    attempt: v.number(),
    conversationId: v.optional(v.string()),
    localPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) {
      throw new Error("Project not found")
    }

    const now = Date.now()
    const builderRunId = await ctx.db.insert("builderRuns", {
      projectId: args.projectId,
      organizationId: project.organizationId,
      userId: args.userId,
      runId: args.runId,
      status: "running",
      attempt: args.attempt,
      conversationId: args.conversationId,
      localPath: args.localPath,
      createdAt: now,
      updatedAt: now,
    })

    await applyStorageDeltas(ctx, project.organizationId, {
      buildCache: estimateBuilderRunBytes({
        runId: args.runId,
        status: "running",
        attempt: args.attempt,
        conversationId: args.conversationId,
        localPath: args.localPath,
        createdAt: now,
        updatedAt: now,
      }),
    })

    return { builderRunId }
  },
})

export const checkpointRun = mutation({
  args: {
    projectId: v.id("projects"),
    runId: v.string(),
    tasks: v.optional(v.array(buildTaskValidator)),
    progress: v.optional(v.number()),
    statusMessage: v.optional(v.string()),
    logs: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("builderRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .first()

    if (!run) {
      throw new Error("Build run not found")
    }

    if (run.projectId !== args.projectId) {
      throw new Error("Run does not match project")
    }

    const project = await ctx.db.get(run.projectId)
    if (!project) {
      throw new Error("Project not found")
    }

    const now = Date.now()
    const previousBytes = estimateBuilderRunBytes(run)
    const nextRun = {
      ...run,
      tasks: args.tasks ?? run.tasks,
      progress: args.progress ?? run.progress,
      statusMessage: args.statusMessage ?? run.statusMessage,
      logs: args.logs ?? run.logs,
      updatedAt: now,
      lastCheckpointAt: now,
    }
    await ctx.db.patch(run._id, {
      tasks: nextRun.tasks,
      progress: nextRun.progress,
      statusMessage: nextRun.statusMessage,
      logs: nextRun.logs,
      updatedAt: nextRun.updatedAt,
      lastCheckpointAt: nextRun.lastCheckpointAt,
    })
    await applyStorageDeltas(ctx, project.organizationId, {
      buildCache: estimateBuilderRunBytes(nextRun) - previousBytes,
    })

    return { success: true }
  },
})

export const updateRunStatus = mutation({
  args: {
    projectId: v.id("projects"),
    runId: v.string(),
    status: runStatusValidator,
    statusMessage: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("builderRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .first()

    if (!run) {
      throw new Error("Build run not found")
    }

    if (run.projectId !== args.projectId) {
      throw new Error("Run does not match project")
    }

    const project = await ctx.db.get(run.projectId)
    if (!project) {
      throw new Error("Project not found")
    }

    const now = Date.now()
    const previousBytes = estimateBuilderRunBytes(run)
    const nextRun = {
      ...run,
      status: args.status,
      statusMessage: args.statusMessage ?? run.statusMessage,
      errorMessage: args.errorMessage,
      updatedAt: now,
    }
    await ctx.db.patch(run._id, {
      status: nextRun.status,
      statusMessage: nextRun.statusMessage,
      errorMessage: nextRun.errorMessage,
      updatedAt: nextRun.updatedAt,
    })
    await applyStorageDeltas(ctx, project.organizationId, {
      buildCache: estimateBuilderRunBytes(nextRun) - previousBytes,
    })

    return { success: true }
  },
})

export const getLatestForProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("builderRuns")
      .withIndex("by_project_and_updated", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first()
  },
})

export const getByRunId = query({
  args: {
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("builderRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .first()
  },
})

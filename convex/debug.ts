// @ts-nocheck
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

async function deleteRows(
  ctx: MutationCtx,
  rows: Array<{ _id: Id<any> }>,
) {
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return rows.length;
}

async function deleteRowsInBatches(
  ctx: MutationCtx,
  loadRows: () => Promise<Array<{ _id: Id<any> }>>,
) {
  let deleted = 0;

  while (true) {
    const rows = await loadRows();
    if (rows.length === 0) {
      break;
    }

    deleted += await deleteRows(ctx, rows);
  }

  return deleted;
}

export const ping = query({
  args: {},
  handler: async () => {
    return "pong";
  },
});

export const getProjectResetSummary = query({ args: { projectId: v.id("projects") }, handler: async () => ({}) });

async function deleteSingleProjectAndRelatedData(
  ctx: MutationCtx,
  projectId: Id<"projects">,
) {
  const project = await ctx.db.get(projectId);
  if (!project) {
    return {
      deletedProject: false,
      deletedRows: 0,
      deletedStorageObjects: 0,
      organizationId: null,
    };
  }

  let deletedRows = 0;
  let deletedStorageObjects = 0;

  if (project.previewImageId) {
    await ctx.storage.delete(project.previewImageId);
    deletedStorageObjects += 1;
  }

  const projectFiles = await ctx.db
    .query("projectFiles")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  for (const file of projectFiles) {
    await ctx.storage.delete(file.storageId);
    deletedStorageObjects += 1;
    await ctx.db.delete(file._id);
    deletedRows += 1;
  }

  const assets = await ctx.db
    .query("projectAssets")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  for (const asset of assets) {
    if (asset.storageId) {
      await ctx.storage.delete(asset.storageId);
      deletedStorageObjects += 1;
    }
    await ctx.db.delete(asset._id);
    deletedRows += 1;
  }

  const projectTaskNotifications = await ctx.db
    .query("projectTaskNotifications")
    .withIndex("by_project_and_created", (q) => q.eq("projectId", project._id))
    .collect();
  deletedRows += await deleteRows(ctx, projectTaskNotifications);

  const changeComments = await ctx.db
    .query("changeComments")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  for (const comment of changeComments) {
    const reactions = await ctx.db
      .query("changeCommentReactions")
      .withIndex("by_comment", (q) => q.eq("commentId", comment._id))
      .collect();
    deletedRows += await deleteRows(ctx, reactions);
  }
  deletedRows += await deleteRows(ctx, changeComments);

  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("fileChanges")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("projectStorageUsage")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("projectInvites")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("projectRepoAccess")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("projectRepositoryBindings")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("projectTasks")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("projectTaskStates")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("projectJoinLinks")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("projectFileLocks")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("fileTombstones")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("projectMessages")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("builderRuns")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRowsInBatches(
    ctx,
    () =>
      ctx.db
        .query("yjsUpdates")
        .withIndex("by_project_and_time", (q) => q.eq("projectId", project._id))
        .take(16),
  );
  deletedRows += await deleteRowsInBatches(
    ctx,
    () =>
      ctx.db
        .query("yjsDocuments")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .take(1),
  );
  deletedRows += await deleteRowsInBatches(
    ctx,
    () =>
      ctx.db
        .query("yjsAwareness")
        .withIndex("by_project_and_updated", (q) => q.eq("projectId", project._id))
        .take(16),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("projectPresence")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("aiConversations")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );
  deletedRows += await deleteRows(
    ctx,
    await ctx.db
      .query("deploymentJobs")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  );

  await ctx.db.delete(project._id);
  await ctx.scheduler.runAfter(0, internal.organizations.recalculateStorageUsage, {
    organizationId: project.organizationId,
  });

  return {
    deletedProject: true,
    deletedRows,
    deletedStorageObjects,
    organizationId: project.organizationId,
  };
}

export const deleteProjectAndRelatedData = mutation({ args: { projectId: v.id("projects") }, handler: async () => {} });

export const deleteProjectBatchAndRelatedData = mutation({ args: { projectIds: v.array(v.id("projects")) }, handler: async () => {} });

export const pruneProjectHeavyCollabData = mutation({ args: { projectId: v.id("projects"), targetSizeRemainingBytes: v.number() }, handler: async () => {} });

export const pruneProjectHeavyCollabTable = mutation({ args: { projectId: v.id("projects"), table: v.string(), targetSizeRemainingBytes: v.number() }, handler: async () => {} });

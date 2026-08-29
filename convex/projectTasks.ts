import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { v } from "convex/values"
import { canAccessProjectByWorkspaceOrMembership } from "./lib/workspaceProjectAccess"

const SYNTHETIC_TASK_SOURCE_VALIDATOR = v.union(
  v.literal("page"),
  v.literal("entity"),
  v.literal("build"),
  v.literal("lock")
)
const TASK_SOURCE_VALIDATOR = v.union(
  v.literal("manual"),
  v.literal("page"),
  v.literal("entity"),
  v.literal("build"),
  v.literal("lock")
)
const TASK_CONTEXT_VALIDATOR = v.object({
  kind: v.union(v.literal("file"), v.literal("page")),
  value: v.string(),
  label: v.string(),
  title: v.string(),
})
const TASK_MARKER_VALIDATOR = v.object({
  id: v.string(),
  label: v.string(),
})
const TASK_ASSIGNEE_VALIDATOR = v.object({
  userId: v.optional(v.id("users")),
  name: v.string(),
  email: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
})

type BoardStatus = "planned" | "active" | "done"
type SyntheticTaskSource = "page" | "entity" | "build" | "lock"
type TaskSource = "manual" | SyntheticTaskSource
type TaskContext = {
  kind: "file" | "page"
  value: string
  label: string
  title: string
}
type TaskMarker = {
  id: string
  label: string
}
type TaskAssignee = {
  userId?: Id<"users">
  name: string
  email?: string
  avatarUrl?: string
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized ? normalized : undefined
}

function normalizeText(value: string | undefined): string {
  return value?.trim() ?? ""
}

function createDefaultMarkers(): TaskMarker[] {
  return [
    { id: "scope", label: "Scope the work" },
    { id: "build", label: "Implement the task" },
    { id: "review", label: "Review and ship" },
  ]
}

function sanitizeMarkers(markers: TaskMarker[]): TaskMarker[] {
  const seen = new Set<string>()
  const sanitized = markers.flatMap((marker, index) => {
    const label = normalizeText(marker.label)
    if (!label) return []

    const fallbackId = `objective-${index + 1}`
    const id = normalizeText(marker.id) || fallbackId
    if (seen.has(id)) return []
    seen.add(id)
    return [{ id, label }]
  })

  return sanitized.length > 0 ? sanitized : createDefaultMarkers()
}

function sanitizeCheckedMarkerIds(markers: TaskMarker[], checkedMarkerIds: string[]): string[] {
  const validIds = new Set(markers.map((marker) => marker.id))
  const uniqueChecked = new Set<string>()

  for (const markerId of checkedMarkerIds) {
    const normalized = normalizeText(markerId)
    if (!normalized || !validIds.has(normalized) || uniqueChecked.has(normalized)) {
      continue
    }
    uniqueChecked.add(normalized)
  }

  return Array.from(uniqueChecked)
}

function inferBoardStatus(totalMarkerCount: number, checkedMarkerCount: number): BoardStatus {
  if (totalMarkerCount <= 0 || checkedMarkerCount <= 0) {
    return "planned"
  }
  if (checkedMarkerCount >= totalMarkerCount) {
    return "done"
  }
  return "active"
}

function sanitizeAssignee(assignee: TaskAssignee | undefined): TaskAssignee | undefined {
  if (!assignee) return undefined

  const name = normalizeText(assignee.name)
  if (!name) return undefined

  const sanitized: TaskAssignee = {
    name,
  }

  if (assignee.userId) {
    sanitized.userId = assignee.userId
  }

  const email = normalizeEmail(assignee.email)
  if (email) {
    sanitized.email = email
  }

  const avatarUrl = normalizeText(assignee.avatarUrl)
  if (avatarUrl) {
    sanitized.avatarUrl = avatarUrl
  }

  return sanitized
}

function sanitizeContext(context: TaskContext): TaskContext {
  return {
    kind: context.kind,
    value: normalizeText(context.value),
    label: normalizeText(context.label),
    title: normalizeText(context.title),
  }
}

async function getAccessibleProject(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  projectId: Id<"projects">,
  userId: Id<"users">
): Promise<Doc<"projects">> {
  const canAccess = await canAccessProjectByWorkspaceOrMembership(
    ctx,
    projectId,
    userId
  )

  if (!canAccess) {
    throw new Error("Unauthorized")
  }

  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    throw new Error("Project not found")
  }

  return project
}

async function assertAssignableAssignee(
  ctx: Pick<MutationCtx, "db">,
  project: Doc<"projects">,
  assignee: TaskAssignee | undefined
): Promise<void> {
  if (!assignee?.userId) return

  const projectMembership = await ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_user", (q) =>
      q.eq("projectId", project._id).eq("userId", assignee.userId as Id<"users">)
    )
    .first()

  if (projectMembership) {
    return
  }
  throw new Error("Assignee is not part of this project")
}

async function insertAssignmentNotification(
  ctx: MutationCtx,
  project: Doc<"projects">,
  assignee: TaskAssignee | undefined,
  taskStorageId: string,
  taskTitle: string,
  taskContext: TaskContext,
  actorUserId: Id<"users">
): Promise<void> {
  if (!assignee?.userId) return

  await ctx.db.insert("projectTaskNotifications", {
    userId: assignee.userId,
    projectId: project._id,
    kind: "assigned",
    taskSource: "manual",
    taskStorageId,
    taskTitle,
    taskContext,
    actorUserId,
    createdAt: Date.now(),
  })
}

async function insertCompletionNotifications(
  ctx: MutationCtx,
  project: Doc<"projects">,
  actorUserId: Id<"users">,
  taskSource: TaskSource,
  taskStorageId: string,
  taskTitle: string,
  taskContext: TaskContext
): Promise<void> {
  const memberships = await ctx.db
    .query("projectMembers")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect()

  const uniqueUserIds = new Set<string>()
  const now = Date.now()

  for (const membership of memberships) {
    const key = String(membership.userId)
    if (uniqueUserIds.has(key)) continue
    uniqueUserIds.add(key)

    await ctx.db.insert("projectTaskNotifications", {
      userId: membership.userId,
      projectId: project._id,
      kind: "completed",
      taskSource,
      taskStorageId,
      taskTitle,
      taskContext,
      actorUserId,
      createdAt: now,
    })
  }
}

export const listForProject = query({
  args: {
    projectId: v.id("projects"),
    viewerUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await getAccessibleProject(ctx, args.projectId, args.viewerUserId)

    const tasks = await ctx.db
      .query("projectTasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()

    return tasks.sort((left, right) => {
      if (right.createdAt !== left.createdAt) {
        return right.createdAt - left.createdAt
      }
      return left.title.localeCompare(right.title)
    })
  },
})

export const listSharedStatesForProject = query({
  args: {
    projectId: v.id("projects"),
    viewerUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await getAccessibleProject(ctx, args.projectId, args.viewerUserId)

    return await ctx.db
      .query("projectTaskStates")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()
  },
})

export const getOverlayTaskState = query({
  args: {
    projectId: v.id("projects"),
    viewerUserId: v.id("users"),
    source: TASK_SOURCE_VALIDATOR,
    storageId: v.string(),
  },
  handler: async (ctx, args) => {
    await getAccessibleProject(ctx, args.projectId, args.viewerUserId)

    if (args.source === "manual") {
      const task = await ctx.db
        .query("projectTasks")
        .withIndex("by_project_and_task_key", (q) =>
          q.eq("projectId", args.projectId).eq("taskKey", args.storageId)
        )
        .first()

      return task
        ? {
            checkedMarkerIds: task.checkedMarkerIds,
            status: task.status,
          }
        : null
    }

    const syntheticSource = args.source as SyntheticTaskSource
    const state = await ctx.db
      .query("projectTaskStates")
      .withIndex("by_project_and_source_and_storage", (q) =>
        q.eq("projectId", args.projectId).eq("source", syntheticSource).eq("storageId", args.storageId)
      )
      .first()

    return state
      ? {
          checkedMarkerIds: state.checkedMarkerIds,
          status: state.status,
        }
      : null
  },
})

export const listInboxForUser = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("projectTaskNotifications")
      .withIndex("by_user_and_created", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(24)

    const enriched = await Promise.all(
      notifications.map(async (notification) => {
        const [project, actor] = await Promise.all([
          ctx.db.get(notification.projectId),
          notification.actorUserId ? ctx.db.get(notification.actorUserId) : Promise.resolve(null),
        ])

        if (!project || project.status === "deleted") {
          return null
        }

        return {
          ...notification,
          project: {
            id: project._id,
            name: project.name,
            slug: project.slug,
          },
          actor: actor
            ? {
                id: actor._id,
                email: actor.email,
                firstName: actor.firstName,
                lastName: actor.lastName,
                profileImageUrl: actor.profileImageUrl,
              }
            : null,
        }
      })
    )

    return enriched.filter((item): item is Exclude<(typeof enriched)[number], null> => item !== null)
  },
})

export const createManualTask = mutation({
  args: {
    projectId: v.id("projects"),
    actorUserId: v.id("users"),
    taskKey: v.string(),
    title: v.string(),
    description: v.string(),
    deadlineDate: v.optional(v.string()),
    assignee: v.optional(TASK_ASSIGNEE_VALIDATOR),
    context: TASK_CONTEXT_VALIDATOR,
    markers: v.array(TASK_MARKER_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const project = await getAccessibleProject(ctx, args.projectId, args.actorUserId)
    const taskKey = normalizeText(args.taskKey) || `task-${Date.now()}`
    const title = normalizeText(args.title)

    if (!title) {
      throw new Error("Task title is required")
    }

    const existing = await ctx.db
      .query("projectTasks")
      .withIndex("by_project_and_task_key", (q) =>
        q.eq("projectId", args.projectId).eq("taskKey", taskKey)
      )
      .first()

    if (existing) {
      return existing
    }

    const assignee = sanitizeAssignee(args.assignee)
    await assertAssignableAssignee(ctx, project, assignee)

    const markers = sanitizeMarkers(args.markers)
    const checkedMarkerIds: string[] = []
    const status = inferBoardStatus(markers.length, checkedMarkerIds.length)
    const now = Date.now()

    const docId = await ctx.db.insert("projectTasks", {
      projectId: args.projectId,
      taskKey,
      title,
      description: normalizeText(args.description),
      status,
      deadlineDate: normalizeText(args.deadlineDate) || undefined,
      assignee,
      context: sanitizeContext(args.context),
      markers,
      checkedMarkerIds,
      createdBy: args.actorUserId,
      updatedBy: args.actorUserId,
      createdAt: now,
      updatedAt: now,
    })

    await insertAssignmentNotification(
      ctx,
      project,
      assignee,
      taskKey,
      title,
      sanitizeContext(args.context),
      args.actorUserId
    )

    return await ctx.db.get(docId)
  },
})

export const setManualTaskCheckedMarkers = mutation({
  args: {
    projectId: v.id("projects"),
    actorUserId: v.id("users"),
    taskKey: v.string(),
    checkedMarkerIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await getAccessibleProject(ctx, args.projectId, args.actorUserId)
    const task = await ctx.db
      .query("projectTasks")
      .withIndex("by_project_and_task_key", (q) =>
        q.eq("projectId", args.projectId).eq("taskKey", args.taskKey)
      )
      .first()

    if (!task) {
      throw new Error("Task not found")
    }

    const checkedMarkerIds = sanitizeCheckedMarkerIds(task.markers, args.checkedMarkerIds)
    const nextStatus = inferBoardStatus(task.markers.length, checkedMarkerIds.length)
    const now = Date.now()

    await ctx.db.patch(task._id, {
      checkedMarkerIds,
      status: nextStatus,
      updatedBy: args.actorUserId,
      updatedAt: now,
      completedAt: nextStatus === "done" ? now : undefined,
      completedBy: nextStatus === "done" ? args.actorUserId : undefined,
    })

    if (task.status !== "done" && nextStatus === "done") {
      await insertCompletionNotifications(
        ctx,
        project,
        args.actorUserId,
        "manual",
        task.taskKey,
        task.title,
        task.context
      )
    }

    return {
      checkedMarkerIds,
      status: nextStatus,
    }
  },
})

export const setSharedTaskCheckedMarkers = mutation({
  args: {
    projectId: v.id("projects"),
    actorUserId: v.id("users"),
    source: SYNTHETIC_TASK_SOURCE_VALIDATOR,
    storageId: v.string(),
    totalMarkerCount: v.number(),
    checkedMarkerIds: v.array(v.string()),
    taskTitle: v.string(),
    taskContext: TASK_CONTEXT_VALIDATOR,
  },
  handler: async (ctx, args) => {
    const project = await getAccessibleProject(ctx, args.projectId, args.actorUserId)
    const totalMarkerCount = Math.max(0, args.totalMarkerCount)
    const checkedMarkerIds = Array.from(
      new Set(
        args.checkedMarkerIds
          .map((markerId) => normalizeText(markerId))
          .filter((markerId) => markerId.length > 0)
      )
    )
    const nextStatus = inferBoardStatus(totalMarkerCount, checkedMarkerIds.length)
    const existing = await ctx.db
      .query("projectTaskStates")
      .withIndex("by_project_and_source_and_storage", (q) =>
        q.eq("projectId", args.projectId).eq("source", args.source).eq("storageId", args.storageId)
      )
      .first()
    const now = Date.now()

    if (existing) {
      await ctx.db.patch(existing._id, {
        checkedMarkerIds,
        status: nextStatus,
        updatedBy: args.actorUserId,
        updatedAt: now,
        completedAt: nextStatus === "done" ? now : undefined,
        completedBy: nextStatus === "done" ? args.actorUserId : undefined,
      })
    } else {
      await ctx.db.insert("projectTaskStates", {
        projectId: args.projectId,
        source: args.source,
        storageId: args.storageId,
        status: nextStatus,
        checkedMarkerIds,
        updatedBy: args.actorUserId,
        updatedAt: now,
        completedAt: nextStatus === "done" ? now : undefined,
        completedBy: nextStatus === "done" ? args.actorUserId : undefined,
      })
    }

    if (existing?.status !== "done" && nextStatus === "done") {
      await insertCompletionNotifications(
        ctx,
        project,
        args.actorUserId,
        args.source,
        args.storageId,
        normalizeText(args.taskTitle),
        sanitizeContext(args.taskContext)
      )
    }

    return {
      checkedMarkerIds,
      status: nextStatus,
    }
  },
})

export const migrateLocalBoardState = mutation({
  args: {
    projectId: v.id("projects"),
    actorUserId: v.id("users"),
    manualTasks: v.array(
      v.object({
        taskKey: v.string(),
        title: v.string(),
        description: v.string(),
        deadlineDate: v.optional(v.string()),
        assignee: v.optional(TASK_ASSIGNEE_VALIDATOR),
        context: TASK_CONTEXT_VALIDATOR,
        markers: v.array(TASK_MARKER_VALIDATOR),
        checkedMarkerIds: v.array(v.string()),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
      })
    ),
    sharedStates: v.array(
      v.object({
        source: SYNTHETIC_TASK_SOURCE_VALIDATOR,
        storageId: v.string(),
        totalMarkerCount: v.number(),
        checkedMarkerIds: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const project = await getAccessibleProject(ctx, args.projectId, args.actorUserId)
    const existingTasks = await ctx.db
      .query("projectTasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()
    const existingTaskKeys = new Set(existingTasks.map((task) => task.taskKey))
    let importedManualTaskCount = 0
    let importedSharedStateCount = 0

    for (const input of args.manualTasks) {
      const taskKey = normalizeText(input.taskKey)
      if (!taskKey || existingTaskKeys.has(taskKey)) {
        continue
      }

      const markers = sanitizeMarkers(input.markers)
      const checkedMarkerIds = sanitizeCheckedMarkerIds(markers, input.checkedMarkerIds)
      const status = inferBoardStatus(markers.length, checkedMarkerIds.length)
      const assignee = sanitizeAssignee(input.assignee)
      const now = Date.now()

      let safeAssignee = assignee
      if (assignee?.userId) {
        try {
          await assertAssignableAssignee(ctx, project, assignee)
        } catch {
          safeAssignee = {
            name: assignee.name,
            email: assignee.email,
            avatarUrl: assignee.avatarUrl,
          }
        }
      }

      await ctx.db.insert("projectTasks", {
        projectId: args.projectId,
        taskKey,
        title: normalizeText(input.title) || "Untitled task",
        description: normalizeText(input.description),
        status,
        deadlineDate: normalizeText(input.deadlineDate) || undefined,
        assignee: safeAssignee,
        context: sanitizeContext(input.context),
        markers,
        checkedMarkerIds,
        createdBy: args.actorUserId,
        updatedBy: args.actorUserId,
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt ?? input.createdAt ?? now,
        completedAt: status === "done" ? (input.updatedAt ?? input.createdAt ?? now) : undefined,
        completedBy: status === "done" ? args.actorUserId : undefined,
      })

      existingTaskKeys.add(taskKey)
      importedManualTaskCount += 1
    }

    for (const state of args.sharedStates) {
      const existing = await ctx.db
        .query("projectTaskStates")
        .withIndex("by_project_and_source_and_storage", (q) =>
          q.eq("projectId", args.projectId).eq("source", state.source).eq("storageId", state.storageId)
        )
        .first()

      if (existing) {
        continue
      }

      const checkedMarkerIds = Array.from(
        new Set(
          state.checkedMarkerIds
            .map((markerId) => normalizeText(markerId))
            .filter((markerId) => markerId.length > 0)
        )
      )
      const status = inferBoardStatus(Math.max(0, state.totalMarkerCount), checkedMarkerIds.length)
      const now = Date.now()

      await ctx.db.insert("projectTaskStates", {
        projectId: args.projectId,
        source: state.source,
        storageId: normalizeText(state.storageId),
        status,
        checkedMarkerIds,
        updatedBy: args.actorUserId,
        updatedAt: now,
        completedAt: status === "done" ? now : undefined,
        completedBy: status === "done" ? args.actorUserId : undefined,
      })

      importedSharedStateCount += 1
    }

    return {
      importedManualTaskCount,
      importedSharedStateCount,
    }
  },
})

export const dismissInboxItems = mutation({
  args: {
    userId: v.id("users"),
    notificationIds: v.array(v.id("projectTaskNotifications")),
  },
  handler: async (ctx, args) => {
    let removedCount = 0

    for (const notificationId of args.notificationIds) {
      const notification = await ctx.db.get(notificationId)
      if (!notification || notification.userId !== args.userId) {
        continue
      }

      await ctx.db.delete(notificationId)
      removedCount += 1
    }

    return { removedCount }
  },
})

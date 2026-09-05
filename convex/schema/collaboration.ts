import { defineTable } from "convex/server"
import { v } from "convex/values"

export const collaborationSessionStatusValidator = v.union(
  v.literal("opening"),
  v.literal("active"),
  v.literal("commit_preparing"),
  v.literal("local_commit_ready"),
  v.literal("pushing"),
  v.literal("closing"),
  v.literal("closed"),
  v.literal("failed"),
)

export const collaborationParticipantRoleValidator = v.union(
  v.literal("editor"),
  v.literal("observer"),
)

export const collaborationCapabilitiesValidator = v.object({
  codeSync: v.boolean(),
  audio: v.boolean(),
  screenShare: v.boolean(),
})

export const collaborationSessionEventTypeValidator = v.union(
  v.literal("created"),
  v.literal("activated"),
  v.literal("participant_joined"),
  v.literal("participant_left"),
  v.literal("lease_acquired"),
  v.literal("lease_renewed"),
  v.literal("lease_released"),
  v.literal("commit_prepared"),
  v.literal("push_started"),
  v.literal("base_advanced"),
  v.literal("closing"),
  v.literal("closed"),
  v.literal("failed"),
)

export const collaborationTables = {
  collaborationPublications: defineTable({
    sessionId: v.id("collaborationSessions"),
    publicSessionId: v.string(),
    publicationRevision: v.number(),
    projectId: v.id("projects"),
    commitSha: v.string(),
    coveredThroughSequence: v.number(),
    publishedByUserId: v.id("users"),
    createdAt: v.number(),
    deliveredAt: v.optional(v.number()),
    attempts: v.number(),
  }).index("by_session_and_commit", ["sessionId", "commitSha"]).index("by_project", ["projectId"]),
  // Low-volume control-plane state only. Source files, Yjs updates, snapshots,
  // and Git credentials never belong in these records.
  collaborationSessions: defineTable({
    // Optional only so obsolete rows can be inventoried during the alpha cutover.
    generation: v.optional(v.number()),
    sessionId: v.string(),
    creationToken: v.string(),
    projectId: v.id("projects"),
    repositoryId: v.string(),
    targetBranch: v.string(),
    targetCommitSha: v.optional(v.string()),
    sessionBranch: v.string(),
    baseCommitSha: v.string(),
    publishedCommitSha: v.optional(v.string()),
    publishedThroughSequence: v.number(),
    roomHeadSequence: v.number(),
    createdByUserId: v.id("users"),
    commitLeaseUserId: v.optional(v.id("users")),
    commitLeaseExpiresAt: v.optional(v.number()),
    pendingCommitSha: v.optional(v.string()),
    pendingCommitThroughSequence: v.optional(v.number()),
    pendingCommitCreatedAt: v.optional(v.number()),
    status: collaborationSessionStatusValidator,
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    closedAt: v.optional(v.number()),
    failureCode: v.optional(v.string()),
    failureMessage: v.optional(v.string()),
  })
    .index("by_session_id", ["sessionId"])
    .index("by_project_and_creation_token", ["projectId", "creationToken"])
    .index("by_project_and_status", ["projectId", "status"])
    .index("by_project_and_target", ["projectId", "targetBranch"])
    .index("by_project_and_updated", ["projectId", "updatedAt"])
    .index("by_repository_and_status", ["repositoryId", "status"])
    .index("by_lease_expiry", ["commitLeaseExpiresAt"]),

  collaborationParticipants: defineTable({
    sessionId: v.id("collaborationSessions"),
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: collaborationParticipantRoleValidator,
    capabilities: collaborationCapabilitiesValidator,
    joinedAt: v.number(),
    lastSeenAt: v.number(),
    leftAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_and_user", ["sessionId", "userId"])
    .index("by_project_and_user", ["projectId", "userId"])
    .index("by_user_and_last_seen", ["userId", "lastSeenAt"]),

  collaborationSessionEvents: defineTable({
    sessionId: v.id("collaborationSessions"),
    projectId: v.id("projects"),
    eventType: collaborationSessionEventTypeValidator,
    actorUserId: v.optional(v.id("users")),
    roomSequence: v.optional(v.number()),
    commitSha: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_session_and_created_at", ["sessionId", "createdAt"])
    .index("by_project_and_created_at", ["projectId", "createdAt"])
    .index("by_event_type_and_created_at", ["eventType", "createdAt"]),
}

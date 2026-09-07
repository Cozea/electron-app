import { defineTable } from "convex/server"
import { v } from "convex/values"

export const repositoryOperationValidator = v.union(v.literal("read"), v.literal("write"))

export const projectRepositoryAuthorizationTables = {
  projectRepositoryAuthorizations: defineTable({
    projectId: v.id("projects"),
    provider: v.literal("github"),
    repositoryNumericId: v.string(),
    installationId: v.string(),
    enabled: v.boolean(),
    configuredByPrincipalId: v.id("devicePrincipals"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_installation_and_repository", ["installationId", "repositoryNumericId"]),

  projectRepositoryAccessEvents: defineTable({
    projectId: v.id("projects"),
    authorizationId: v.id("projectRepositoryAuthorizations"),
    principalId: v.id("devicePrincipals"),
    operation: repositoryOperationValidator,
    sessionId: v.optional(v.id("collaborationSessions")),
    outcome: v.union(v.literal("issued"), v.literal("verified"), v.literal("rejected")),
    tokenExpiresAt: v.optional(v.number()),
    commitSha: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_project_and_created", ["projectId", "createdAt"])
    .index("by_principal_and_created", ["principalId", "createdAt"])
    .index("by_session_and_created", ["sessionId", "createdAt"]),
}

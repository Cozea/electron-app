import { defineTable } from "convex/server"
import { v } from "convex/values"

export const collaborationRepositoryProviderValidator = v.literal("github")
export const collaborationRepositoryAccessPolicyValidator = v.union(
  v.literal("organization"),
  v.literal("restricted"),
)
export const collaborationRepositoryOperationValidator = v.union(
  v.literal("read"),
  v.literal("write"),
)

export const verifiedRepositoryValidator = v.object({
  installationId: v.string(), repositoryNumericId: v.string(), owner: v.string(),
  name: v.string(), defaultBranch: v.string(),
})

export const collaborationRepositoryTables = {
  collaborationInstallationRevocations: defineTable({
    installationId: v.string(), revokedAt: v.number(),
  }).index("by_installation", ["installationId"]),
  collaborationRepositoryResolutions: defineTable({
    projectId: v.id("projects"), userId: v.id("users"), bindingId: v.id("collaborationRepositoryBindings"),
    repositoryId: v.string(), branch: v.string(), commitSha: v.string(), expiresAt: v.number(),
    consumedBySessionId: v.optional(v.id("collaborationSessions")),
  }).index("by_project", ["projectId"]).index("by_expiry", ["expiresAt"]),
  collaborationRepositorySetups: defineTable({
    organizationId: v.id("organizations"), userId: v.id("users"),
    stateHash: v.string(), expiresAt: v.number(), consumedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  }).index("by_state", ["stateHash"]).index("by_user", ["userId"]),
  collaborationVerifiedRepositories: defineTable({
    organizationId: v.id("organizations"), installationId: v.string(), repositoryNumericId: v.string(),
    owner: v.string(), name: v.string(), defaultBranch: v.string(),
    verifiedByUserId: v.id("users"), verifiedAt: v.number(), revokedAt: v.optional(v.number()),
  }).index("by_organization", ["organizationId"])
    .index("by_organization_and_repository", ["organizationId", "repositoryNumericId"])
    .index("by_installation", ["installationId"]),
  collaborationRepositoryBindings: defineTable({
    projectId: v.id("projects"),
    organizationId: v.optional(v.id("organizations")),
    provider: collaborationRepositoryProviderValidator,
    repositoryId: v.string(),
    repositoryNumericId: v.string(),
    installationId: v.string(),
    owner: v.string(),
    name: v.string(),
    fullName: v.string(),
    cloneUrl: v.string(),
    htmlUrl: v.string(),
    defaultBranch: v.string(),
    accessPolicy: collaborationRepositoryAccessPolicyValidator,
    enabled: v.boolean(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_repository_id", ["repositoryId"])
    .index("by_installation_and_repository", ["installationId", "repositoryNumericId"])
    .index("by_organization_and_updated", ["organizationId", "updatedAt"]),

  collaborationRepositoryAccessEvents: defineTable({
    projectId: v.id("projects"),
    bindingId: v.id("collaborationRepositoryBindings"),
    userId: v.id("users"),
    operation: collaborationRepositoryOperationValidator,
    sessionId: v.optional(v.id("collaborationSessions")),
    outcome: v.union(
      v.literal("issued"),
      v.literal("verified"),
      v.literal("rejected"),
    ),
    tokenExpiresAt: v.optional(v.number()),
    commitSha: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_project_and_created", ["projectId", "createdAt"])
    .index("by_user_and_created", ["userId", "createdAt"])
    .index("by_session_and_created", ["sessionId", "createdAt"]),
}

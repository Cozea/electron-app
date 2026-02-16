import { internalMutation, mutation } from "./_generated/server"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET
const DEFAULT_SAMPLE_LIMIT = 50
const DEFAULT_MAX_USER_GROUPS = 5
const DEFAULT_MAX_ORG_GROUPS = 5

type OrganizationRole = "admin" | "member" | "viewer"

interface DuplicateGroup {
  key: string
  count: number
  ids: string[]
}

interface DuplicateSummary {
  users: {
    totalRows: number
    duplicateByWorkosId: DuplicateGroup[]
    duplicateByNormalizedEmail: DuplicateGroup[]
  }
  organizations: {
    totalRows: number
    duplicateByWorkosId: DuplicateGroup[]
    duplicateBySlug: DuplicateGroup[]
  }
  memberships: {
    totalRows: number
    duplicateByOrganizationUser: DuplicateGroup[]
    duplicateByWorkosId: DuplicateGroup[]
    orphanRows: number
  }
}

interface RepairCounters {
  processedUserGroups: number
  processedOrganizationGroups: number
  mergedUsers: number
  mergedOrganizations: number
  referencesUpdated: number
  rowsDeleted: number
  membershipRowsDeleted: number
  invitationRowsDeleted: number
  integrationRowsDeleted: number
  slugUpdates: number
}

interface MembershipDedupResult {
  deletedRows: number
  updatedRows: number
  orphanRowsDeleted: number
}

interface InvitationDedupResult {
  deletedRows: number
}

interface IntegrationDedupResult {
  deletedRows: number
}

function assertGatewaySecret(secret: string | undefined): void {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return base || "workspace"
}

function rolePriority(role: OrganizationRole): number {
  switch (role) {
    case "admin":
      return 3
    case "member":
      return 2
    default:
      return 1
  }
}

function compareMembershipPriority(a: Doc<"members">, b: Doc<"members">): number {
  const roleDelta = rolePriority(b.role) - rolePriority(a.role)
  if (roleDelta !== 0) return roleDelta
  const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
  if (updatedDelta !== 0) return updatedDelta
  const joinedDelta = (b.joinedAt || 0) - (a.joinedAt || 0)
  if (joinedDelta !== 0) return joinedDelta
  return String(a._id).localeCompare(String(b._id))
}

function pickCanonicalMembership(memberships: Doc<"members">[]): Doc<"members"> | null {
  if (memberships.length === 0) return null
  return [...memberships].sort(compareMembershipPriority)[0]
}

function userLastActivity(user: Doc<"users">): number {
  return Math.max(user.lastLoginAt || 0, user.updatedAt || 0, user.createdAt || 0)
}

function pickCanonicalUser(
  users: Doc<"users">[],
  preferredWorkosId?: string
): Doc<"users"> | null {
  if (users.length === 0) return null
  return [...users].sort((a, b) => {
    const preferredDelta =
      Number(b.workosId === preferredWorkosId) - Number(a.workosId === preferredWorkosId)
    if (preferredDelta !== 0) return preferredDelta
    const activityDelta = userLastActivity(b) - userLastActivity(a)
    if (activityDelta !== 0) return activityDelta
    const createdDelta = b.createdAt - a.createdAt
    if (createdDelta !== 0) return createdDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

function subscriptionQualityScore(org: Doc<"organizations">): number {
  const status = org.subscription?.status
  const plan = org.subscription?.plan

  const statusScore =
    status === "active" ? 4 : status === "trialing" ? 3 : status === "past_due" ? 2 : 1
  const planScore =
    plan === "enterprise"
      ? 5
      : plan === "team"
        ? 4
        : plan === "max"
          ? 3
          : plan === "pro"
            ? 2
            : 1

  return statusScore * 10 + planScore
}

function pickCanonicalOrganization(
  organizations: Doc<"organizations">[],
  preferredWorkosId?: string
): Doc<"organizations"> | null {
  if (organizations.length === 0) return null
  return [...organizations].sort((a, b) => {
    const preferredDelta =
      Number(b.workosId === preferredWorkosId) - Number(a.workosId === preferredWorkosId)
    if (preferredDelta !== 0) return preferredDelta
    const subscriptionDelta = subscriptionQualityScore(b) - subscriptionQualityScore(a)
    if (subscriptionDelta !== 0) return subscriptionDelta
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    const createdDelta = b.createdAt - a.createdAt
    if (createdDelta !== 0) return createdDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

function idKey(value: unknown): string {
  return String(value)
}

function toDuplicateGroups<T extends { _id: unknown }>(
  grouped: Map<string, T[]>,
  sampleLimit: number
): DuplicateGroup[] {
  return [...grouped.entries()]
    .filter(([, values]) => values.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, sampleLimit)
    .map(([key, values]) => ({
      key,
      count: values.length,
      ids: values.map((value) => idKey(value._id)),
    }))
}

function emptyRepairCounters(): RepairCounters {
  return {
    processedUserGroups: 0,
    processedOrganizationGroups: 0,
    mergedUsers: 0,
    mergedOrganizations: 0,
    referencesUpdated: 0,
    rowsDeleted: 0,
    membershipRowsDeleted: 0,
    invitationRowsDeleted: 0,
    integrationRowsDeleted: 0,
    slugUpdates: 0,
  }
}

function hasUserId(sourceIds: Set<string>, value: Id<"users"> | undefined | null): boolean {
  if (!value) return false
  return sourceIds.has(idKey(value))
}

function hasOrganizationId(
  sourceIds: Set<string>,
  value: Id<"organizations"> | undefined | null
): boolean {
  if (!value) return false
  return sourceIds.has(idKey(value))
}

function dedupeUserIdArray(
  values: Id<"users">[] | undefined,
  sourceIds: Set<string>,
  canonicalUserId: Id<"users">
): Id<"users">[] | undefined {
  if (!values || values.length === 0) return values
  let changed = false
  const result: Id<"users">[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const normalized = sourceIds.has(idKey(value)) ? canonicalUserId : value
    if (sourceIds.has(idKey(value))) {
      changed = true
    }
    const key = idKey(normalized)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(normalized)
    } else if (normalized !== value) {
      changed = true
    }
  }

  return changed ? result : values
}

async function resolveUniqueSlug(
  ctx: MutationCtx,
  desired: string,
  used: Set<string>
): Promise<string> {
  const base = slugify(desired)
  let attempt = 1
  let candidate = base
  while (attempt <= 1000) {
    if (!used.has(candidate)) {
      const existing = await ctx.db
        .query("organizations")
        .withIndex("by_slug", (q) => q.eq("slug", candidate))
        .first()
      if (!existing) {
        return candidate
      }
      used.add(candidate)
    }
    attempt += 1
    candidate = `${base}-${attempt}`
  }
  return `${base}-${Date.now()}`
}

async function collectDuplicateSummary(
  ctx: MutationCtx,
  sampleLimit = DEFAULT_SAMPLE_LIMIT
): Promise<DuplicateSummary> {
  const [users, organizations, memberships] = await Promise.all([
    ctx.db.query("users").collect(),
    ctx.db.query("organizations").collect(),
    ctx.db.query("members").collect(),
  ])

  const usersByWorkosId = new Map<string, Doc<"users">[]>()
  const usersByNormalizedEmail = new Map<string, Doc<"users">[]>()
  for (const user of users) {
    const workosKey = user.workosId
    const normalizedEmail = user.normalizedEmail || normalizeEmail(user.email)

    const byWorkos = usersByWorkosId.get(workosKey) || []
    byWorkos.push(user)
    usersByWorkosId.set(workosKey, byWorkos)

    const byEmail = usersByNormalizedEmail.get(normalizedEmail) || []
    byEmail.push(user)
    usersByNormalizedEmail.set(normalizedEmail, byEmail)
  }

  const organizationsByWorkosId = new Map<string, Doc<"organizations">[]>()
  const organizationsBySlug = new Map<string, Doc<"organizations">[]>()
  for (const org of organizations) {
    const workosGroup = organizationsByWorkosId.get(org.workosId) || []
    workosGroup.push(org)
    organizationsByWorkosId.set(org.workosId, workosGroup)

    const slugKey = slugify(org.slug || org.name)
    const slugGroup = organizationsBySlug.get(slugKey) || []
    slugGroup.push(org)
    organizationsBySlug.set(slugKey, slugGroup)
  }

  const membershipsByOrgUser = new Map<string, Doc<"members">[]>()
  const membershipsByWorkosId = new Map<string, Doc<"members">[]>()

  const validUserIds = new Set(users.map((user) => idKey(user._id)))
  const validOrganizationIds = new Set(organizations.map((org) => idKey(org._id)))

  let orphanRows = 0
  for (const membership of memberships) {
    const orgUserKey = `${idKey(membership.organizationId)}::${idKey(membership.userId)}`
    const orgUserGroup = membershipsByOrgUser.get(orgUserKey) || []
    orgUserGroup.push(membership)
    membershipsByOrgUser.set(orgUserKey, orgUserGroup)

    const workosGroup = membershipsByWorkosId.get(membership.workosId) || []
    workosGroup.push(membership)
    membershipsByWorkosId.set(membership.workosId, workosGroup)

    if (
      !validUserIds.has(idKey(membership.userId)) ||
      !validOrganizationIds.has(idKey(membership.organizationId))
    ) {
      orphanRows += 1
    }
  }

  return {
    users: {
      totalRows: users.length,
      duplicateByWorkosId: toDuplicateGroups(usersByWorkosId, sampleLimit),
      duplicateByNormalizedEmail: toDuplicateGroups(usersByNormalizedEmail, sampleLimit),
    },
    organizations: {
      totalRows: organizations.length,
      duplicateByWorkosId: toDuplicateGroups(organizationsByWorkosId, sampleLimit),
      duplicateBySlug: toDuplicateGroups(organizationsBySlug, sampleLimit),
    },
    memberships: {
      totalRows: memberships.length,
      duplicateByOrganizationUser: toDuplicateGroups(membershipsByOrgUser, sampleLimit),
      duplicateByWorkosId: toDuplicateGroups(membershipsByWorkosId, sampleLimit),
      orphanRows,
    },
  }
}

function buildUserDuplicateGroupsByWorkosId(users: Doc<"users">[]): Array<Doc<"users">[]> {
  const grouped = new Map<string, Doc<"users">[]>()
  for (const user of users) {
    const group = grouped.get(user.workosId) || []
    group.push(user)
    grouped.set(user.workosId, group)
  }
  return [...grouped.values()].filter((group) => group.length > 1)
}

function buildUserDuplicateGroupsByNormalizedEmail(users: Doc<"users">[]): Array<Doc<"users">[]> {
  const grouped = new Map<string, Doc<"users">[]>()
  for (const user of users) {
    const key = user.normalizedEmail || normalizeEmail(user.email)
    const group = grouped.get(key) || []
    group.push(user)
    grouped.set(key, group)
  }
  return [...grouped.values()].filter((group) => group.length > 1)
}

function buildOrganizationDuplicateGroupsByWorkosId(
  organizations: Doc<"organizations">[]
): Array<Doc<"organizations">[]> {
  const grouped = new Map<string, Doc<"organizations">[]>()
  for (const organization of organizations) {
    const group = grouped.get(organization.workosId) || []
    group.push(organization)
    grouped.set(organization.workosId, group)
  }
  return [...grouped.values()].filter((group) => group.length > 1)
}

async function repointUserReferences(
  ctx: MutationCtx,
  sourceUserIds: Set<string>,
  canonicalUserId: Id<"users">,
  dryRun: boolean
): Promise<{ updated: number }> {
  let updated = 0

  const members = await ctx.db.query("members").collect()
  for (const member of members) {
    if (hasUserId(sourceUserIds, member.userId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(member._id, { userId: canonicalUserId })
      }
    }
  }

  const invitations = await ctx.db.query("invitations").collect()
  for (const invite of invitations) {
    if (hasUserId(sourceUserIds, invite.invitedBy)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(invite._id, { invitedBy: canonicalUserId })
      }
    }
  }

  const integrations = await ctx.db.query("integrations").collect()
  for (const integration of integrations) {
    if (hasUserId(sourceUserIds, integration.connectedBy)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(integration._id, { connectedBy: canonicalUserId })
      }
    }
  }

  const aiUsage = await ctx.db.query("aiUsage").collect()
  for (const usage of aiUsage) {
    if (hasUserId(sourceUserIds, usage.userId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(usage._id, { userId: canonicalUserId })
      }
    }
  }

  const auditLogs = await ctx.db.query("auditLogs").collect()
  for (const log of auditLogs) {
    if (hasUserId(sourceUserIds, log.userId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(log._id, { userId: canonicalUserId })
      }
    }
  }

  const toolApprovals = await ctx.db.query("toolApprovalRequests").collect()
  for (const approval of toolApprovals) {
    const patch: Partial<Doc<"toolApprovalRequests">> = {}
    if (hasUserId(sourceUserIds, approval.userId)) {
      patch.userId = canonicalUserId
    }
    if (hasUserId(sourceUserIds, approval.resolvedBy || undefined)) {
      patch.resolvedBy = canonicalUserId
    }
    if (Object.keys(patch).length > 0) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(approval._id, patch)
      }
    }
  }

  const projects = await ctx.db.query("projects").collect()
  for (const project of projects) {
    const patch: Partial<Doc<"projects">> = {}
    if (hasUserId(sourceUserIds, project.createdBy)) {
      patch.createdBy = canonicalUserId
    }
    if (hasUserId(sourceUserIds, project.lastSyncBy || undefined)) {
      patch.lastSyncBy = canonicalUserId
    }
    if (project.cloudStorage?.uploadedBy && hasUserId(sourceUserIds, project.cloudStorage.uploadedBy)) {
      patch.cloudStorage = {
        ...project.cloudStorage,
        uploadedBy: canonicalUserId,
      }
    }

    if (Object.keys(patch).length > 0) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(project._id, patch)
      }
    }
  }

  const projectMembers = await ctx.db.query("projectMembers").collect()
  for (const member of projectMembers) {
    const patch: Partial<Doc<"projectMembers">> = {}
    if (hasUserId(sourceUserIds, member.userId)) {
      patch.userId = canonicalUserId
    }
    if (hasUserId(sourceUserIds, member.addedBy)) {
      patch.addedBy = canonicalUserId
    }
    if (Object.keys(patch).length > 0) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(member._id, patch)
      }
    }
  }

  const projectInvites = await ctx.db.query("projectInvites").collect()
  for (const invite of projectInvites) {
    if (hasUserId(sourceUserIds, invite.invitedBy)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(invite._id, { invitedBy: canonicalUserId })
      }
    }
  }

  const projectTeams = await ctx.db.query("projectTeams").collect()
  for (const team of projectTeams) {
    if (hasUserId(sourceUserIds, team.createdBy)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(team._id, { createdBy: canonicalUserId })
      }
    }
  }

  const projectTeamMembers = await ctx.db.query("projectTeamMembers").collect()
  for (const teamMember of projectTeamMembers) {
    const patch: Partial<Doc<"projectTeamMembers">> = {}
    if (hasUserId(sourceUserIds, teamMember.userId)) {
      patch.userId = canonicalUserId
    }
    if (hasUserId(sourceUserIds, teamMember.addedBy)) {
      patch.addedBy = canonicalUserId
    }
    if (Object.keys(patch).length > 0) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(teamMember._id, patch)
      }
    }
  }

  const fileLocks = await ctx.db.query("projectFileLocks").collect()
  for (const lock of fileLocks) {
    const patch: Partial<Doc<"projectFileLocks">> = {}
    if (hasUserId(sourceUserIds, lock.lockedBy || undefined)) {
      patch.lockedBy = canonicalUserId
    }
    if (hasUserId(sourceUserIds, lock.lastMergedBy || undefined)) {
      patch.lastMergedBy = canonicalUserId
    }
    const normalizedPendingMerges = dedupeUserIdArray(
      lock.pendingMerges,
      sourceUserIds,
      canonicalUserId
    )
    if (normalizedPendingMerges !== lock.pendingMerges) {
      patch.pendingMerges = normalizedPendingMerges
    }
    if (Object.keys(patch).length > 0) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(lock._id, patch)
      }
    }
  }

  const builderRuns = await ctx.db.query("builderRuns").collect()
  for (const run of builderRuns) {
    if (hasUserId(sourceUserIds, run.userId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(run._id, { userId: canonicalUserId })
      }
    }
  }

  const projectFiles = await ctx.db.query("projectFiles").collect()
  for (const file of projectFiles) {
    if (hasUserId(sourceUserIds, file.uploadedBy)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(file._id, { uploadedBy: canonicalUserId })
      }
    }
  }

  const replicaGitRows = await ctx.db.query("projectReplicaGit").collect()
  for (const row of replicaGitRows) {
    if (hasUserId(sourceUserIds, row.updatedBy)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(row._id, { updatedBy: canonicalUserId })
      }
    }
  }

  const replicaSessions = await ctx.db.query("projectReplicaGitSessions").collect()
  for (const session of replicaSessions) {
    if (hasUserId(sourceUserIds, session.userId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(session._id, { userId: canonicalUserId })
      }
    }
  }

  const lfsObjects = await ctx.db.query("projectReplicaLfsObjects").collect()
  for (const object of lfsObjects) {
    if (hasUserId(sourceUserIds, object.createdBy)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(object._id, { createdBy: canonicalUserId })
      }
    }
  }

  const presenceRows = await ctx.db.query("projectPresence").collect()
  for (const presence of presenceRows) {
    if (hasUserId(sourceUserIds, presence.userId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(presence._id, { userId: canonicalUserId })
      }
    }
  }

  const fileChanges = await ctx.db.query("fileChanges").collect()
  for (const change of fileChanges) {
    if (hasUserId(sourceUserIds, change.userId || undefined)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(change._id, { userId: canonicalUserId })
      }
    }
  }

  const conversations = await ctx.db.query("aiConversations").collect()
  for (const conversation of conversations) {
    if (hasUserId(sourceUserIds, conversation.userId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(conversation._id, { userId: canonicalUserId })
      }
    }
  }

  const comments = await ctx.db.query("changeComments").collect()
  for (const comment of comments) {
    if (hasUserId(sourceUserIds, comment.userId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(comment._id, { userId: canonicalUserId })
      }
    }
  }

  const reactions = await ctx.db.query("changeCommentReactions").collect()
  for (const reaction of reactions) {
    if (hasUserId(sourceUserIds, reaction.userId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(reaction._id, { userId: canonicalUserId })
      }
    }
  }

  const assets = await ctx.db.query("projectAssets").collect()
  for (const asset of assets) {
    if (hasUserId(sourceUserIds, asset.uploadedBy)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(asset._id, { uploadedBy: canonicalUserId })
      }
    }
  }

  return { updated }
}

async function repointOrganizationReferences(
  ctx: MutationCtx,
  sourceOrganizationIds: Set<string>,
  canonicalOrganizationId: Id<"organizations">,
  dryRun: boolean
): Promise<{ updated: number }> {
  let updated = 0

  const members = await ctx.db.query("members").collect()
  for (const member of members) {
    if (hasOrganizationId(sourceOrganizationIds, member.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(member._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  const invitations = await ctx.db.query("invitations").collect()
  for (const invite of invitations) {
    if (hasOrganizationId(sourceOrganizationIds, invite.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(invite._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  const integrations = await ctx.db.query("integrations").collect()
  for (const integration of integrations) {
    if (hasOrganizationId(sourceOrganizationIds, integration.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(integration._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  const integrationKeys = await ctx.db.query("integrationKeys").collect()
  for (const keyRow of integrationKeys) {
    if (hasOrganizationId(sourceOrganizationIds, keyRow.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(keyRow._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  const aiUsage = await ctx.db.query("aiUsage").collect()
  for (const usage of aiUsage) {
    if (hasOrganizationId(sourceOrganizationIds, usage.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(usage._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  const aggregates = await ctx.db.query("aiUsageAggregates").collect()
  for (const aggregate of aggregates) {
    if (hasOrganizationId(sourceOrganizationIds, aggregate.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(aggregate._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  const auditLogs = await ctx.db.query("auditLogs").collect()
  for (const log of auditLogs) {
    if (hasOrganizationId(sourceOrganizationIds, log.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(log._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  const approvalRequests = await ctx.db.query("toolApprovalRequests").collect()
  for (const approval of approvalRequests) {
    if (hasOrganizationId(sourceOrganizationIds, approval.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(approval._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  const projects = await ctx.db.query("projects").collect()
  for (const project of projects) {
    if (hasOrganizationId(sourceOrganizationIds, project.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(project._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  const projectTeams = await ctx.db.query("projectTeams").collect()
  for (const team of projectTeams) {
    if (hasOrganizationId(sourceOrganizationIds, team.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(team._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  const builderRuns = await ctx.db.query("builderRuns").collect()
  for (const run of builderRuns) {
    if (hasOrganizationId(sourceOrganizationIds, run.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(run._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  const assets = await ctx.db.query("projectAssets").collect()
  for (const asset of assets) {
    if (hasOrganizationId(sourceOrganizationIds, asset.organizationId)) {
      updated += 1
      if (!dryRun) {
        await ctx.db.patch(asset._id, { organizationId: canonicalOrganizationId })
      }
    }
  }

  return { updated }
}

async function dedupeMembershipRows(
  ctx: MutationCtx,
  dryRun: boolean
): Promise<MembershipDedupResult> {
  let deletedRows = 0
  const updatedRows = 0
  let orphanRowsDeleted = 0

  const [users, organizations, memberships] = await Promise.all([
    ctx.db.query("users").collect(),
    ctx.db.query("organizations").collect(),
    ctx.db.query("members").collect(),
  ])

  const validUserIds = new Set(users.map((user) => idKey(user._id)))
  const validOrganizationIds = new Set(organizations.map((organization) => idKey(organization._id)))

  const nonOrphans: Doc<"members">[] = []
  for (const membership of memberships) {
    const isOrphan =
      !validUserIds.has(idKey(membership.userId)) ||
      !validOrganizationIds.has(idKey(membership.organizationId))
    if (isOrphan) {
      orphanRowsDeleted += 1
      if (!dryRun) {
        await ctx.db.delete(membership._id)
      }
      continue
    }
    nonOrphans.push(membership)
  }

  const byOrgUser = new Map<string, Doc<"members">[]>()
  for (const membership of nonOrphans) {
    const key = `${idKey(membership.organizationId)}::${idKey(membership.userId)}`
    const group = byOrgUser.get(key) || []
    group.push(membership)
    byOrgUser.set(key, group)
  }

  const survivors = new Set<string>()
  for (const group of byOrgUser.values()) {
    if (group.length === 1) {
      survivors.add(idKey(group[0]._id))
      continue
    }
    const canonical = pickCanonicalMembership(group)
    if (!canonical) continue
    survivors.add(idKey(canonical._id))
    for (const duplicate of group) {
      if (duplicate._id === canonical._id) continue
      deletedRows += 1
      if (!dryRun) {
        await ctx.db.delete(duplicate._id)
      }
    }
  }

  const currentRows = dryRun
    ? nonOrphans.filter((row) => survivors.has(idKey(row._id)))
    : await ctx.db.query("members").collect()

  const byWorkosId = new Map<string, Doc<"members">[]>()
  for (const membership of currentRows) {
    const group = byWorkosId.get(membership.workosId) || []
    group.push(membership)
    byWorkosId.set(membership.workosId, group)
  }

  for (const group of byWorkosId.values()) {
    if (group.length <= 1) continue
    const canonical = pickCanonicalMembership(group)
    if (!canonical) continue
    for (const duplicate of group) {
      if (duplicate._id === canonical._id) continue
      deletedRows += 1
      if (!dryRun) {
        await ctx.db.delete(duplicate._id)
      }
    }
  }

  return { deletedRows, updatedRows, orphanRowsDeleted }
}

async function dedupePendingInvitations(
  ctx: MutationCtx,
  dryRun: boolean
): Promise<InvitationDedupResult> {
  let deletedRows = 0
  const invitations = await ctx.db
    .query("invitations")
    .filter((q) => q.eq(q.field("status"), "pending"))
    .collect()

  const groups = new Map<string, Doc<"invitations">[]>()
  for (const invitation of invitations) {
    const key = `${idKey(invitation.organizationId)}::${normalizeEmail(invitation.email)}`
    const group = groups.get(key) || []
    group.push(invitation)
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    if (group.length <= 1) continue
    const canonical = [...group].sort((a, b) => {
      const createdDelta = b.createdAt - a.createdAt
      if (createdDelta !== 0) return createdDelta
      return String(a._id).localeCompare(String(b._id))
    })[0]

    for (const invite of group) {
      if (invite._id === canonical._id) continue
      deletedRows += 1
      if (!dryRun) {
        await ctx.db.delete(invite._id)
      }
    }
  }

  return { deletedRows }
}

async function dedupeProviderIntegrations(
  ctx: MutationCtx,
  dryRun: boolean
): Promise<IntegrationDedupResult> {
  let deletedRows = 0
  const integrations = await ctx.db.query("integrations").collect()

  const groups = new Map<string, Doc<"integrations">[]>()
  for (const integration of integrations) {
    const key = `${idKey(integration.organizationId)}::${integration.provider}`
    const group = groups.get(key) || []
    group.push(integration)
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    if (group.length <= 1) continue

    const canonical = [...group].sort((a, b) => {
      const nonRevokedDelta = Number(b.status !== "revoked") - Number(a.status !== "revoked")
      if (nonRevokedDelta !== 0) return nonRevokedDelta
      const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
      if (updatedDelta !== 0) return updatedDelta
      const connectedDelta = (b.connectedAt || 0) - (a.connectedAt || 0)
      if (connectedDelta !== 0) return connectedDelta
      return String(a._id).localeCompare(String(b._id))
    })[0]

    for (const integration of group) {
      if (integration._id === canonical._id) continue
      deletedRows += 1
      if (!dryRun) {
        await ctx.db.delete(integration._id)
      }
    }
  }

  return { deletedRows }
}

async function ensureUniqueOrganizationSlugs(
  ctx: MutationCtx,
  dryRun: boolean
): Promise<{ updatedRows: number }> {
  let updatedRows = 0
  const organizations = await ctx.db.query("organizations").collect()
  const sorted = [...organizations].sort((a, b) => {
    const createdDelta = a.createdAt - b.createdAt
    if (createdDelta !== 0) return createdDelta
    return String(a._id).localeCompare(String(b._id))
  })

  const used = new Set<string>()
  for (const organization of sorted) {
    const originalSlug = organization.slug || slugify(organization.name)
    let resolvedSlug = slugify(originalSlug)

    if (used.has(resolvedSlug)) {
      resolvedSlug = await resolveUniqueSlug(ctx, `${resolvedSlug}-org`, used)
    } else {
      const existing = await ctx.db
        .query("organizations")
        .withIndex("by_slug", (q) => q.eq("slug", resolvedSlug))
        .collect()
      const foreign = existing.find((row) => row._id !== organization._id)
      if (foreign) {
        resolvedSlug = await resolveUniqueSlug(ctx, `${resolvedSlug}-org`, used)
      }
    }

    used.add(resolvedSlug)
    if (resolvedSlug !== organization.slug) {
      updatedRows += 1
      if (!dryRun) {
        await ctx.db.patch(organization._id, {
          slug: resolvedSlug,
          updatedAt: Date.now(),
        })
      }
    }
  }

  return { updatedRows }
}

async function mergeUserGroup(
  ctx: MutationCtx,
  group: Doc<"users">[],
  preferredWorkosId: string | undefined,
  dryRun: boolean
): Promise<{ mergedCount: number; referencesUpdated: number; rowsDeleted: number }> {
  const canonical = pickCanonicalUser(group, preferredWorkosId)
  if (!canonical) return { mergedCount: 0, referencesUpdated: 0, rowsDeleted: 0 }

  const sourceUsers = group.filter((user) => user._id !== canonical._id)
  if (sourceUsers.length === 0) return { mergedCount: 0, referencesUpdated: 0, rowsDeleted: 0 }

  const sourceSet = new Set(sourceUsers.map((user) => idKey(user._id)))
  const referenceResult = await repointUserReferences(ctx, sourceSet, canonical._id, dryRun)

  let rowsDeleted = 0
  if (!dryRun) {
    for (const source of sourceUsers) {
      await ctx.db.delete(source._id)
      rowsDeleted += 1
    }
  } else {
    rowsDeleted = sourceUsers.length
  }

  return {
    mergedCount: sourceUsers.length,
    referencesUpdated: referenceResult.updated,
    rowsDeleted,
  }
}

async function mergeOrganizationGroup(
  ctx: MutationCtx,
  group: Doc<"organizations">[],
  preferredWorkosId: string | undefined,
  dryRun: boolean
): Promise<{ mergedCount: number; referencesUpdated: number; rowsDeleted: number; slugUpdates: number }> {
  const canonical = pickCanonicalOrganization(group, preferredWorkosId)
  if (!canonical) return { mergedCount: 0, referencesUpdated: 0, rowsDeleted: 0, slugUpdates: 0 }

  const sourceOrganizations = group.filter((organization) => organization._id !== canonical._id)
  if (sourceOrganizations.length === 0) {
    return { mergedCount: 0, referencesUpdated: 0, rowsDeleted: 0, slugUpdates: 0 }
  }

  let slugUpdates = 0
  if (!dryRun) {
    for (const sourceOrganization of sourceOrganizations) {
      if (sourceOrganization.slug === canonical.slug) {
        slugUpdates += 1
        await ctx.db.patch(sourceOrganization._id, {
          slug: `${slugify(canonical.slug || canonical.name)}-merged-${String(sourceOrganization._id).slice(-6)}`,
          updatedAt: Date.now(),
        })
      }
    }
  } else {
    slugUpdates += sourceOrganizations.filter(
      (sourceOrganization) => sourceOrganization.slug === canonical.slug
    ).length
  }

  const sourceSet = new Set(sourceOrganizations.map((organization) => idKey(organization._id)))
  const referenceResult = await repointOrganizationReferences(
    ctx,
    sourceSet,
    canonical._id,
    dryRun
  )

  let rowsDeleted = 0
  if (!dryRun) {
    for (const sourceOrganization of sourceOrganizations) {
      await ctx.db.delete(sourceOrganization._id)
      rowsDeleted += 1
    }
  } else {
    rowsDeleted = sourceOrganizations.length
  }

  return {
    mergedCount: sourceOrganizations.length,
    referencesUpdated: referenceResult.updated,
    rowsDeleted,
    slugUpdates,
  }
}

async function applyMergeUsers(
  ctx: MutationCtx,
  dryRun: boolean,
  maxGroups: number
): Promise<{ processedGroups: number; mergedRows: number; referenceUpdates: number; rowDeletes: number }> {
  let processedGroups = 0
  let mergedRows = 0
  let referenceUpdates = 0
  let rowDeletes = 0

  const usersForWorkosPass = await ctx.db.query("users").collect()
  const workosGroups = buildUserDuplicateGroupsByWorkosId(usersForWorkosPass)
  for (const group of workosGroups) {
    if (processedGroups >= maxGroups) break
    const preferredWorkosId = group[0]?.workosId
    const result = await mergeUserGroup(ctx, group, preferredWorkosId, dryRun)
    if (result.mergedCount > 0) {
      processedGroups += 1
      mergedRows += result.mergedCount
      referenceUpdates += result.referencesUpdated
      rowDeletes += result.rowsDeleted
    }
  }

  if (processedGroups >= maxGroups) {
    return { processedGroups, mergedRows, referenceUpdates, rowDeletes }
  }

  const usersForEmailPass = await ctx.db.query("users").collect()
  const emailGroups = buildUserDuplicateGroupsByNormalizedEmail(usersForEmailPass)
  for (const group of emailGroups) {
    if (processedGroups >= maxGroups) break
    const result = await mergeUserGroup(ctx, group, undefined, dryRun)
    if (result.mergedCount > 0) {
      processedGroups += 1
      mergedRows += result.mergedCount
      referenceUpdates += result.referencesUpdated
      rowDeletes += result.rowsDeleted
    }
  }

  return { processedGroups, mergedRows, referenceUpdates, rowDeletes }
}

async function applyMergeOrganizations(
  ctx: MutationCtx,
  dryRun: boolean,
  maxGroups: number
): Promise<{
  processedGroups: number
  mergedRows: number
  referenceUpdates: number
  rowDeletes: number
  slugUpdates: number
}> {
  let processedGroups = 0
  let mergedRows = 0
  let referenceUpdates = 0
  let rowDeletes = 0
  let slugUpdates = 0

  const organizations = await ctx.db.query("organizations").collect()
  const duplicateGroups = buildOrganizationDuplicateGroupsByWorkosId(organizations)
  for (const group of duplicateGroups) {
    if (processedGroups >= maxGroups) break
    const preferredWorkosId = group[0]?.workosId
    const result = await mergeOrganizationGroup(ctx, group, preferredWorkosId, dryRun)
    if (result.mergedCount > 0) {
      processedGroups += 1
      mergedRows += result.mergedCount
      referenceUpdates += result.referencesUpdated
      rowDeletes += result.rowsDeleted
      slugUpdates += result.slugUpdates
    }
  }

  return { processedGroups, mergedRows, referenceUpdates, rowDeletes, slugUpdates }
}

export const scanDuplicates = mutation({
  args: {
    serverSecret: v.string(),
    sampleLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const runId = await ctx.db.insert("identityRepairRuns", {
      scope: "scan",
      dryRun: true,
      startedAt: Date.now(),
      status: "running",
    })

    try {
      const summary = await collectDuplicateSummary(ctx, args.sampleLimit || DEFAULT_SAMPLE_LIMIT)
      await ctx.db.patch(runId, {
        status: "completed",
        finishedAt: Date.now(),
        summary,
      })
      return { runId, summary }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown identity scan error"
      await ctx.db.patch(runId, {
        status: "failed",
        finishedAt: Date.now(),
        error: message,
      })
      throw error
    }
  },
})

export const mergeUsers = mutation({
  args: {
    serverSecret: v.string(),
    dryRun: v.optional(v.boolean()),
    maxGroups: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const dryRun = args.dryRun ?? false
    const maxGroups = Math.max(1, args.maxGroups || DEFAULT_MAX_USER_GROUPS)
    return applyMergeUsers(ctx, dryRun, maxGroups)
  },
})

export const mergeOrganizations = mutation({
  args: {
    serverSecret: v.string(),
    dryRun: v.optional(v.boolean()),
    maxGroups: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const dryRun = args.dryRun ?? false
    const maxGroups = Math.max(1, args.maxGroups || DEFAULT_MAX_ORG_GROUPS)
    return applyMergeOrganizations(ctx, dryRun, maxGroups)
  },
})

export const reconcileMembershipMirror = mutation({
  args: {
    serverSecret: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const dryRun = args.dryRun ?? false
    const membershipResult = await dedupeMembershipRows(ctx, dryRun)
    const invitationResult = await dedupePendingInvitations(ctx, dryRun)
    const integrationResult = await dedupeProviderIntegrations(ctx, dryRun)
    return {
      membershipResult,
      invitationResult,
      integrationResult,
    }
  },
})

export const runFullRepair = mutation({
  args: {
    serverSecret: v.string(),
    dryRun: v.optional(v.boolean()),
    maxUserGroups: v.optional(v.number()),
    maxOrganizationGroups: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const dryRun = args.dryRun ?? false
    const maxUserGroups = Math.max(1, args.maxUserGroups || DEFAULT_MAX_USER_GROUPS)
    const maxOrganizationGroups = Math.max(1, args.maxOrganizationGroups || DEFAULT_MAX_ORG_GROUPS)

    const runId = await ctx.db.insert("identityRepairRuns", {
      scope: "repair",
      dryRun,
      startedAt: Date.now(),
      status: "running",
    })

    try {
      const counters = emptyRepairCounters()

      const userMergeResult = await applyMergeUsers(ctx, dryRun, maxUserGroups)
      counters.processedUserGroups = userMergeResult.processedGroups
      counters.mergedUsers = userMergeResult.mergedRows
      counters.referencesUpdated += userMergeResult.referenceUpdates
      counters.rowsDeleted += userMergeResult.rowDeletes

      const orgMergeResult = await applyMergeOrganizations(ctx, dryRun, maxOrganizationGroups)
      counters.processedOrganizationGroups = orgMergeResult.processedGroups
      counters.mergedOrganizations = orgMergeResult.mergedRows
      counters.referencesUpdated += orgMergeResult.referenceUpdates
      counters.rowsDeleted += orgMergeResult.rowDeletes
      counters.slugUpdates += orgMergeResult.slugUpdates

      const membershipResult = await dedupeMembershipRows(ctx, dryRun)
      counters.membershipRowsDeleted = membershipResult.deletedRows
      counters.rowsDeleted += membershipResult.deletedRows + membershipResult.orphanRowsDeleted

      const invitationResult = await dedupePendingInvitations(ctx, dryRun)
      counters.invitationRowsDeleted = invitationResult.deletedRows
      counters.rowsDeleted += invitationResult.deletedRows

      const integrationResult = await dedupeProviderIntegrations(ctx, dryRun)
      counters.integrationRowsDeleted = integrationResult.deletedRows
      counters.rowsDeleted += integrationResult.deletedRows

      const slugResult = await ensureUniqueOrganizationSlugs(ctx, dryRun)
      counters.slugUpdates += slugResult.updatedRows

      const postSummary = await collectDuplicateSummary(ctx, DEFAULT_SAMPLE_LIMIT)
      const fullSummary = {
        counters,
        postSummary,
      }

      await ctx.db.patch(runId, {
        status: "completed",
        finishedAt: Date.now(),
        summary: fullSummary,
      })

      return { runId, ...fullSummary }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown identity repair error"
      await ctx.db.patch(runId, {
        status: "failed",
        finishedAt: Date.now(),
        error: message,
      })
      throw error
    }
  },
})

// Daily invariant scan with persisted summary for operations visibility.
export const runInvariantCheckDaily = internalMutation({
  args: {},
  handler: async (ctx) => {
    const runId = await ctx.db.insert("identityRepairRuns", {
      scope: "scan",
      dryRun: true,
      startedAt: Date.now(),
      status: "running",
    })

    try {
      const summary = await collectDuplicateSummary(ctx, DEFAULT_SAMPLE_LIMIT)
      const duplicateCounts = {
        duplicateUsersByWorkosId: summary.users.duplicateByWorkosId.length,
        duplicateUsersByNormalizedEmail: summary.users.duplicateByNormalizedEmail.length,
        duplicateOrganizationsByWorkosId: summary.organizations.duplicateByWorkosId.length,
        duplicateOrganizationsBySlug: summary.organizations.duplicateBySlug.length,
        duplicateMembershipsByOrganizationUser: summary.memberships.duplicateByOrganizationUser.length,
        duplicateMembershipsByWorkosId: summary.memberships.duplicateByWorkosId.length,
        orphanMembershipRows: summary.memberships.orphanRows,
      }

      if (
        duplicateCounts.duplicateUsersByWorkosId > 0 ||
        duplicateCounts.duplicateUsersByNormalizedEmail > 0 ||
        duplicateCounts.duplicateOrganizationsByWorkosId > 0 ||
        duplicateCounts.duplicateOrganizationsBySlug > 0 ||
        duplicateCounts.duplicateMembershipsByOrganizationUser > 0 ||
        duplicateCounts.duplicateMembershipsByWorkosId > 0 ||
        duplicateCounts.orphanMembershipRows > 0
      ) {
        console.warn("Identity invariant check detected duplicate rows", duplicateCounts)
      }

      await ctx.db.patch(runId, {
        status: "completed",
        finishedAt: Date.now(),
        summary: {
          duplicateCounts,
          details: summary,
        },
      })

      return {
        runId,
        duplicateCounts,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown identity invariant error"
      await ctx.db.patch(runId, {
        status: "failed",
        finishedAt: Date.now(),
        error: message,
      })
      throw error
    }
  },
})

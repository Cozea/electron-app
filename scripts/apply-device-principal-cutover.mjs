import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function p(...parts) {
  return path.join(root, ...parts)
}

function read(rel) {
  return fs.readFileSync(p(rel), 'utf8')
}

function write(rel, content) {
  fs.mkdirSync(path.dirname(p(rel)), { recursive: true })
  fs.writeFileSync(p(rel), content)
}

function remove(rel) {
  fs.rmSync(p(rel), { force: true })
}

function replaceRequired(text, from, to, label = from) {
  if (!text.includes(from)) throw new Error(`Missing required anchor: ${label}`)
  return text.replace(from, to)
}

function removeFunction(text, startAnchor, endAnchor) {
  const start = text.indexOf(startAnchor)
  if (start < 0) return text
  const end = text.indexOf(endAnchor, start)
  if (end < 0) throw new Error(`Missing end anchor ${endAnchor} after ${startAnchor}`)
  return text.slice(0, start) + text.slice(end)
}

function replaceDefineTable(text, tableName, replacement = '') {
  const anchor = `  ${tableName}: defineTable(`
  const start = text.indexOf(anchor)
  if (start < 0) throw new Error(`Schema table not found: ${tableName}`)
  const tablePattern = /\n  [A-Za-z_][A-Za-z0-9_]*: defineTable\(/g
  tablePattern.lastIndex = start + anchor.length
  const next = tablePattern.exec(text)
  if (!next) throw new Error(`Could not find table after ${tableName}`)
  return text.slice(0, start) + replacement + text.slice(next.index + 1)
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'out', '.git', 'vendor'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function globalCodeRenames() {
  const roots = ['apps', 'convex', 'cloudflare', 'shared', 'tests', 'scripts']
  const files = roots.flatMap((dir) => walk(p(dir))).filter((file) => /\.(ts|tsx|js|mjs)$/.test(file))
  for (const file of files) {
    if (file.endsWith('scripts/apply-device-principal-cutover.mjs')) continue
    let text = fs.readFileSync(file, 'utf8')
    const original = text
    text = text
      .replace(/Id<"users">/g, 'Id<"devicePrincipals">')
      .replace(/Id<'users'>/g, "Id<'devicePrincipals'>")
      .replace(/Doc<"users">/g, 'Doc<"devicePrincipals">')
      .replace(/Doc<'users'>/g, "Doc<'devicePrincipals'>")
      .replace(/v\.id\("users"\)/g, 'v.id("devicePrincipals")')
      .replace(/v\.id\('users'\)/g, "v.id('devicePrincipals')")
      .replace(/\.query\("users"\)/g, '.query("devicePrincipals")')
      .replace(/\.query\('users'\)/g, ".query('devicePrincipals')")
      .replace(/\.insert\("users",/g, '.insert("devicePrincipals",')
      .replace(/\.insert\('users',/g, ".insert('devicePrincipals',")
      .replace(/api\.users\./g, 'api.devicePrincipals.')
      .replace(/unsafeUsersApi\.users\./g, 'unsafeUsersApi.devicePrincipals.')
      .replace(/['"]users:/g, (match) => `${match[0]}devicePrincipals:`)
      .replace(/\bconvexUserId\b/g, 'principalId')
    if (text !== original) fs.writeFileSync(file, text)
  }
}

const principalTable = `  devicePrincipals: defineTable({
    identityKey: v.string(),
    displayName: v.string(),
    avatarStorageId: v.optional(v.id("_storage")),
    platform: v.string(),
    encryptionPublicKeyJwk: v.string(),
    encryptionPublicKeyAlgorithm: v.string(),
    encryptionFingerprint: v.string(),
    signingPublicKeyJwk: v.string(),
    signingPublicKeyAlgorithm: v.string(),
    signingFingerprint: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    signingKeyVersion: v.number(),
    tokenValidAfter: v.number(),
    lastAuthenticatedAt: v.number(),
    revokedAt: v.optional(v.number()),
    revocationReason: v.optional(v.string()),
    preferences: v.optional(
      v.object({
        theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
        defaultModel: v.optional(v.string()),
        pushNotifications: v.optional(v.boolean()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_identity_key", ["identityKey"]),

`

const projectEnrollmentTable = `  projectDeviceEnrollments: defineTable({
    projectId: v.id("projects"),
    targetIdentityKey: v.string(),
    role: v.union(v.literal("project_manager"), v.literal("developer"), v.literal("designer"), v.literal("viewer")),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("cancelled"),
      v.literal("expired"),
    ),
    createdBy: v.id("devicePrincipals"),
    createdAt: v.number(),
    expiresAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_project_and_status", ["projectId", "status"])
    .index("by_target_and_status", ["targetIdentityKey", "status"]),

`

function rewriteSchema() {
  let text = read('convex/schema.ts')
  text = replaceDefineTable(text, 'users', principalTable)
  for (const name of ['projectInvites', 'organizationInvites', 'projectTrustedDevices', 'collabDevices']) {
    text = replaceDefineTable(text, name, '')
  }
  const joinAnchor = '  projectJoinLinks: defineTable('
  if (!text.includes(joinAnchor)) throw new Error('projectJoinLinks anchor missing')
  text = text.replace(joinAnchor, projectEnrollmentTable + joinAnchor)
  text = text.replace(/\n\s*contactEmail: v\.optional\(v\.string\(\)\),/g, '')
  text = text.replace(/\n\s*workosId: v\.optional\(v\.string\(\)\),/g, '')
  text = text.replace(/\n\s*userEmail: v\.string\(\),/g, '')
  text = text.replace(/\n\s*email: v\.optional\(v\.string\(\)\),/g, '')
  text = text.replace(/\n\s*emailNotifications: v\.optional\(v\.boolean\(\)\),/g, '')
  text = text.replace(/\n\s*radonToken: v\.optional\(v\.string\(\)\),/g, '')
  write('convex/schema.ts', text)
}

const devicePrincipalsSource = `import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { ConvexError, v } from "convex/values"
import { isDeviceIdentityKey, normalizeDeviceIdentityKey } from "../shared/deviceIdentity"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"

function requireServerSecret(serverSecret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || serverSecret !== expected) throw new ConvexError("Unauthorized")
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new ConvexError("Device name cannot be blank")
  if (normalized.length > 80) throw new ConvexError("Device name cannot exceed 80 characters")
  return normalized
}

const CHALLENGE_WINDOW_MS = 10 * 60 * 1_000
const MAX_IDENTITY_CHALLENGES_PER_WINDOW = 12
const MAX_FINGERPRINT_CHALLENGES_PER_WINDOW = 30
const MAX_AVATAR_BYTES = 512 * 1024

export const createDeviceAuthChallengeFromServer = mutation({
  args: {
    serverSecret: v.string(), nonce: v.string(), identityKey: v.string(),
    requestFingerprint: v.optional(v.string()), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    if (!isDeviceIdentityKey(identityKey) || args.expiresAt <= now || args.expiresAt > now + 5 * 60_000) {
      throw new ConvexError("Invalid device challenge")
    }
    const existing = await ctx.db.query("deviceAuthChallenges")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce)).unique()
    if (existing) throw new ConvexError("Challenge nonce already exists")
    const identityAttempts = await ctx.db.query("deviceAuthChallenges")
      .withIndex("by_identity_and_created_at", (q) =>
        q.eq("identityKey", identityKey).gte("createdAt", now - CHALLENGE_WINDOW_MS))
      .take(MAX_IDENTITY_CHALLENGES_PER_WINDOW)
    if (identityAttempts.length >= MAX_IDENTITY_CHALLENGES_PER_WINDOW) {
      throw new ConvexError("Too many device authentication attempts")
    }
    if (args.requestFingerprint) {
      const attempts = await ctx.db.query("deviceAuthChallenges")
        .withIndex("by_fingerprint_and_created_at", (q) =>
          q.eq("requestFingerprint", args.requestFingerprint!).gte("createdAt", now - CHALLENGE_WINDOW_MS))
        .take(MAX_FINGERPRINT_CHALLENGES_PER_WINDOW)
      if (attempts.length >= MAX_FINGERPRINT_CHALLENGES_PER_WINDOW) {
        throw new ConvexError("Too many device authentication attempts")
      }
    }
    await ctx.db.insert("deviceAuthChallenges", {
      nonce: args.nonce, identityKey, requestFingerprint: args.requestFingerprint,
      createdAt: now, expiresAt: args.expiresAt,
    })
    return { created: true }
  },
})

export const consumeDeviceAuthChallengeFromServer = mutation({
  args: { serverSecret: v.string(), nonce: v.string(), identityKey: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    const challenge = await ctx.db.query("deviceAuthChallenges")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce)).unique()
    if (!challenge || challenge.identityKey !== identityKey || challenge.consumedAt !== undefined || challenge.expiresAt <= Date.now()) {
      throw new ConvexError("Device challenge is expired, consumed, or invalid")
    }
    const now = Date.now()
    await ctx.db.patch(challenge._id, { consumedAt: now })
    await ctx.db.insert("identitySecurityEvents", {
      identityKey, actorIdentityKey: identityKey,
      eventType: "device.challenge_consumed", createdAt: now,
    })
    return { consumed: true }
  },
})

export const ensureDevicePrincipalFromServer = mutation({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
    platform: v.string(),
    encryptionPublicKeyJwk: v.string(),
    encryptionPublicKeyAlgorithm: v.string(),
    encryptionFingerprint: v.string(),
    signingPublicKeyJwk: v.string(),
    signingPublicKeyAlgorithm: v.string(),
    signingFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    if (!isDeviceIdentityKey(identityKey)) throw new ConvexError("Invalid device identity ID")

    let principal = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey)).unique()
    if (principal) {
      if (principal.status === "revoked") throw new ConvexError("This device identity has been revoked")
      if (principal.signingFingerprint !== args.signingFingerprint || principal.signingPublicKeyJwk !== args.signingPublicKeyJwk) {
        throw new ConvexError("This device ID is already bound to another signing key")
      }
      await ctx.db.patch(principal._id, {
        platform: args.platform.trim() || "desktop",
        encryptionPublicKeyJwk: args.encryptionPublicKeyJwk,
        encryptionPublicKeyAlgorithm: args.encryptionPublicKeyAlgorithm,
        encryptionFingerprint: args.encryptionFingerprint,
        lastAuthenticatedAt: now,
        updatedAt: now,
      })
      principal = (await ctx.db.get(principal._id))!
    } else {
      const principalId = await ctx.db.insert("devicePrincipals", {
        identityKey,
        displayName: "This Device",
        platform: args.platform.trim() || "desktop",
        encryptionPublicKeyJwk: args.encryptionPublicKeyJwk,
        encryptionPublicKeyAlgorithm: args.encryptionPublicKeyAlgorithm,
        encryptionFingerprint: args.encryptionFingerprint,
        signingPublicKeyJwk: args.signingPublicKeyJwk,
        signingPublicKeyAlgorithm: args.signingPublicKeyAlgorithm,
        signingFingerprint: args.signingFingerprint,
        status: "active",
        signingKeyVersion: 1,
        tokenValidAfter: now,
        lastAuthenticatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      principal = (await ctx.db.get(principalId))!
    }

    const avatarUrl = principal.avatarStorageId ? await ctx.storage.getUrl(principal.avatarStorageId) : null
    const workspaceName = \`\${principal.displayName} Workspace\`
    return {
      principalId: principal._id,
      user: {
        principalId: String(principal._id),
        identityKey: principal.identityKey,
        displayName: principal.displayName,
        avatarUrl,
        platform: principal.platform,
      },
      personalWorkspace: {
        id: \`local-membership:\${identityKey}\`,
        workspaceId: \`local:\${identityKey}\`,
        workspaceName,
        organizationId: \`local:\${identityKey}\`,
        organizationName: workspaceName,
        role: "admin" as const,
        status: "active" as const,
        workspaceType: "personal" as const,
      },
      authentication: {
        status: "active" as const,
        signingKeyVersion: principal.signingKeyVersion,
        tokenValidAfter: principal.tokenValidAfter,
      },
    }
  },
})

export const getDevicePrincipalForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    const principal = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey)).unique()
    if (!principal || principal.status !== "active") return null
    return {
      principalId: principal._id,
      identityKey: principal.identityKey,
      displayName: principal.displayName,
      platform: principal.platform,
      encryptionPublicKeyJwk: principal.encryptionPublicKeyJwk,
      encryptionPublicKeyAlgorithm: principal.encryptionPublicKeyAlgorithm,
      encryptionFingerprint: principal.encryptionFingerprint,
      signingFingerprint: principal.signingFingerprint,
      status: "active" as const,
      signingKeyVersion: principal.signingKeyVersion,
      tokenValidAfter: principal.tokenValidAfter,
    }
  },
})

export const getById = query({
  args: { principalId: v.id("devicePrincipals") },
  handler: async (ctx, args) => {
    const current = await requireAuthenticatedDevice(ctx)
    if (current._id !== args.principalId) {
      // Project-scoped callers use dedicated enriched queries; this endpoint is
      // intentionally self-only so it never becomes a principal directory.
      throw new ConvexError("Principal lookup is self-only")
    }
    const avatarUrl = current.avatarStorageId ? await ctx.storage.getUrl(current.avatarStorageId) : null
    return { ...current, avatarUrl }
  },
})

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const avatarUrl = principal.avatarStorageId ? await ctx.storage.getUrl(principal.avatarStorageId) : null
    return {
      principalId: principal._id,
      identityKey: principal.identityKey,
      displayName: principal.displayName,
      avatarUrl,
      platform: principal.platform,
      preferences: principal.preferences,
      status: principal.status,
    }
  },
})

export const revokeCurrentDevice = mutation({
  args: { reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const now = Date.now()
    await ctx.db.patch(principal._id, {
      status: "revoked",
      signingKeyVersion: principal.signingKeyVersion + 1,
      tokenValidAfter: now,
      revokedAt: now,
      revocationReason: args.reason?.trim().slice(0, 200) || "self_revoked",
      updatedAt: now,
    })
    await ctx.db.insert("identitySecurityEvents", {
      identityKey: principal.identityKey,
      actorIdentityKey: principal.identityKey,
      eventType: "device.self_revoked",
      createdAt: now,
    })
    return { revoked: true }
  },
})

export const updateDevicePresentation = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const displayName = normalizeDisplayName(args.displayName)
    await ctx.db.patch(principal._id, { displayName, updatedAt: Date.now() })
    return { identityKey: principal.identityKey, displayName }
  },
})

export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticatedDevice(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

export const setAvatar = mutation({
  args: { storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const previous = principal.avatarStorageId
    if (args.storageId) {
      const metadata = await ctx.db.system.get("_storage", args.storageId)
      if (!metadata) throw new ConvexError("Uploaded avatar is unavailable")
      if (metadata.size > MAX_AVATAR_BYTES) throw new ConvexError("Avatar is too large")
      if (!metadata.contentType?.startsWith("image/")) throw new ConvexError("Avatar must be an image")
    }
    await ctx.db.patch(principal._id, {
      avatarStorageId: args.storageId ?? undefined,
      updatedAt: Date.now(),
    })
    if (previous && previous !== args.storageId) await ctx.storage.delete(previous)
    return { avatarUrl: args.storageId ? await ctx.storage.getUrl(args.storageId) : null }
  },
})

export const updatePreferences = mutation({
  args: {
    preferences: v.object({
      theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
      defaultModel: v.optional(v.string()),
      pushNotifications: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    await ctx.db.patch(principal._id, {
      preferences: { ...principal.preferences, ...args.preferences },
      updatedAt: Date.now(),
    })
  },
})
`

function rewritePrincipalModule() {
  remove('convex/users.ts')
  write('convex/devicePrincipals.ts', devicePrincipalsSource)
}

const projectSharingSource = `import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type ProjectSharingCtx = Pick<QueryCtx | MutationCtx, "db">

export async function getProjectMembership(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">,
  userId: Id<"devicePrincipals">,
) {
  return await ctx.db.query("projectMembers")
    .withIndex("by_project_and_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .first()
}

export async function requireProjectManagerMembership(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  userId: Id<"devicePrincipals">,
  errorMessage = "Only project managers can manage project sharing",
) {
  const membership = await getProjectMembership(ctx, projectId, userId)
  if (!membership || membership.role !== "project_manager") throw new Error(errorMessage)
  return membership
}

export async function getProjectShareScope(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">,
): Promise<{ project: Doc<"projects"> }> {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") throw new Error("Project not found")
  return { project }
}

export async function assertPersonalProjectShareScope(ctx: ProjectSharingCtx, projectId: Id<"projects">) {
  return await getProjectShareScope(ctx, projectId)
}
`

function rewriteProjectSharing() {
  write('convex/lib/projectSharing.ts', projectSharingSource)
}

const projectEnrollmentsSource = `import { ConvexError, v } from "convex/values"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { isDeviceIdentityKey, normalizeDeviceIdentityKey } from "../shared/deviceIdentity"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { getProjectMembership, requireProjectManagerMembership } from "./lib/projectSharing"

const ENROLLMENT_TTL_MS = 7 * 24 * 60 * 60_000

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    identityKey: v.string(),
    role: v.union(v.literal("project_manager"), v.literal("developer"), v.literal("designer"), v.literal("viewer")),
  },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedDevice(ctx)
    await requireProjectManagerMembership(ctx, args.projectId, actor._id)
    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    if (!isDeviceIdentityKey(identityKey)) throw new ConvexError("Enter a valid Cozea device ID")
    const target = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey)).unique()
    if (!target || target.status !== "active") throw new ConvexError("That device has not initialized Cozea")
    if (await getProjectMembership(ctx, args.projectId, target._id)) throw new ConvexError("That device already has access")
    const existing = await ctx.db.query("projectDeviceEnrollments")
      .withIndex("by_target_and_status", (q) => q.eq("targetIdentityKey", identityKey).eq("status", "pending"))
      .filter((q) => q.eq(q.field("projectId"), args.projectId)).first()
    if (existing && existing.expiresAt > Date.now()) return { enrollmentId: existing._id, created: false }
    const now = Date.now()
    const enrollmentId = await ctx.db.insert("projectDeviceEnrollments", {
      projectId: args.projectId,
      targetIdentityKey: identityKey,
      role: args.role,
      status: "pending",
      createdBy: actor._id,
      createdAt: now,
      expiresAt: now + ENROLLMENT_TTL_MS,
    })
    return { enrollmentId, created: true }
  },
})

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedDevice(ctx)
    await requireProjectManagerMembership(ctx as never, args.projectId, actor._id)
    return await ctx.db.query("projectDeviceEnrollments")
      .withIndex("by_project_and_status", (q) => q.eq("projectId", args.projectId).eq("status", "pending"))
      .collect()
  },
})

export const listIncoming = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const rows = await ctx.db.query("projectDeviceEnrollments")
      .withIndex("by_target_and_status", (q) => q.eq("targetIdentityKey", principal.identityKey).eq("status", "pending"))
      .collect()
    return await Promise.all(rows.filter((row) => row.expiresAt > Date.now()).map(async (row) => {
      const [project, inviter] = await Promise.all([ctx.db.get(row.projectId), ctx.db.get(row.createdBy)])
      return {
        ...row,
        projectName: project?.name ?? "Unknown project",
        inviterName: inviter?.displayName ?? "Unknown device",
      }
    }))
  },
})

export const resolve = mutation({
  args: { enrollmentId: v.id("projectDeviceEnrollments"), accept: v.boolean() },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const enrollment = await ctx.db.get(args.enrollmentId)
    if (!enrollment || enrollment.status !== "pending" || enrollment.targetIdentityKey !== principal.identityKey) {
      throw new ConvexError("Enrollment is not available to this device")
    }
    const now = Date.now()
    if (enrollment.expiresAt <= now) {
      await ctx.db.patch(enrollment._id, { status: "expired", resolvedAt: now })
      throw new ConvexError("Enrollment has expired")
    }
    if (!args.accept) {
      await ctx.db.patch(enrollment._id, { status: "rejected", resolvedAt: now })
      return { accepted: false }
    }
    const existing = await getProjectMembership(ctx, enrollment.projectId, principal._id)
    if (!existing) {
      await ctx.db.insert("projectMembers", {
        projectId: enrollment.projectId,
        userId: principal._id,
        role: enrollment.role,
        addedAt: now,
        addedBy: enrollment.createdBy,
      })
    }
    await ctx.db.patch(enrollment._id, { status: "accepted", resolvedAt: now })
    return { accepted: true, projectId: enrollment.projectId }
  },
})

export const cancel = mutation({
  args: { enrollmentId: v.id("projectDeviceEnrollments") },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedDevice(ctx)
    const enrollment = await ctx.db.get(args.enrollmentId)
    if (!enrollment || enrollment.status !== "pending") throw new ConvexError("Enrollment not found")
    await requireProjectManagerMembership(ctx, enrollment.projectId, actor._id)
    await ctx.db.patch(enrollment._id, { status: "cancelled", resolvedAt: Date.now() })
    return { cancelled: true }
  },
})
`

function addProjectEnrollments() {
  write('convex/projectDeviceEnrollments.ts', projectEnrollmentsSource)
  remove('convex/projectInvites.ts')
  remove('convex/organizationInvites.ts')
}

function rewriteProjects() {
  let text = read('convex/projects.ts')
  text = text.replace(/import \{[\s\S]*?\} from "\.\/lib\/projectSharing"\n/, '')
  text = text.replace(/type ProjectTeamSeedMember = \{[\s\S]*?\n\}\n\n/, '')
  text = removeFunction(text, 'async function seedProjectTeamAccess(', 'function buildImportedFrom(')
  text = text.replace(/\n\s*team: v\.optional\([\s\S]*?\n\s*\),\n\s*repoSource:/, '\n    repoSource:')
  text = text.replace(/\n\s*await seedProjectTeamAccess\([\s\S]*?\n\s*\}\)\n/g, '\n')
  text = text.replace(/\n\s*case 10: \{[\s\S]*?projectTrustedDevices[\s\S]*?\n\s*\}/g, '')
  write('convex/projects.ts', text)
}

function rewriteProjectMembers() {
  let text = read('convex/projectMembers.ts')
  text = text.replace(/import \{[\s\S]*?\} from "\.\/lib\/projectSharing"\n/, '')
  text = text.replace(/function isLocalDeviceEmail[\s\S]*?\n\}\n\n/, '')
  text = text.replace(/function buildTrustedDeviceSecondaryLabel[\s\S]*?\n\}\n\n/, '')
  const listStart = text.indexOf('export const listMembers = query({')
  const next = text.indexOf('// Get member\'s role in a project', listStart)
  if (listStart < 0 || next < 0) throw new Error('projectMembers listMembers anchors missing')
  const listMembers = `export const listMembers = query({
  args: { projectId: v.id("projects"), viewerUserId: v.id("devicePrincipals") },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProjectByWorkspaceOrMembership(ctx, args.projectId, args.viewerUserId)
    if (!canAccess) return []
    const memberships = await ctx.db.query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect()
    return await Promise.all(memberships.map(async (membership) => {
      const principal = await ctx.db.get(membership.userId)
      return {
        ...membership,
        displayName: principal?.displayName ?? "Unknown device",
        identityKey: principal?.identityKey ?? "",
        platform: principal?.platform ?? "unknown",
        avatarUrl: principal?.avatarStorageId ? await ctx.storage.getUrl(principal.avatarStorageId) : null,
      }
    }))
  },
})

`
  text = text.slice(0, listStart) + listMembers + text.slice(next)
  text = text.replace(/\n\s*const contactEmail = user\.email[\s\S]*?\n\s*const now = Date\.now\(\)/, '\n    const now = Date.now()')
  text = text.replace(/\n\s*contactEmail,\n/g, '\n')
  text = text.replace(/\n\s*await syncTrustedDevicesRoleForUser\([\s\S]*?\n\s*\}\)\n/g, '\n')
  text = text.replace(/\n\s*await revokeTrustedDevicesForUser\([\s\S]*?\n\s*\}\)\n/g, '\n')
  text = text.replace(/[\s\S]*?const trustedDevice = args\.deviceId[\s\S]*?return \{\n\s*canAccess: Boolean\(trustedDevice\) \|\| canAccess,\n\s*canEdit: trustedDevice \? trustedDevice\.role !== "viewer" : canEdit,\n\s*\}/, (match) => {
    const prefix = match.slice(0, match.indexOf('const trustedDevice'))
    return `${prefix}const [canAccess, canEdit] = await Promise.all([\n      canAccessProjectByWorkspaceOrMembership(ctx, args.projectId, args.userId),\n      canEditProjectByWorkspaceOrMembership(ctx, args.projectId, args.userId),\n    ])\n\n    return { canAccess, canEdit }`
  })
  write('convex/projectMembers.ts', text)
}

function rewriteSharedTypes() {
  let text = read('shared/types.ts')
  text = text.replace(/export interface User \{[\s\S]*?\n\}/, `export interface User {
  principalId: string
  identityKey: string
  displayName: string
  avatarUrl: string | null
  platform: string
}`)
  write('shared/types.ts', text)

  text = read('shared/desktopBootstrapTypes.ts')
  text = text.replace(/convexUserId: string/g, 'principalId: string')
  write('shared/desktopBootstrapTypes.ts', text)
}

function rewriteGeneratedApi() {
  let text = read('convex/_generated/api.d.ts')
  text = text
    .replace('import type * as organizationInvites from "../organizationInvites.js";\n', '')
    .replace('import type * as projectInvites from "../projectInvites.js";\n', '')
    .replace('import type * as users from "../users.js";\n', 'import type * as devicePrincipals from "../devicePrincipals.js";\n')
    .replace('import type * as projectJoinLinks from "../projectJoinLinks.js";\n', 'import type * as projectDeviceEnrollments from "../projectDeviceEnrollments.js";\nimport type * as projectJoinLinks from "../projectJoinLinks.js";\n')
    .replace('  organizationInvites: typeof organizationInvites;\n', '')
    .replace('  projectInvites: typeof projectInvites;\n', '')
    .replace('  users: typeof users;\n', '  devicePrincipals: typeof devicePrincipals;\n')
    .replace('  projectJoinLinks: typeof projectJoinLinks;\n', '  projectDeviceEnrollments: typeof projectDeviceEnrollments;\n  projectJoinLinks: typeof projectJoinLinks;\n')
  write('convex/_generated/api.d.ts', text)
}

function cleanupAccountEraHelpers() {
  remove('apps/desktop/src/lib/userDisplay.ts')
  remove('apps/desktop/src/features/projects/pages/ProjectInvitePage.tsx')
}

rewriteSchema()
rewritePrincipalModule()
rewriteProjectSharing()
addProjectEnrollments()
rewriteProjects()
rewriteProjectMembers()
rewriteSharedTypes()
globalCodeRenames()
rewriteGeneratedApi()
cleanupAccountEraHelpers()

console.log('Applied device-principal identity cutover codemod.')

import { ConvexError, v } from "convex/values"

import { partsForPublishedRuntimeKind, type DevAppParts } from "../shared/devAppParts"
import { validateDevAppRuntimeReleaseImage, type DevAppRuntimeReleaseImage } from "../shared/devAppContainedRuntime"

import type { Doc, Id } from "./_generated/dataModel"
import { type MutationCtx, type QueryCtx } from "./_generated/server"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { canEditProject } from "./lib/projectAccess"
import { isOrgMember, requireOrgAdmin, requireOrgMember, toConsumerDevApp } from "./lib/orgAccess"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { resolvePublicationReferenceRecord } from "./lib/devAppReferenceResolution"
import { normalizeStorageSha256 } from "./lib/storageHash"
import { orgDevAppArtifactLimits, ORG_DEVAPP_UPLOAD_RESERVATION_TTL_MS } from "../shared/orgDevAppLimits"

const DEVAPP_NAME_MAX_LENGTH = 80
const DEVAPP_DESCRIPTION_MAX_LENGTH = 500
const DEVAPP_LOGO_MAX_LENGTH = 128 * 1024
const DEVAPP_FRAMEWORK_MAX_LENGTH = 80
const DEVAPP_ENTRY_PATH_MAX_LENGTH = 512
const DEVAPP_RELEASE_RETENTION = 10

type ReadDatabaseCtx = Pick<QueryCtx | MutationCtx, "db">

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new ConvexError(`${fieldName} cannot be blank`)
  }
  return normalized
}

function normalizeBoundedText(value: string, fieldName: string, maxLength: number): string {
  const normalized = normalizeRequiredText(value, fieldName)
  if (normalized.length > maxLength) {
    throw new ConvexError(`${fieldName} must be ${maxLength} characters or fewer`)
  }
  return normalized
}

function normalizeContentHash(value: string): string {
  const normalized = normalizeRequiredText(value, "contentHash").toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ConvexError("contentHash must be a SHA-256 digest")
  }
  return normalized
}

function normalizeSha256Digest(value: string, fieldName: string): string {
  const normalized = normalizeRequiredText(value, fieldName).toLowerCase()
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) {
    throw new ConvexError(`${fieldName} must be a SHA-256 digest`)
  }
  return normalized
}

function assertServerSecret(value: string): void {
  if (!process.env.AI_GATEWAY_SECRET || value !== process.env.AI_GATEWAY_SECRET) {
    throw new ConvexError("Unauthorized")
  }
}

function normalizeRuntimeBuildId(value: string): string {
  const normalized = normalizeRequiredText(value, "buildId")
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
    throw new ConvexError("The DevApp runtime build ID is invalid")
  }
  return normalized
}

async function getPublicationForProject(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
): Promise<Doc<"devAppPublications"> | null> {
  return await ctx.db
    .query("devAppPublications")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first()
}

async function getActiveRelease(
  ctx: ReadDatabaseCtx,
  publication: Doc<"devAppPublications">,
): Promise<Doc<"devAppReleases"> | null> {
  if (!publication.activeReleaseId) return null
  const release = await ctx.db.get(publication.activeReleaseId)
  if (!release || release.publicationId !== publication._id) return null
  return release
}

function toConsumerRow(
  publication: Doc<"devAppPublications">,
  release: Doc<"devAppReleases">,
  organizationName: string,
) {
  if (!release.artifactStorageId || !release.contentHash) {
    return null
  }
  if (!publication.organizationId || publication.visibility !== "organization") {
    return null
  }
  if (publication.status !== "active") {
    return null
  }
  return toConsumerDevApp({ publication, release, organizationName })
}

export const createUploadReservation = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canEditProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("You do not have permission to publish this project as a DevApp")
    }
    const project = await ctx.db.get(args.projectId)
    if (!project?.organizationId || project.status === "deleted") {
      throw new ConvexError("Attach this project to an organization before publishing")
    }
    await requireOrgMember(ctx, project.organizationId, user._id)
    const now = Date.now()
    const reservationId = await ctx.db.insert("devAppArtifactUploads", {
      projectId: args.projectId,
      organizationId: project.organizationId,
      createdBy: user._id,
      expiresAt: now + ORG_DEVAPP_UPLOAD_RESERVATION_TTL_MS,
      createdAt: now,
    })
    return {
      reservationId,
      uploadUrl: await ctx.storage.generateUploadUrl(),
      expiresAt: now + ORG_DEVAPP_UPLOAD_RESERVATION_TTL_MS,
    }
  },
})

export const registerUploadedArtifact = mutation({
  args: {
    reservationId: v.id("devAppArtifactUploads"),
    storageId: v.id("_storage"),
    contentHash: v.string(),
    runtimeKind: v.union(v.literal("static"), v.literal("service")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const reservation = await ctx.db.get(args.reservationId)
    if (
      !reservation ||
      reservation.createdBy !== user._id ||
      reservation.expiresAt <= Date.now() ||
      reservation.storageId
    ) {
      throw new ConvexError("The DevApp upload reservation is invalid or expired")
    }
    const contentHash = normalizeContentHash(args.contentHash)
    const metadata = await ctx.db.system.get("_storage", args.storageId)
    if (!metadata) throw new ConvexError("The uploaded DevApp artifact is unavailable")
    await ctx.db.patch(args.reservationId, {
      storageId: args.storageId,
      contentHash,
      sizeBytes: metadata.size,
      runtimeKind: args.runtimeKind,
    })
    if (metadata.size > orgDevAppArtifactLimits(args.runtimeKind).maxCompressedBytes) {
      return { registered: false, error: "The uploaded DevApp artifact exceeds the size limit" }
    }
    if (metadata.contentType !== "application/zip") {
      return {
        registered: false,
        error: "The uploaded DevApp artifact has an invalid content type",
      }
    }
    if (normalizeStorageSha256(metadata.sha256) !== contentHash) {
      return { registered: false, error: "The uploaded DevApp artifact hash does not match" }
    }
    return { registered: true }
  },
})

export const abandonUploadReservation = mutation({
  args: { reservationId: v.id("devAppArtifactUploads") },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation || reservation.createdBy !== user._id) return { removed: false }
    if (reservation.storageId) await ctx.storage.delete(reservation.storageId)
    await ctx.db.delete(args.reservationId)
    return { removed: true }
  },
})

/** Cloudflare's authenticated build gateway rechecks reservation ownership before accepting bytes. */
export const getRuntimeBuildAuthorizationForServer = query({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
    projectId: v.id("projects"),
    reservationId: v.id("devAppArtifactUploads"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret)
    const [user, reservation] = await Promise.all([
      ctx.db
        .query("devicePrincipals")
        .withIndex("by_identity_key", (q) => q.eq("identityKey", args.identityKey))
        .unique(),
      ctx.db.get(args.reservationId),
    ])
    const allowed = Boolean(
      user &&
      user.status === "active" &&
      reservation &&
      reservation.projectId === args.projectId &&
      reservation.createdBy === user._id &&
      reservation.expiresAt > Date.now() &&
      reservation.storageId &&
      reservation.contentHash &&
      reservation.runtimeKind,
    )
    // The builder pushes each organization to its own image repository, so the
    // owning organization has to travel with the authorization rather than be
    // re-derived later from data the builder does not hold. Publishing already
    // requires an organization, so an absent one means the caller cannot publish
    // this project either; the gateway fails closed on it.
    const project = allowed ? await ctx.db.get(args.projectId) : null
    return { allowed, organizationId: project?.organizationId ?? null }
  },
})

/** Grants a short-lived registry pull only for an exact executable release the device may use. */
export const getRuntimePullAuthorizationForServer = query({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
    organizationId: v.id("organizations"),
    publicationId: v.id("devAppPublications"),
    releaseId: v.id("devAppReleases"),
    manifestDigest: v.string(),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret)
    const user = await ctx.db
      .query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", args.identityKey))
      .unique()
    const [publication, release] = await Promise.all([ctx.db.get(args.publicationId), ctx.db.get(args.releaseId)])
    const member = user?.status === "active" ? await isOrgMember(ctx, args.organizationId, user._id) : false
    const allowed = Boolean(
      member &&
      publication &&
      publication.organizationId === args.organizationId &&
      publication.status === "active" &&
      release &&
      release.publicationId === args.publicationId &&
      release.runtimeImage?.manifestDigest === args.manifestDigest &&
      release.parts?.runtime?.kind === "container",
    )
    return { allowed }
  },
})

/** Cloudflare resolves hosted launch authority from current organization state. */
export const getHostedRuntimeAuthorizationForServer = query({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
    organizationId: v.id("organizations"),
    publicationId: v.id("devAppPublications"),
    releaseId: v.id("devAppReleases"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret)
    const user = await ctx.db
      .query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", args.identityKey))
      .unique()
    const [publication, release] = await Promise.all([ctx.db.get(args.publicationId), ctx.db.get(args.releaseId)])
    const member = user?.status === "active" ? await isOrgMember(ctx, args.organizationId, user._id) : false
    if (
      !member ||
      !publication ||
      publication.organizationId !== args.organizationId ||
      publication.status !== "active" ||
      publication.activeReleaseId !== args.releaseId ||
      !release ||
      release.publicationId !== args.publicationId ||
      release.parts?.runtime?.kind !== "container" ||
      release.parts.runtime.location !== "hosted" ||
      (release.parts.runtime.state !== "none" && release.parts.runtime.state !== "organization") ||
      release.parts.worker?.capabilities.some((capability) => capability !== "net.outbound") ||
      !release.runtimeImage ||
      !release.runtimeSourceDigest ||
      !release.packageManifestDigest
    ) {
      return { allowed: false as const }
    }
    return {
      allowed: true as const,
      release: {
        id: release._id,
        version: release.version,
        contentHash: release.contentHash,
        runtimeKind: release.runtimeKind,
        parts: release.parts,
        runtimeSourceDigest: release.runtimeSourceDigest,
        packageManifestDigest: release.packageManifestDigest,
        runtimeImage: release.runtimeImage,
      },
    }
  },
})

/** Records the only build ID allowed to turn this upload reservation into executable release data. */
export const registerRuntimeBuildFromServer = mutation({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
    projectId: v.id("projects"),
    reservationId: v.id("devAppArtifactUploads"),
    buildId: v.string(),
    sourceDigest: v.string(),
    packageManifestDigest: v.string(),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret)
    const user = await ctx.db
      .query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", args.identityKey))
      .unique()
    const reservation = await ctx.db.get(args.reservationId)
    if (
      !user ||
      user.status !== "active" ||
      !reservation ||
      reservation.projectId !== args.projectId ||
      reservation.createdBy !== user._id ||
      reservation.expiresAt <= Date.now() ||
      !reservation.storageId ||
      !reservation.contentHash ||
      !reservation.runtimeKind
    ) {
      throw new ConvexError("The DevApp runtime build reservation is invalid")
    }
    if (reservation.runtimeBuildId) {
      throw new ConvexError("The DevApp upload already has a runtime build")
    }
    const buildId = normalizeRuntimeBuildId(args.buildId)
    const sourceDigest = normalizeContentHash(args.sourceDigest)
    const packageManifestDigest = normalizeSha256Digest(args.packageManifestDigest, "packageManifestDigest")
    await ctx.db.patch(args.reservationId, {
      runtimeBuildId: buildId,
      runtimeBuildStatus: "queued",
      runtimeSourceDigest: sourceDigest,
      packageManifestDigest,
      runtimeBuildError: undefined,
    })
    return { registered: true }
  },
})

/** Trusted builder callback; the desktop still verifies the detached signature before launch. */
export const completeRuntimeBuildFromServer = mutation({
  args: {
    serverSecret: v.string(),
    buildId: v.string(),
    status: v.union(v.literal("building"), v.literal("ready"), v.literal("failed")),
    runtimeImage: v.optional(v.any()),
    runtimeParts: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret)
    const buildId = normalizeRuntimeBuildId(args.buildId)
    const reservation = await ctx.db
      .query("devAppArtifactUploads")
      .withIndex("by_runtime_build_id", (q) => q.eq("runtimeBuildId", buildId))
      .unique()
    if (
      !reservation ||
      reservation.expiresAt <= Date.now() ||
      !reservation.runtimeSourceDigest ||
      !reservation.packageManifestDigest ||
      reservation.runtimeBuildStatus === "ready" ||
      reservation.runtimeBuildStatus === "failed"
    ) {
      throw new ConvexError("The DevApp runtime build is unavailable or already final")
    }
    if (args.status === "ready") {
      if (!args.runtimeImage || !args.runtimeParts) {
        throw new ConvexError("A successful DevApp runtime build is incomplete")
      }
      const runtimeImage = args.runtimeImage as DevAppRuntimeReleaseImage
      const imageError = validateDevAppRuntimeReleaseImage(runtimeImage, {
        sourceDigest: reservation.runtimeSourceDigest,
        packageManifestDigest: reservation.packageManifestDigest,
      })
      const runtimeParts = args.runtimeParts as DevAppParts
      if (imageError || !runtimeParts.runtime || runtimeParts.runtime.kind !== "container") {
        throw new ConvexError(imageError ?? "The DevApp runtime parts are invalid")
      }
      await ctx.db.patch(reservation._id, {
        runtimeBuildStatus: "ready",
        runtimeImage,
        runtimeParts,
        runtimeBuildError: undefined,
      })
    } else if (args.status === "failed") {
      await ctx.db.patch(reservation._id, {
        runtimeBuildStatus: "failed",
        runtimeBuildError: normalizeBoundedText(args.error ?? "The central build failed", "error", 1_000),
      })
    } else {
      await ctx.db.patch(reservation._id, { runtimeBuildStatus: "building" })
    }
    return { updated: true }
  },
})

export const publish = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    logoDataUrl: v.optional(v.string()),
    framework: v.string(),
    uploadReservationId: v.id("devAppArtifactUploads"),
    entryPath: v.string(),
    runtimeKind: v.union(v.literal("static"), v.literal("service")),
    manifestVersion: v.optional(v.number()),
    platform: v.optional(v.string()),
    arch: v.optional(v.string()),
    permissionSetHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canEditProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("You do not have permission to publish this project as a DevApp")
    }

    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") {
      throw new ConvexError("Project not found")
    }
    if (!project.organizationId) {
      throw new ConvexError("Attach this project to an organization before publishing")
    }

    await requireOrgMember(ctx, project.organizationId, user._id)

    const reservation = await ctx.db.get(args.uploadReservationId)
    if (
      !reservation ||
      reservation.createdBy !== user._id ||
      reservation.projectId !== args.projectId ||
      reservation.organizationId !== project.organizationId ||
      reservation.expiresAt <= Date.now() ||
      !reservation.storageId ||
      !reservation.contentHash
    ) {
      throw new ConvexError("The DevApp upload is incomplete, expired, or belongs to another project")
    }
    const metadata = await ctx.db.system.get("_storage", reservation.storageId)
    if (reservation.runtimeKind !== args.runtimeKind) {
      throw new ConvexError("The DevApp upload runtime kind does not match the release")
    }
    if (
      !metadata ||
      metadata.size > orgDevAppArtifactLimits(args.runtimeKind).maxCompressedBytes ||
      metadata.contentType !== "application/zip" ||
      normalizeStorageSha256(metadata.sha256) !== reservation.contentHash
    ) {
      throw new ConvexError("The DevApp upload failed integrity validation")
    }

    const name = normalizeBoundedText(args.name, "name", DEVAPP_NAME_MAX_LENGTH)
    const description =
      args.description === undefined
        ? undefined
        : normalizeBoundedText(args.description, "description", DEVAPP_DESCRIPTION_MAX_LENGTH)
    const framework = normalizeBoundedText(args.framework, "framework", DEVAPP_FRAMEWORK_MAX_LENGTH)
    const entryPath = normalizeBoundedText(args.entryPath, "entryPath", DEVAPP_ENTRY_PATH_MAX_LENGTH)
    if (entryPath.includes("..") || entryPath.startsWith("/") || entryPath.includes("\\")) {
      throw new ConvexError("entryPath must stay inside the DevApp artifact")
    }
    if (args.logoDataUrl && args.logoDataUrl.length > DEVAPP_LOGO_MAX_LENGTH) {
      throw new ConvexError("The DevApp logo exceeds the allowed size")
    }
    if (args.runtimeKind === "service") {
      if (!args.permissionSetHash || !/^[a-f0-9]{64}$/.test(args.permissionSetHash)) {
        throw new ConvexError("The Service DevApp permission hash is invalid")
      }
    }
    if (args.runtimeKind === "service" && !reservation.runtimeBuildId) {
      throw new ConvexError("Published Service DevApps require a successful central runtime build")
    }
    if (
      reservation.runtimeBuildId &&
      (reservation.runtimeBuildStatus !== "ready" ||
        !reservation.runtimeImage ||
        !reservation.runtimeParts ||
        !reservation.runtimeSourceDigest ||
        !reservation.packageManifestDigest)
    ) {
      throw new ConvexError(
        reservation.runtimeBuildStatus === "failed"
          ? (reservation.runtimeBuildError ?? "The central DevApp build failed")
          : "The central DevApp build is not ready",
      )
    }
    const now = Date.now()

    const existingPublication = await getPublicationForProject(ctx, args.projectId)
    const created = existingPublication === null
    const publicationId = existingPublication
      ? existingPublication._id
      : await ctx.db.insert("devAppPublications", {
          projectId: args.projectId,
          organizationId: project.organizationId,
          visibility: "organization",
          name,
          ...(description ? { description } : {}),
          ...(args.logoDataUrl ? { logoDataUrl: args.logoDataUrl } : {}),
          status: "active",
          createdBy: user._id,
          updatedBy: user._id,
          createdAt: now,
          updatedAt: now,
        })

    if (existingPublication) {
      if (existingPublication.organizationId && existingPublication.organizationId !== project.organizationId) {
        throw new ConvexError("This DevApp belongs to another organization")
      }
    }

    const latestRelease = await ctx.db
      .query("devAppReleases")
      .withIndex("by_publication_and_version", (q) => q.eq("publicationId", publicationId))
      .order("desc")
      .first()
    const version = (latestRelease?.version ?? 0) + 1

    const releaseId = await ctx.db.insert("devAppReleases", {
      publicationId,
      projectId: args.projectId,
      version,
      framework,
      artifactStorageId: reservation.storageId,
      entryPath,
      contentHash: reservation.contentHash,
      runtimeKind: args.runtimeKind,
      parts: reservation.runtimeParts ?? partsForPublishedRuntimeKind(args.runtimeKind),
      ...(reservation.runtimeSourceDigest ? { runtimeSourceDigest: reservation.runtimeSourceDigest } : {}),
      ...(reservation.packageManifestDigest ? { packageManifestDigest: reservation.packageManifestDigest } : {}),
      ...(reservation.runtimeImage ? { runtimeImage: reservation.runtimeImage } : {}),
      ...(args.manifestVersion ? { manifestVersion: args.manifestVersion } : {}),
      ...(args.platform ? { platform: args.platform } : {}),
      ...(args.arch ? { arch: args.arch } : {}),
      ...(args.permissionSetHash ? { permissionSetHash: args.permissionSetHash } : {}),
      ...(user.identityKey ? { publisherIdentityKey: user.identityKey } : {}),
      ...(user.displayName ? { publisherDisplayName: user.displayName } : {}),
      createdBy: user._id,
      createdAt: now,
    })

    await ctx.db.patch(publicationId, {
      activeReleaseId: releaseId,
      organizationId: project.organizationId,
      visibility: "organization",
      name,
      ...(description ? { description } : {}),
      ...(args.logoDataUrl ? { logoDataUrl: args.logoDataUrl } : {}),
      status: "active",
      updatedBy: user._id,
      updatedAt: now,
    })
    await ctx.db.delete(args.uploadReservationId)

    const retainedReleases = await ctx.db
      .query("devAppReleases")
      .withIndex("by_publication_and_version", (q) => q.eq("publicationId", publicationId))
      .order("desc")
      .collect()
    for (const staleRelease of retainedReleases.slice(DEVAPP_RELEASE_RETENTION)) {
      if (staleRelease.artifactStorageId) await ctx.storage.delete(staleRelease.artifactStorageId)
      await ctx.db.delete(staleRelease._id)
    }

    const [publication, release] = await Promise.all([ctx.db.get(publicationId), ctx.db.get(releaseId)])
    if (!publication || !release) {
      throw new ConvexError("The DevApp release could not be read after publishing")
    }

    const organization = await ctx.db.get(project.organizationId)
    return {
      created,
      consumer: toConsumerDevApp({
        publication,
        release,
        organizationName: organization?.name ?? "Organization",
      }),
    }
  },
})

export const archive = mutation({
  args: {
    publicationId: v.id("devAppPublications"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const publication = await ctx.db.get(args.publicationId)
    if (!publication?.organizationId) {
      throw new ConvexError("DevApp not found")
    }
    await requireOrgAdmin(ctx, publication.organizationId, user._id)
    await ctx.db.patch(args.publicationId, {
      status: "archived",
      updatedBy: user._id,
      updatedAt: Date.now(),
    })
    return { archived: true }
  },
})

export const updateIdentity = mutation({
  args: {
    publicationId: v.id("devAppPublications"),
    name: v.optional(v.string()),
    logoDataUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const publication = await ctx.db.get(args.publicationId)
    if (!publication?.organizationId) {
      throw new ConvexError("DevApp not found")
    }
    const { membership } = await requireOrgMember(ctx, publication.organizationId, user._id)
    const isAdmin = membership?.role === "admin"
    const canEditSource = await canEditProject(ctx, publication.projectId, user._id)
    if (!isAdmin && !canEditSource) {
      throw new ConvexError("You do not have permission to edit this DevApp")
    }
    const patch: Partial<Doc<"devAppPublications">> = {
      updatedBy: user._id,
      updatedAt: Date.now(),
    }
    if (args.name !== undefined) {
      patch.name = normalizeRequiredText(args.name, "name")
    }
    if (args.logoDataUrl !== undefined) {
      patch.logoDataUrl = args.logoDataUrl
    }
    await ctx.db.patch(args.publicationId, patch)
    return { updated: true }
  },
})

export const listForOrganization = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const { organization } = await requireOrgMember(ctx, args.organizationId, user._id)
    const publications = await ctx.db
      .query("devAppPublications")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .collect()

    const rows = await Promise.all(
      publications.map(async (publication) => {
        const release = await getActiveRelease(ctx, publication)
        if (!release) return null
        return toConsumerRow(publication, release, organization.name)
      }),
    )

    return rows.flatMap((row) => (row ? [row] : [])).sort((left, right) => left.name.localeCompare(right.name))
  },
})

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthenticatedDevice(ctx)
    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    const grouped = await Promise.all(
      memberships.map(async (membership) => {
        const organization = await ctx.db.get(membership.organizationId)
        if (!organization) return []
        const publications = await ctx.db
          .query("devAppPublications")
          .withIndex("by_organization", (q) => q.eq("organizationId", membership.organizationId))
          .collect()
        const rows = await Promise.all(
          publications.map(async (publication) => {
            const release = await getActiveRelease(ctx, publication)
            if (!release) return null
            return toConsumerRow(publication, release, organization.name)
          }),
        )
        return rows.flatMap((row) => (row ? [row] : []))
      }),
    )

    return grouped.flat().sort((left, right) => left.name.localeCompare(right.name))
  },
})

/** Resolves a durable publication ref without exposing source-project data. */
export const resolveReference = query({
  args: { ref: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const resolved = await resolvePublicationReferenceRecord(ctx, args.ref, user._id)
    if (!resolved) return null
    return toConsumerDevApp({
      publication: resolved.publication,
      release: resolved.release,
      organizationName: resolved.organization.name,
    })
  },
})

export const listPublisherStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthenticatedDevice(ctx)
    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    const rows = await Promise.all(
      memberships.map(async (membership) => {
        if (!(await canEditProject(ctx, membership.projectId, user._id))) {
          return null
        }
        const publication = await getPublicationForProject(ctx, membership.projectId)
        if (!publication) return null
        const release = await getActiveRelease(ctx, publication)
        return {
          projectId: membership.projectId,
          publicationId: publication._id,
          organizationId: publication.organizationId ?? null,
          name: publication.name,
          status: publication.status,
          logoDataUrl: publication.logoDataUrl ?? null,
          hasArtifact: Boolean(release?.artifactStorageId && release.contentHash),
          version: release?.version ?? null,
        }
      }),
    )

    return rows.flatMap((row) => (row ? [row] : []))
  },
})

export const getForProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canEditProject(ctx, args.projectId, user._id))) {
      return null
    }
    const publication = await getPublicationForProject(ctx, args.projectId)
    if (!publication) return null
    const release = await getActiveRelease(ctx, publication)
    return {
      publicationId: publication._id,
      organizationId: publication.organizationId ?? null,
      name: publication.name,
      status: publication.status,
      logoDataUrl: publication.logoDataUrl ?? null,
      hasArtifact: Boolean(release?.artifactStorageId && release.contentHash),
      version: release?.version ?? null,
    }
  },
})

export const getArtifactUrl = query({
  args: {
    ref: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const resolved = await resolvePublicationReferenceRecord(ctx, args.ref, user._id)
    if (!resolved) return null
    const url = await ctx.storage.getUrl(resolved.release.artifactStorageId)
    if (!url) {
      throw new ConvexError("DevApp artifact is unavailable")
    }
    return {
      url,
      publicationId: resolved.publication._id,
      organizationId: resolved.organization._id,
      contentHash: resolved.release.contentHash,
      entryPath: resolved.release.entryPath,
      releaseId: resolved.release._id,
      version: resolved.release.version,
      runtimeKind: resolved.release.runtimeKind,
      parts: resolved.release.parts,
      manifestVersion: resolved.release.manifestVersion ?? null,
      platform: resolved.release.platform ?? null,
      arch: resolved.release.arch ?? null,
      permissionSetHash: resolved.release.permissionSetHash ?? null,
      publisherIdentityKey: resolved.release.publisherIdentityKey ?? null,
      publisherDisplayName: resolved.release.publisherDisplayName ?? null,
    }
  },
})

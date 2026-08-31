import { ConvexError } from "convex/values"

import type { DevAppParts } from "../../shared/devAppParts"

import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { isGroupIdentityKey } from "../../shared/deviceIdentity"

type ReadDatabaseCtx = Pick<QueryCtx | MutationCtx, "db">

export type OrganizationRole = Doc<"organizationMembers">["role"]
export type DeviceOrganization = Doc<"organizations"> & { groupId: string }

export interface OrganizationAccessState {
  organization: DeviceOrganization | null
  membership: Doc<"organizationMembers"> | null
  isCreator: boolean
}

export async function getOrganizationMembership(
  ctx: ReadDatabaseCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
): Promise<Doc<"organizationMembers"> | null> {
  return await ctx.db
    .query("organizationMembers")
    .withIndex("by_organization_and_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId),
    )
    .first()
}

export async function getOrganizationAccessState(
  ctx: ReadDatabaseCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
): Promise<OrganizationAccessState> {
  const organization = await ctx.db.get(organizationId)
  if (!organization?.groupId || !isGroupIdentityKey(organization.groupId)) {
    return { organization: null, membership: null, isCreator: false }
  }

  const membership = await getOrganizationMembership(ctx, organizationId, userId)
  return {
    organization: organization as DeviceOrganization,
    membership,
    isCreator: organization.createdBy === userId,
  }
}

export async function isOrgMember(
  ctx: ReadDatabaseCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
): Promise<boolean> {
  const access = await getOrganizationAccessState(ctx, organizationId, userId)
  return access.organization !== null && (access.isCreator || access.membership !== null)
}

export async function requireOrgMember(
  ctx: ReadDatabaseCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
): Promise<{ organization: DeviceOrganization; membership: Doc<"organizationMembers"> | null }> {
  const access = await getOrganizationAccessState(ctx, organizationId, userId)
  if (!access.organization || (!access.isCreator && !access.membership)) {
    throw new ConvexError("You are not a member of this organization")
  }
  return { organization: access.organization, membership: access.membership }
}

export async function requireOrgAdmin(
  ctx: ReadDatabaseCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
): Promise<{ organization: DeviceOrganization }> {
  const access = await getOrganizationAccessState(ctx, organizationId, userId)
  if (!access.organization) {
    throw new ConvexError("Organization not found")
  }
  if (access.isCreator) {
    return { organization: access.organization }
  }
  if (access.membership?.role !== "admin") {
    throw new ConvexError("Only organization admins can do that")
  }
  return { organization: access.organization }
}

export function toConsumerDevApp(input: {
  publication: Doc<"devAppPublications">
  release: Doc<"devAppReleases">
  organizationName: string
}): {
  publicationId: Id<"devAppPublications">
  organizationId: Id<"organizations">
  organizationName: string
  name: string
  description: string | null
  logoDataUrl: string | null
  status: Doc<"devAppPublications">["status"]
  activeRelease: {
    id: Id<"devAppReleases">
    version: number
    framework: string
    entryPath: string
    contentHash: string
    runtimeKind: "static" | "service"
    manifestVersion: number | null
    platform: string | null
    arch: string | null
    permissionSetHash: string | null
    publisherIdentityKey: string | null
    publisherDeviceLabel: string | null
    parts: DevAppParts
  }
} {
  const organizationId = input.publication.organizationId
  if (!organizationId) {
    throw new ConvexError("DevApp is not published to an organization")
  }
  if (!input.release.artifactStorageId || !input.release.contentHash) {
    throw new ConvexError("DevApp release has no artifact")
  }

  return {
    publicationId: input.publication._id,
    organizationId,
    organizationName: input.organizationName,
    name: input.publication.name,
    description: input.publication.description ?? null,
    logoDataUrl: input.publication.logoDataUrl ?? null,
    status: input.publication.status,
    activeRelease: {
      id: input.release._id,
      version: input.release.version,
      framework: input.release.framework,
      entryPath: input.release.entryPath,
      contentHash: input.release.contentHash,
      runtimeKind: input.release.runtimeKind,
      manifestVersion: input.release.manifestVersion ?? null,
      platform: input.release.platform ?? null,
      arch: input.release.arch ?? null,
      permissionSetHash: input.release.permissionSetHash ?? null,
      publisherIdentityKey: input.release.publisherIdentityKey ?? null,
      publisherDeviceLabel: input.release.publisherDeviceLabel ?? null,
      parts: input.release.parts,
    },
  }
}

export function consumerPayloadHasSource(payload: Record<string, unknown>): boolean {
  return (
    "projectId" in payload ||
    "localPath" in payload ||
    "sourceProject" in payload ||
    "devCommand" in payload ||
    "devPort" in payload ||
    "workspaceId" in payload
  )
}

import { ConvexError } from "convex/values"

import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type ReadDatabaseCtx = Pick<QueryCtx | MutationCtx, "db">

export type OrganizationRole = Doc<"organizationMembers">["role"]

export interface OrganizationAccessState {
  organization: Doc<"organizations"> | null
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
  if (!organization) {
    return { organization: null, membership: null, isCreator: false }
  }

  const membership = await getOrganizationMembership(ctx, organizationId, userId)
  return {
    organization,
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
): Promise<{ organization: Doc<"organizations">; membership: Doc<"organizationMembers"> | null }> {
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
): Promise<{ organization: Doc<"organizations"> }> {
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
      entryPath: input.release.entryPath ?? "index.html",
      contentHash: input.release.contentHash,
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

import { parseDevAppRef } from "../../shared/devAppRef";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isOrgMember } from "./orgAccess";

type ReadDatabaseCtx = Pick<QueryCtx | MutationCtx, "db">;

/**
 * Resolves one publication ref against immutable release records and the caller's
 * current organization membership. All malformed, mismatched, inaccessible, archived,
 * and expired-release cases collapse to null so the endpoint cannot be used to enumerate
 * private publications.
 */
export async function resolvePublicationReferenceRecord(
  ctx: ReadDatabaseCtx,
  rawRef: string,
  userId: Id<"users">,
): Promise<{
  publication: Doc<"devAppPublications">;
  release: Doc<"devAppReleases">;
  organization: Doc<"organizations">;
} | null> {
  const ref = parseDevAppRef(rawRef);
  if (ref?.kind !== "publication") return null;

  const publicationId = ctx.db.normalizeId("devAppPublications", ref.publicationId);
  const organizationId = ctx.db.normalizeId("organizations", ref.organizationId);
  if (!publicationId || !organizationId) return null;

  const publication = await ctx.db.get(publicationId);
  if (
    !publication ||
    publication.organizationId !== organizationId ||
    publication.visibility !== "organization" ||
    publication.status !== "active" ||
    !(await isOrgMember(ctx, organizationId, userId))
  ) {
    return null;
  }

  const pinnedVersion = ref.version === "latest" ? null : ref.version;
  const release =
    pinnedVersion === null
      ? publication.activeReleaseId
        ? await ctx.db.get(publication.activeReleaseId)
        : null
      : await ctx.db
          .query("devAppReleases")
          .withIndex("by_publication_and_version", (q) =>
            q.eq("publicationId", publicationId).eq("version", pinnedVersion),
          )
          .unique();
  if (
    !release ||
    release.publicationId !== publicationId ||
    !release.artifactStorageId ||
    !release.contentHash
  ) {
    return null;
  }

  const organization = await ctx.db.get(organizationId);
  if (!organization) return null;
  return { publication, release, organization };
}

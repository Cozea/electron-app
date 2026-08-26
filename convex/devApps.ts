import { ConvexError, v } from "convex/values";

import { isProjectDevAppCommand } from "../shared/projectDevAppCommand";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { canEditProject, getProjectAccessState } from "./lib/projectAccess";

interface ProjectDevAppState {
  projectId: Id<"projects">;
  canPublish: boolean;
  publication: Doc<"devAppPublications"> | null;
  activeRelease: Doc<"devAppReleases"> | null;
}

interface SourceProjectMetadata {
  _id: Id<"projects">;
  name: string;
  slug: string;
  description: string | null;
  previewImageId: Id<"_storage"> | null;
  status: Doc<"projects">["status"];
  updatedAt: number;
}

interface AccessibleDevApp {
  publication: Doc<"devAppPublications">;
  activeRelease: Doc<"devAppReleases">;
  sourceProject: SourceProjectMetadata;
}

interface PublishResult {
  publication: Doc<"devAppPublications">;
  release: Doc<"devAppReleases">;
  created: boolean;
}

type ReadDatabaseCtx = Pick<QueryCtx | MutationCtx, "db">;

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ConvexError(`${fieldName} cannot be blank`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeRequiredText(value, fieldName);
}

function normalizeDevPort(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new ConvexError("devPort must be an integer between 1 and 65535");
  }
  return value;
}

function normalizeDevCommand(value: string): string {
  const normalized = normalizeRequiredText(value, "devCommand");
  if (!isProjectDevAppCommand(normalized)) {
    throw new ConvexError(
      "devCommand must run a recognized preview package.json script without shell operators or extra arguments",
    );
  }
  return normalized;
}

function normalizeSourceFingerprint(value: string): string {
  const normalized = normalizeRequiredText(value, "sourceFingerprint").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ConvexError("sourceFingerprint must be a SHA-256 digest");
  }
  return normalized;
}

async function listAccessibleProjects(
  ctx: ReadDatabaseCtx,
  userId: Id<"users">,
): Promise<Array<Doc<"projects">>> {
  const [ownedProjects, memberships] = await Promise.all([
    ctx.db
      .query("projects")
      .withIndex("by_created_by", (q) => q.eq("createdBy", userId))
      .collect(),
    ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  ]);

  const projectIds = new Map<string, Id<"projects">>();
  for (const project of ownedProjects) {
    projectIds.set(String(project._id), project._id);
  }
  for (const membership of memberships) {
    projectIds.set(String(membership.projectId), membership.projectId);
  }

  const accessStates = await Promise.all(
    Array.from(projectIds.values()).map((projectId) =>
      getProjectAccessState(ctx, projectId, userId),
    ),
  );

  return accessStates
    .flatMap((access) => (access.project ? [access.project] : []))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

async function getPublicationForProject(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
): Promise<Doc<"devAppPublications"> | null> {
  return await ctx.db
    .query("devAppPublications")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first();
}

async function getActiveRelease(
  ctx: ReadDatabaseCtx,
  publication: Doc<"devAppPublications">,
): Promise<Doc<"devAppReleases"> | null> {
  if (!publication.activeReleaseId) {
    return null;
  }

  const release = await ctx.db.get(publication.activeReleaseId);
  if (
    !release ||
    release.publicationId !== publication._id ||
    release.projectId !== publication.projectId
  ) {
    return null;
  }
  return release;
}

// Remote publication stays internal until WorkOS-backed Convex identity is
// available. The shipping renderer uses its machine-local catalog instead.
export const listProjectStates = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<Array<ProjectDevAppState>> => {
    const projects = await listAccessibleProjects(ctx, args.userId);

    return await Promise.all(
      projects.map(async (project): Promise<ProjectDevAppState> => {
        const [canPublish, publication] = await Promise.all([
          canEditProject(ctx, project._id, args.userId),
          getPublicationForProject(ctx, project._id),
        ]);

        if (!publication) {
          return {
            projectId: project._id,
            canPublish,
            publication: null,
            activeRelease: null,
          };
        }

        const activeRelease = await getActiveRelease(ctx, publication);
        return {
          projectId: project._id,
          canPublish,
          publication,
          activeRelease,
        };
      }),
    );
  },
});

export const listAccessible = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<Array<AccessibleDevApp>> => {
    const projects = await listAccessibleProjects(ctx, args.userId);
    const rows = await Promise.all(
      projects.map(async (project): Promise<AccessibleDevApp | null> => {
        const publication = await getPublicationForProject(ctx, project._id);
        if (!publication || publication.status !== "active") {
          return null;
        }

        const activeRelease = await getActiveRelease(ctx, publication);
        if (!activeRelease) {
          return null;
        }

        return {
          publication,
          activeRelease,
          sourceProject: {
            _id: project._id,
            name: project.name,
            slug: project.slug,
            description: project.description ?? null,
            previewImageId: project.previewImageId ?? null,
            status: project.status,
            updatedAt: project.updatedAt,
          },
        };
      }),
    );

    return rows
      .flatMap((row) => (row ? [row] : []))
      .sort((left, right) => right.publication.updatedAt - left.publication.updatedAt);
  },
});

export const publish = internalMutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    framework: v.string(),
    devCommand: v.string(),
    devPort: v.optional(v.number()),
    sourceRevision: v.optional(v.string()),
    sourceFingerprint: v.string(),
  },
  handler: async (ctx, args): Promise<PublishResult> => {
    if (!(await canEditProject(ctx, args.projectId, args.userId))) {
      throw new ConvexError("You do not have permission to publish this project as a DevApp");
    }

    const name = normalizeRequiredText(args.name, "name");
    const description = normalizeOptionalText(args.description, "description");
    const framework = normalizeRequiredText(args.framework, "framework");
    const devCommand = normalizeDevCommand(args.devCommand);
    const devPort = normalizeDevPort(args.devPort);
    const sourceRevision = normalizeOptionalText(args.sourceRevision, "sourceRevision");
    const sourceFingerprint = normalizeSourceFingerprint(args.sourceFingerprint);
    const now = Date.now();

    const existingPublication = await getPublicationForProject(ctx, args.projectId);
    const created = existingPublication === null;
    const publicationId = existingPublication
      ? existingPublication._id
      : await ctx.db.insert("devAppPublications", {
          projectId: args.projectId,
          visibility: "project",
          name,
          ...(description ? { description } : {}),
          status: "active",
          createdBy: args.userId,
          updatedBy: args.userId,
          createdAt: now,
          updatedAt: now,
        });

    const latestRelease = await ctx.db
      .query("devAppReleases")
      .withIndex("by_publication_and_version", (q) => q.eq("publicationId", publicationId))
      .order("desc")
      .first();
    const version = (latestRelease?.version ?? 0) + 1;

    const releaseId = await ctx.db.insert("devAppReleases", {
      publicationId,
      projectId: args.projectId,
      version,
      framework,
      devCommand,
      ...(devPort !== undefined ? { devPort } : {}),
      ...(sourceRevision ? { sourceRevision } : {}),
      sourceFingerprint,
      createdBy: args.userId,
      createdAt: now,
    });

    await ctx.db.patch(publicationId, {
      activeReleaseId: releaseId,
      name,
      ...(description ? { description } : {}),
      status: "active",
      updatedBy: args.userId,
      updatedAt: now,
    });

    const [publication, release] = await Promise.all([
      ctx.db.get(publicationId),
      ctx.db.get(releaseId),
    ]);
    if (!publication || !release) {
      throw new ConvexError("The DevApp release could not be read after publishing");
    }

    return {
      publication,
      release,
      created,
    };
  },
});

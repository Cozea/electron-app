import { describe, expect, it } from "vitest";
import type { SystemTableNames } from "convex/server";

import type { Id, TableNames } from "../../convex/_generated/dataModel";
import { resolvePublicationReferenceRecord } from "../../convex/lib/devAppReferenceResolution";
import { formatDevAppRef } from "@shared/devAppRef";

function asId<T extends TableNames | SystemTableNames>(value: string): Id<T> {
  return value as Id<T>;
}

class FakeIndexedQuery<T extends Record<string, unknown>> {
  private readonly rows: readonly T[];
  private readonly filters: ReadonlyArray<{ field: string; value: unknown }>;

  constructor(rows: readonly T[], filters: ReadonlyArray<{ field: string; value: unknown }> = []) {
    this.rows = rows;
    this.filters = filters;
  }

  eq(field: string, value: unknown): FakeIndexedQuery<T> {
    return new FakeIndexedQuery(this.rows, [...this.filters, { field, value }]);
  }

  async first(): Promise<T | null> {
    return this.matching()[0] ?? null;
  }

  async unique(): Promise<T | null> {
    const matching = this.matching();
    if (matching.length > 1) throw new Error("Expected a unique fake query result");
    return matching[0] ?? null;
  }

  private matching(): T[] {
    return this.rows.filter((row) =>
      this.filters.every(({ field, value }) => row[field] === value),
    );
  }
}

class FakeQuery<T extends Record<string, unknown>> {
  private readonly rows: readonly T[];

  constructor(rows: readonly T[]) {
    this.rows = rows;
  }

  withIndex(_indexName: string, build: (query: FakeIndexedQuery<T>) => FakeIndexedQuery<T>) {
    return build(new FakeIndexedQuery(this.rows));
  }
}

type ResolutionCtx = Parameters<typeof resolvePublicationReferenceRecord>[0];

function createFixture() {
  const organizationId = asId<"organizations">("org_1");
  const publicationId = asId<"devAppPublications">("pub_1");
  const principalId = asId<"devicePrincipals">("user_1");
  const outsiderId = asId<"devicePrincipals">("user_outside");
  const release1Id = asId<"devAppReleases">("release_1");
  const release2Id = asId<"devAppReleases">("release_2");
  const organization = {
    _id: organizationId,
    groupId: "czg_reference_resolution",
    name: "Acme",
    createdBy: asId<"devicePrincipals">("user_owner"),
    createdAt: 1,
    updatedAt: 1,
  };
  const publication = {
    _id: publicationId,
    projectId: asId<"projects">("project_source"),
    organizationId,
    activeReleaseId: release2Id,
    visibility: "organization" as const,
    name: "Inventory",
    status: "active" as "active" | "archived",
    createdBy: principalId,
    updatedBy: principalId,
    createdAt: 1,
    updatedAt: 2,
  };
  const releases = [
    {
      _id: release1Id,
      publicationId,
      projectId: publication.projectId,
      version: 1,
      framework: "vite-react",
      artifactStorageId: asId<"_storage">("storage_1"),
      entryPath: "index.html",
      contentHash: "a".repeat(64),
      runtimeKind: "static" as const,
      parts: { view: { source: "package" as const } },
      createdBy: principalId,
      createdAt: 1,
    },
    {
      _id: release2Id,
      publicationId,
      projectId: publication.projectId,
      version: 2,
      framework: "vite-react",
      artifactStorageId: asId<"_storage">("storage_2"),
      entryPath: "index.html",
      contentHash: "b".repeat(64),
      runtimeKind: "static" as const,
      parts: { view: { source: "package" as const } },
      createdBy: principalId,
      createdAt: 2,
    },
  ];
  const memberships = [
    {
      _id: asId<"organizationMembers">("membership_1"),
      organizationId,
      principalId,
      role: "member" as const,
      addedAt: 1,
      addedBy: organization.createdBy,
    },
  ];
  const tables = {
    organizations: [organization],
    devAppPublications: [publication],
    devAppReleases: releases,
    organizationMembers: memberships,
  };
  const allDocuments = Object.values(tables).flat();
  const ctx = {
    db: {
      normalizeId(table: keyof typeof tables, value: string) {
        return tables[table].some((row) => row._id === value) ? value : null;
      },
      async get(id: string) {
        return allDocuments.find((row) => row._id === id) ?? null;
      },
      query(table: keyof typeof tables) {
        return new FakeQuery(tables[table] as unknown as Array<Record<string, unknown>>);
      },
    },
  } as unknown as ResolutionCtx;

  return { ctx, organizationId, publicationId, publication, principalId, outsiderId };
}

describe("durable DevApp publication resolution", () => {
  it("resolves latest and pinned refs to their intended immutable release", async () => {
    const fixture = createFixture();
    const latestRef = formatDevAppRef({
      kind: "publication",
      organizationId: fixture.organizationId,
      publicationId: fixture.publicationId,
      version: "latest",
    });
    const pinnedRef = formatDevAppRef({
      kind: "publication",
      organizationId: fixture.organizationId,
      publicationId: fixture.publicationId,
      version: 1,
    });

    await expect(
      resolvePublicationReferenceRecord(fixture.ctx, latestRef, fixture.principalId),
    ).resolves.toMatchObject({ release: { version: 2 } });
    await expect(
      resolvePublicationReferenceRecord(fixture.ctx, pinnedRef, fixture.principalId),
    ).resolves.toMatchObject({ release: { version: 1 } });
  });

  it("fails closed for outsiders, owner mismatches, missing releases, and archived apps", async () => {
    const fixture = createFixture();
    const makeRef = (organizationId: string, version: number | "latest") =>
      formatDevAppRef({
        kind: "publication",
        organizationId,
        publicationId: fixture.publicationId,
        version,
      });

    await expect(
      resolvePublicationReferenceRecord(
        fixture.ctx,
        makeRef(fixture.organizationId, "latest"),
        fixture.outsiderId,
      ),
    ).resolves.toBeNull();
    await expect(
      resolvePublicationReferenceRecord(
        fixture.ctx,
        makeRef("org_wrong", "latest"),
        fixture.principalId,
      ),
    ).resolves.toBeNull();
    await expect(
      resolvePublicationReferenceRecord(
        fixture.ctx,
        makeRef(fixture.organizationId, 99),
        fixture.principalId,
      ),
    ).resolves.toBeNull();

    fixture.publication.status = "archived";
    await expect(
      resolvePublicationReferenceRecord(
        fixture.ctx,
        makeRef(fixture.organizationId, "latest"),
        fixture.principalId,
      ),
    ).resolves.toBeNull();
  });
});

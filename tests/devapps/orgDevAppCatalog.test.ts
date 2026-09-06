import { describe, expect, it } from "vitest"

import type { Id, TableNames } from "../../convex/_generated/dataModel"
import type { SystemTableNames } from "convex/server"
import {
  consumerPayloadHasSource,
  isOrgMember,
  requireOrgMember,
  toConsumerDevApp,
} from "../../convex/lib/orgAccess"
import { buildPublishedDevAppLaunchSpec, buildPublishedDevAppManifest } from "@/features/devapps/orgDevAppManifest"

function asId<T extends TableNames | SystemTableNames>(value: string): Id<T> {
  return value as Id<T>
}

interface OrganizationDoc {
  _id: Id<"organizations">
  groupId: string
  name: string
  createdBy: Id<"devicePrincipals">
  createdAt: number
  updatedAt: number
}

interface OrganizationMemberDoc {
  _id: Id<"organizationMembers">
  organizationId: Id<"organizations">
  userId: Id<"devicePrincipals">
  role: "admin" | "member"
  addedAt: number
  addedBy: Id<"devicePrincipals">
}

interface TestTables {
  organizations: OrganizationDoc[]
  organizationMembers: OrganizationMemberDoc[]
}

class FakeIndexedQuery<T extends Record<string, unknown>> {
  private readonly rows: readonly T[]
  private readonly filters: ReadonlyArray<{ field: string; value: unknown }>

  constructor(
    rows: readonly T[],
    filters: ReadonlyArray<{ field: string; value: unknown }> = [],
  ) {
    this.rows = rows
    this.filters = filters
  }

  eq(field: string, value: unknown): FakeIndexedQuery<T> {
    return new FakeIndexedQuery(this.rows, [...this.filters, { field, value }])
  }

  async first(): Promise<T | null> {
    return (
      this.rows.find((row) => this.filters.every(({ field, value }) => row[field] === value)) ?? null
    )
  }
}

class FakeQuery<T extends Record<string, unknown>> {
  private readonly rows: readonly T[]

  constructor(rows: readonly T[]) {
    this.rows = rows
  }

  withIndex(_indexName: string, build: (query: FakeIndexedQuery<T>) => FakeIndexedQuery<T>) {
    return build(new FakeIndexedQuery(this.rows))
  }
}

type OrgAccessCtx = Parameters<typeof isOrgMember>[0]

function createCtx(tables: TestTables): OrgAccessCtx {
  const ctx = {
    db: {
      async get(id: string) {
        return tables.organizations.find((row) => row._id === id) ?? null
      },
      query(table: keyof TestTables) {
        return new FakeQuery(tables[table] as unknown as Array<Record<string, unknown>>)
      },
    },
  }
  return ctx as unknown as OrgAccessCtx
}

describe("org DevApp catalog access", () => {
  const orgId = asId<"organizations">("org_1")
  const adminId = asId<"devicePrincipals">("user_admin")
  const memberId = asId<"devicePrincipals">("user_member")
  const outsiderId = asId<"devicePrincipals">("user_out")

  const ctx = createCtx({
    organizations: [
      {
        _id: orgId,
        groupId: "czg_org_test1",
        name: "Acme",
        createdBy: adminId,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    organizationMembers: [
      {
        _id: asId<"organizationMembers">("mem_admin"),
        organizationId: orgId,
        userId: adminId,
        role: "admin",
        addedAt: 1,
        addedBy: adminId,
      },
      {
        _id: asId<"organizationMembers">("mem_member"),
        organizationId: orgId,
        userId: memberId,
        role: "member",
        addedAt: 1,
        addedBy: adminId,
      },
    ],
  })

  it("admits org members and rejects outsiders", async () => {
    await expect(isOrgMember(ctx, orgId, memberId)).resolves.toBe(true)
    await expect(isOrgMember(ctx, orgId, outsiderId)).resolves.toBe(false)
    await expect(requireOrgMember(ctx, orgId, outsiderId)).rejects.toThrow(
      "You are not a member of this organization",
    )
  })

  it("omits source from consumer payloads", () => {
    const consumer = toConsumerDevApp({
      publication: {
        _id: asId<"devAppPublications">("pub_1"),
        organizationId: orgId,
        projectId: asId<"projects">("proj_1"),
        name: "Inventory",
        status: "active",
        visibility: "organization",
        createdBy: adminId,
        updatedBy: adminId,
        createdAt: 1,
        updatedAt: 1,
      } as never,
      release: {
        _id: asId<"devAppReleases">("rel_1"),
        publicationId: asId<"devAppPublications">("pub_1"),
        projectId: asId<"projects">("proj_1"),
        version: 2,
        framework: "vite-react",
        artifactStorageId: asId<"_storage">("storage_1"),
        entryPath: "index.html",
        contentHash: "b".repeat(64),
        runtimeKind: "static",
        parts: { view: { source: "package" } },
        createdBy: adminId,
        createdAt: 1,
      } as never,
      organizationName: "Acme",
    })

    expect(consumerPayloadHasSource(consumer as unknown as Record<string, unknown>)).toBe(false)
    expect(consumer).not.toHaveProperty("projectId")
    expect(consumer).not.toHaveProperty("devCommand")
    expect(consumer).not.toHaveProperty("devPort")
    expect(consumer).not.toHaveProperty("localPath")
    expect(consumer).not.toHaveProperty("workspaceId")
  })
})

describe("published DevApp manifests", () => {
  it("launch specs never include source or localhost recipes", () => {
    const entry = {
      publicationId: "pub_1",
      organizationId: "org_1",
      organizationName: "Acme",
      name: "Inventory",
      description: null,
      logoDataUrl: null,
      status: "active" as const,
      activeRelease: {
        id: "rel_1",
        version: 1,
        framework: "vite-react",
        entryPath: "index.html",
        contentHash: "c".repeat(64),
        runtimeKind: "static" as const,
        manifestVersion: null,
        platform: null,
        arch: null,
        permissionSetHash: null,
        publisherIdentityKey: null,
        publisherDisplayName: null,
        parts: { view: { source: "package" as const } },
      },
    }
    const spec = buildPublishedDevAppLaunchSpec(entry)
    const manifest = buildPublishedDevAppManifest(entry)

    expect(spec.kind).toBe("publishedDevApp")
    expect(spec.tileType).toBe("orgDevApp")
    expect(spec.ref).toBe("cozea-devapp:org_1/pub_1")
    expect(spec).not.toHaveProperty("projectId")
    expect(spec).not.toHaveProperty("devCommand")
    expect(manifest.launch.kind).toBe("publishedDevApp")
    expect(manifest.store.badgeLabel).toBe("Acme")
    expect(manifest.store.categoryLabel).toBe("Organization")
    expect(manifest.icon.src).toContain("/published/icon.png")
    expect(manifest.icon.className).toBe("scale-[1.25]")
    expect(manifest.parts).toBe(entry.activeRelease.parts)
  })

  it("preserves a pinned durable ref through manifest materialization", () => {
    const entry = {
      publicationId: "pub_1",
      organizationId: "org_1",
      organizationName: "Acme",
      name: "Inventory",
      description: null,
      logoDataUrl: null,
      status: "active" as const,
      activeRelease: {
        id: "rel_1",
        version: 1,
        framework: "vite-react",
        entryPath: "index.html",
        contentHash: "c".repeat(64),
        runtimeKind: "static" as const,
        manifestVersion: null,
        platform: null,
        arch: null,
        permissionSetHash: null,
        publisherIdentityKey: null,
        publisherDisplayName: null,
        parts: { view: { source: "package" as const } },
      },
    }

    expect(
      buildPublishedDevAppManifest(entry, "cozea-devapp:org_1/pub_1@1").launch,
    ).toMatchObject({ ref: "cozea-devapp:org_1/pub_1@1", releaseVersion: 1 })
  })
})

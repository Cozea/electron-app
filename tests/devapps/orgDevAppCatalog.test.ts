import { describe, expect, it } from "vitest"

import type { Id } from "../../convex/_generated/dataModel"
import {
  consumerPayloadHasSource,
  isOrgMember,
  requireOrgMember,
  toConsumerDevApp,
} from "../../convex/lib/orgAccess"
import { buildPublishedDevAppLaunchSpec, buildPublishedDevAppManifest } from "@/features/devapps/orgDevAppManifest"

function asId<T extends string>(value: string): Id<T> {
  return value as Id<T>
}

interface OrganizationDoc {
  _id: Id<"organizations">
  groupId: string
  name: string
  createdBy: Id<"users">
  createdAt: number
  updatedAt: number
}

interface OrganizationMemberDoc {
  _id: Id<"organizationMembers">
  organizationId: Id<"organizations">
  userId: Id<"users">
  role: "admin" | "member"
  addedAt: number
  addedBy: Id<"users">
}

interface TestTables {
  organizations: OrganizationDoc[]
  organizationMembers: OrganizationMemberDoc[]
}

class FakeIndexedQuery<T extends Record<string, unknown>> {
  constructor(
    private readonly rows: readonly T[],
    private readonly filters: ReadonlyArray<{ field: string; value: unknown }> = [],
  ) {}

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
  constructor(private readonly rows: readonly T[]) {}

  withIndex(_indexName: string, build: (query: FakeIndexedQuery<T>) => FakeIndexedQuery<T>) {
    return build(new FakeIndexedQuery(this.rows))
  }
}

function createCtx(tables: TestTables) {
  return {
    db: {
      async get(id: string) {
        return tables.organizations.find((row) => row._id === id) ?? null
      },
      query(table: keyof TestTables) {
        return new FakeQuery(tables[table] as Array<Record<string, unknown>>)
      },
    },
  }
}

describe("org DevApp catalog access", () => {
  const orgId = asId<"organizations">("org_1")
  const adminId = asId<"users">("user_admin")
  const memberId = asId<"users">("user_member")
  const outsiderId = asId<"users">("user_out")

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
      },
    }
    const spec = buildPublishedDevAppLaunchSpec(entry)
    const manifest = buildPublishedDevAppManifest(entry)

    expect(spec.kind).toBe("publishedDevApp")
    expect(spec.tileType).toBe("orgDevApp")
    expect(spec).not.toHaveProperty("projectId")
    expect(spec).not.toHaveProperty("devCommand")
    expect(manifest.launch.kind).toBe("publishedDevApp")
    expect(manifest.store.badgeLabel).toBe("Acme")
    expect(manifest.store.categoryLabel).toBe("Organization")
    expect(manifest.icon.src).toContain("/published/icon.png")
    expect(manifest.icon.className).toBe("scale-[1.25]")
  })
})

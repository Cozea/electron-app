import { describe, expect, it } from 'vitest'

import type { Id } from '../../convex/_generated/dataModel'
import {
  canAccessProjectByWorkspaceOrMembership,
  canEditProjectByWorkspaceOrMembership,
} from '../../convex/lib/workspaceProjectAccess'

type OrganizationRole = 'admin' | 'member' | 'viewer'
type ProjectRole = 'project_manager' | 'developer' | 'designer' | 'viewer'
type ProjectStatus = 'active' | 'deleted'

interface OrganizationDoc {
  _id: Id<'organizations'>
  workosId: string
  name: string
}

interface UserDoc {
  _id: Id<'devicePrincipals'>
  workosId: string
  email: string
}

interface MemberDoc {
  _id: Id<'members'>
  organizationId: Id<'organizations'>
  principalId: Id<'devicePrincipals'>
  role: OrganizationRole
  roleId?: Id<'organizationRoles'> | null
  permissionGrants?: string[]
  permissionDenies?: string[]
  updatedAt?: number
  joinedAt?: number
}

interface ProjectDoc {
  _id: Id<'projects'>
  organizationId: Id<'organizations'>
  slug: string
  name: string
  status: ProjectStatus
  createdBy: Id<'devicePrincipals'>
}

interface ProjectMemberDoc {
  _id: Id<'projectMembers'>
  projectId: Id<'projects'>
  principalId: Id<'devicePrincipals'>
  role: ProjectRole
  addedAt: number
  addedBy: Id<'devicePrincipals'>
}

interface OrganizationRoleDoc {
  _id: Id<'organizationRoles'>
  organizationId: Id<'organizations'>
  key: string
  name: string
  description: string
  baseRole: OrganizationRole
  permissions: string[]
  isSystem: boolean
}

interface TestTables {
  organizations: OrganizationDoc[]
  users: UserDoc[]
  members: MemberDoc[]
  projects: ProjectDoc[]
  projectMembers: ProjectMemberDoc[]
  organizationRoles: OrganizationRoleDoc[]
}

type TableName = keyof TestTables
type TableRow<T extends TableName> = TestTables[T][number]
type AnyRow = TableRow<TableName>

function asId<T extends string>(value: string): Id<T> {
  return value as Id<T>
}

class FakeIndexedQuery<T extends Record<string, unknown>> {
  constructor(
    private readonly rows: readonly T[],
    private readonly filters: ReadonlyArray<{ field: string; value: unknown }> = [],
  ) {}

  eq(field: string, value: unknown): FakeIndexedQuery<T> {
    return new FakeIndexedQuery(this.rows, [...this.filters, { field, value }])
  }

  async collect(): Promise<T[]> {
    return this.rows.filter((row) =>
      this.filters.every(({ field, value }) => row[field] === value),
    )
  }

  async first(): Promise<T | null> {
    const rows = await this.collect()
    return rows[0] ?? null
  }
}

class FakeQuery<T extends Record<string, unknown>> {
  constructor(private readonly rows: readonly T[]) {}

  withIndex(
    _indexName: string,
    build: (query: FakeIndexedQuery<T>) => FakeIndexedQuery<T>,
  ) {
    return build(new FakeIndexedQuery(this.rows))
  }
}

class FakeDb {
  constructor(private readonly tables: TestTables) {}

  async get(id: string): Promise<AnyRow | null> {
    for (const table of Object.values(this.tables)) {
      const match = table.find((row) => row._id === id)
      if (match) {
        return match
      }
    }

    return null
  }

  query<T extends TableName>(table: T): FakeQuery<TableRow<T>> {
    return new FakeQuery(this.tables[table])
  }
}

function createCtx(tables: Partial<TestTables>) {
  const fullTables: TestTables = {
    organizations: tables.organizations ?? [],
    users: tables.users ?? [],
    members: tables.members ?? [],
    projects: tables.projects ?? [],
    projectMembers: tables.projectMembers ?? [],
    organizationRoles: tables.organizationRoles ?? [],
  }

  return {
    db: new FakeDb(fullTables),
  } as Parameters<typeof canAccessProjectByWorkspaceOrMembership>[0]
}

describe('workspace project access', () => {
  it('keeps personal workspace owner access without a project membership row', async () => {
    const ownerId = asId<'devicePrincipals'>('user_owner')
    const personalOrgId = asId<'organizations'>('org_personal')
    const projectId = asId<'projects'>('project_personal_owner')
    const ctx = createCtx({
      organizations: [
        { _id: personalOrgId, workosId: 'personal:user_owner', name: 'Personal' },
      ],
      users: [
        { _id: ownerId, workosId: 'user_owner', email: 'owner@example.com' },
      ],
      projects: [
        {
          _id: projectId,
          organizationId: personalOrgId,
          slug: 'owner-project',
          name: 'Owner Project',
          status: 'active',
          createdBy: ownerId,
        },
      ],
    })

    await expect(canAccessProjectByWorkspaceOrMembership(ctx, projectId, ownerId)).resolves.toBe(true)
    await expect(canEditProjectByWorkspaceOrMembership(ctx, projectId, ownerId)).resolves.toBe(true)
  })

  it('preserves personal project invite access for invited viewers', async () => {
    const ownerId = asId<'devicePrincipals'>('user_owner')
    const inviteeId = asId<'devicePrincipals'>('user_invited')
    const personalOrgId = asId<'organizations'>('org_personal_invite')
    const projectId = asId<'projects'>('project_personal_invite')
    const ctx = createCtx({
      organizations: [
        { _id: personalOrgId, workosId: 'personal:user_owner', name: 'Personal' },
      ],
      users: [
        { _id: ownerId, workosId: 'user_owner', email: 'owner@example.com' },
        { _id: inviteeId, workosId: 'user_invited', email: 'invitee@example.com' },
      ],
      projects: [
        {
          _id: projectId,
          organizationId: personalOrgId,
          slug: 'shared-project',
          name: 'Shared Project',
          status: 'active',
          createdBy: ownerId,
        },
      ],
      projectMembers: [
        {
          _id: asId<'projectMembers'>('pm_personal_viewer'),
          projectId,
          principalId: inviteeId,
          role: 'viewer',
          addedAt: 1,
          addedBy: ownerId,
        },
      ],
    })

    await expect(canAccessProjectByWorkspaceOrMembership(ctx, projectId, inviteeId)).resolves.toBe(true)
    await expect(canEditProjectByWorkspaceOrMembership(ctx, projectId, inviteeId)).resolves.toBe(false)
  })

  it('keeps explicit org project membership authoritative for project edit access', async () => {
    const ownerId = asId<'devicePrincipals'>('user_workspace_owner')
    const principalId = asId<'devicePrincipals'>('user_project_editor')
    const orgId = asId<'organizations'>('org_workspace_editor')
    const projectId = asId<'projects'>('project_workspace_editor')
    const ctx = createCtx({
      organizations: [
        { _id: orgId, workosId: 'org_workspace_editor', name: 'Workspace' },
      ],
      users: [
        { _id: ownerId, workosId: 'user_workspace_owner', email: 'owner@example.com' },
        { _id: principalId, workosId: 'user_project_editor', email: 'editor@example.com' },
      ],
      members: [
        {
          _id: asId<'members'>('member_workspace_editor'),
          organizationId: orgId,
          principalId,
          role: 'viewer',
          permissionDenies: ['projects:view'],
        },
      ],
      projects: [
        {
          _id: projectId,
          organizationId: orgId,
          slug: 'editor-project',
          name: 'Editor Project',
          status: 'active',
          createdBy: ownerId,
        },
      ],
      projectMembers: [
        {
          _id: asId<'projectMembers'>('pm_workspace_editor'),
          projectId,
          principalId,
          role: 'developer',
          addedAt: 1,
          addedBy: ownerId,
        },
      ],
    })

    await expect(canAccessProjectByWorkspaceOrMembership(ctx, projectId, principalId)).resolves.toBe(true)
    await expect(canEditProjectByWorkspaceOrMembership(ctx, projectId, principalId)).resolves.toBe(true)
  })
})

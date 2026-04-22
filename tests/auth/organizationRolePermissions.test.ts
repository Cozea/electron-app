import { describe, expect, it } from 'vitest'

import { resolveEffectivePermissions } from '../../convex/lib/organizationRoles'
import { resolveWorkspaceCapabilities } from '../../src/lib/workspaces/capabilities'

describe('organization role permissions', () => {
  it('applies direct grants and direct denies to inherited permissions', () => {
    expect(
      resolveEffectivePermissions(
        ['members:view', 'roles:view'],
        ['roles:assign', 'members:view'],
        ['members:view'],
      ),
    ).toEqual(['roles:view', 'roles:assign'])
  })

  it('treats direct people-management permissions as members-surface access', () => {
    const capabilities = resolveWorkspaceCapabilities({
      organizationScoped: true,
      permissions: ['members:update_role'],
    })

    expect(capabilities.canViewWorkspaceMembers).toBe(true)
    expect(capabilities.canManageWorkspaceMembers).toBe(true)
    expect(capabilities.canViewWorkspaceRoles).toBe(true)
  })

  it('treats explicit role permissions as roles-surface access', () => {
    const capabilities = resolveWorkspaceCapabilities({
      organizationScoped: true,
      permissions: ['roles:assign'],
    })

    expect(capabilities.canViewWorkspaceRoles).toBe(true)
    expect(capabilities.canManageWorkspaceRoles).toBe(true)
    expect(capabilities.canViewWorkspaceMembers).toBe(false)
  })

  it('keeps personal workspace capabilities fully enabled', () => {
    const capabilities = resolveWorkspaceCapabilities({
      organizationScoped: false,
      permissions: [],
    })

    expect(capabilities.canCreateProjects).toBe(true)
    expect(capabilities.canManageWorkspaceBilling).toBe(true)
    expect(capabilities.canManageWorkspaceMembers).toBe(true)
    expect(capabilities.canManageWorkspaceRoles).toBe(true)
  })
})

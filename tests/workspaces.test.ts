import { describe, expect, it } from 'vitest'

import { isPersonalWorkspace, isPersonalWorkspaceId } from '../src/lib/workspaces'

describe('workspace helpers', () => {
  it('detects personal workspace IDs by prefix', () => {
    expect(isPersonalWorkspaceId('personal:user_123')).toBe(true)
    expect(isPersonalWorkspaceId('org_123')).toBe(false)
    expect(isPersonalWorkspaceId(undefined)).toBe(false)
  })

  it('detects personal workspace membership by workspaceType', () => {
    expect(
      isPersonalWorkspace({
        organizationId: 'org_123',
        workspaceType: 'personal',
      })
    ).toBe(true)
  })

  it('falls back to organizationId prefix when workspaceType is missing', () => {
    expect(
      isPersonalWorkspace({
        organizationId: 'personal:user_123',
      })
    ).toBe(true)
    expect(
      isPersonalWorkspace({
        organizationId: 'org_123',
      })
    ).toBe(false)
  })
})

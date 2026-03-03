const PERSONAL_WORKSPACE_PREFIX = 'personal:'

export function isPersonalWorkspaceId(organizationId: string | null | undefined): boolean {
  return typeof organizationId === 'string' && organizationId.startsWith(PERSONAL_WORKSPACE_PREFIX)
}

export function isPersonalWorkspace(
  membership:
    | {
        workspaceType?: 'personal' | 'organization'
        organizationId: string
      }
    | null
    | undefined
): boolean {
  if (!membership) return false
  return membership.workspaceType === 'personal' || isPersonalWorkspaceId(membership.organizationId)
}

export function getDefaultWorkspaceName(
  email: string | undefined,
  firstName: string | null | undefined
): string {
  if (firstName && firstName.trim().length > 0) {
    return `${firstName.trim()}'s Workspace`
  }

  const emailPrefix = email?.split('@')[0]?.trim()
  if (emailPrefix) {
    return `${emailPrefix}'s Workspace`
  }

  return 'My Workspace'
}

export function getPersonalProjectContactsCacheKey(
  userId?: string | null,
  projectId?: string | null
): string {
  return `personal-project-contacts-${userId ?? "none"}-${projectId ?? "none"}`
}

const activeCheckpointGroups = new Map<string, string>()

function normalizeProjectKey(projectId: string): string {
  return String(projectId).trim()
}

export function ensureActiveCheckpointGroup(projectId: string): string {
  const key = normalizeProjectKey(projectId)
  const existing = activeCheckpointGroups.get(key)
  if (existing) {
    return existing
  }
  const next = crypto.randomUUID()
  activeCheckpointGroups.set(key, next)
  return next
}

export function getActiveCheckpointGroup(projectId: string): string | null {
  const key = normalizeProjectKey(projectId)
  return activeCheckpointGroups.get(key) ?? null
}

export function clearActiveCheckpointGroup(projectId: string, checkpointGroupId?: string | null): void {
  const key = normalizeProjectKey(projectId)
  if (!checkpointGroupId) {
    activeCheckpointGroups.delete(key)
    return
  }
  const current = activeCheckpointGroups.get(key)
  if (current === checkpointGroupId) {
    activeCheckpointGroups.delete(key)
  }
}

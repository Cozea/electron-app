const DEFAULT_WORKSPACE_LANE_ID = "collab"

export function normalizeWorkspaceLaneId(laneId: string | null | undefined): string {
  const normalized = laneId?.trim()
  return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_LANE_ID
}

export function normalizeWorkspaceProjectPath(
  projectPath: string | null | undefined,
): string | null {
  const trimmed = projectPath?.trim()
  if (!trimmed) {
    return null
  }

  return trimmed
}

export function buildLegacyWorkspaceIdentityKey(
  projectId: string | null | undefined,
  laneId?: string | null,
): string | null {
  const normalizedProjectId = projectId?.trim()
  if (!normalizedProjectId) {
    return null
  }

  return `${normalizedProjectId}::${normalizeWorkspaceLaneId(laneId)}`
}

export function buildWorkspaceIdentityKey(
  projectId: string | null | undefined,
  workspaceId: string | null | undefined,
  laneId?: string | null,
  workspaceRevision: number = 1,
): string | null {
  const legacyKey = buildLegacyWorkspaceIdentityKey(projectId, laneId)
  if (!legacyKey || !workspaceId) {
    return null
  }

  return `${legacyKey}::${workspaceId}::v${workspaceRevision}`
}

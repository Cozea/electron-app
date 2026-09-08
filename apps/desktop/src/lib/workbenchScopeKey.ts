import {
  buildLegacyWorkspaceIdentityKey,
  buildWorkspaceIdentityKey,
  normalizeWorkspaceId,
} from "@/lib/workspaceIdentity"

/**
 * How a project + lane + workspace is addressed as one key.
 *
 * Neutral on purpose. This is vocabulary, not workbench state: dev-server and
 * devapps need to name the same scope the workbench does, and while the builder
 * lived inside workbenchStore they had to import a 1,600-line store — and the
 * workbench feature itself — to compute a string.
 */
export const DEFAULT_WORKBENCH_LANE_ID = "collab"

export function normalizeLaneId(laneId: string | null | undefined): string {
  const normalized = laneId?.trim()
  return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKBENCH_LANE_ID
}

export function buildLegacyWorkbenchScopeKey(projectId: string, laneId?: string | null): string {
  return buildLegacyWorkspaceIdentityKey(projectId, normalizeLaneId(laneId))!
}

export function buildWorkbenchScopeKey(
  projectId: string,
  laneId?: string | null,
  workspaceId?: string | null,
): string {
  const normalizedWorkspace = normalizeWorkspaceId(workspaceId)
  if (!normalizedWorkspace) {
    return buildLegacyWorkbenchScopeKey(projectId, laneId)
  }

  return buildWorkspaceIdentityKey(projectId, normalizedWorkspace, normalizeLaneId(laneId))!
}

export interface ParsedWorkbenchScopeKey {
  projectId: string
  laneId: string
  workspaceId: string
  workspaceRevision: number
}

export function parseWorkbenchScopeKey(
  scopeKey: string,
  projectId: string,
): ParsedWorkbenchScopeKey | null {
  const normalizedProjectId = projectId.trim()
  const prefix = `${normalizedProjectId}::`
  if (!normalizedProjectId || !scopeKey.startsWith(prefix)) return null

  const remainder = scopeKey.slice(prefix.length)
  const revisionSeparator = remainder.lastIndexOf('::v')
  if (revisionSeparator <= 0) return null
  const revision = Number(remainder.slice(revisionSeparator + 3))
  if (!Number.isSafeInteger(revision) || revision < 1) return null

  const identity = remainder.slice(0, revisionSeparator)
  const workspaceSeparator = identity.indexOf('::')
  if (workspaceSeparator <= 0) return null
  const laneId = identity.slice(0, workspaceSeparator)
  const workspaceId = identity.slice(workspaceSeparator + 2)
  if (!laneId || !workspaceId) return null
  return { projectId: normalizedProjectId, laneId, workspaceId, workspaceRevision: revision }
}

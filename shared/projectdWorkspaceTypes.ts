/** Device-local binding registration; not a cloud project or sharing grant. */
export interface ProjectdWorkspaceRegistration {
  workspaceId: string
  projectId: string
  rootPath: string
  projectRootPath?: string
  projectRootRelativePath?: string
  gitRootPath?: string | null
  gitOriginUrl?: string | null
  source?: string
  storageOwnership?: "managed" | "attached"
  managedRootId?: string | null
  markerPolicy?: string
  workspaceRevision?: number
}

export interface ProjectdWorkspaceRecord {
  workspaceId: string
  projectId: string
  rootPath: string
  projectRootRelativePath: string
  projectRootPath: string
  gitRootPath: string | null
  gitOriginUrl: string | null
  source: string
  storageOwnership: "managed" | "attached"
  managedRootId: string | null
  markerPolicy: string
  isActive: boolean
  workspaceRevision: number
  createdAt: number
  updatedAt: number
  lastOpenedAt: number | null
}

export interface ProjectdWorkspaceCloseRequest {
  workspaceId: string
  projectId: string
  projectRootPath: string
  workspaceRevision: number
  preflightOnly: boolean
}

export function isProjectdWorkspaceCloseRequest(value: unknown): value is ProjectdWorkspaceCloseRequest {
  if (!value || typeof value !== "object") return false
  const input = value as Record<string, unknown>
  return isProjectdWorkspaceRegistration({ ...input, rootPath: input.projectRootPath }) &&
    Number.isSafeInteger(input.workspaceRevision) && Number(input.workspaceRevision) >= 1 && typeof input.preflightOnly === "boolean"
}

export function isProjectdWorkspaceRegistration(value: unknown): value is ProjectdWorkspaceRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  const identifier = (field: unknown) => typeof field === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(field)
  const absolutePath = (field: unknown) => typeof field === "string" && field.startsWith("/") && field.length <= 4096 && !field.includes("\0")
  if (!identifier(input.workspaceId) || !identifier(input.projectId) || !absolutePath(input.rootPath)) return false
  if (input.projectRootPath !== undefined && !absolutePath(input.projectRootPath)) return false
  if (input.gitRootPath !== undefined && input.gitRootPath !== null && !absolutePath(input.gitRootPath)) return false
  if (input.gitOriginUrl !== undefined && input.gitOriginUrl !== null && (typeof input.gitOriginUrl !== "string" || input.gitOriginUrl.length > 4096)) return false
  if (input.source !== undefined && (typeof input.source !== "string" || input.source.length > 128)) return false
  if (input.storageOwnership !== undefined && input.storageOwnership !== "attached" && input.storageOwnership !== "managed") return false
  if (input.managedRootId !== undefined && input.managedRootId !== null && !identifier(input.managedRootId)) return false
  if (input.markerPolicy !== undefined && !["required", "git_private", "none"].includes(String(input.markerPolicy))) return false
  if (input.projectRootRelativePath !== undefined && (typeof input.projectRootRelativePath !== "string" ||
    input.projectRootRelativePath.length > 4096 || input.projectRootRelativePath.startsWith("/") || input.projectRootRelativePath.includes("\0") ||
    input.projectRootRelativePath.split(/[\\/]/).includes(".."))) return false
  return input.workspaceRevision === undefined || Number.isSafeInteger(input.workspaceRevision) && Number(input.workspaceRevision) >= 1
}

export interface ProjectdProjectRemovalRequest {
  operationId: string
  projectId: string
  phase: "prepare" | "finalize" | "cancel"
  workspaces: Array<{ workspaceId: string; projectRootPath: string; workspaceRevision: number }>
}
export function isProjectdProjectRemovalRequest(value: unknown): value is ProjectdProjectRemovalRequest {
  if (!value || typeof value !== "object") return false
  const input = value as Record<string, unknown>
  const id = (item: unknown) => typeof item === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(item)
  return id(input.operationId) && id(input.projectId) && ["prepare", "finalize", "cancel"].includes(String(input.phase)) &&
    Array.isArray(input.workspaces) && input.workspaces.length <= 32 && input.workspaces.every((item: unknown) => {
      if (!item || typeof item !== "object") return false
      return isProjectdWorkspaceCloseRequest({ ...item, projectId: input.projectId, preflightOnly: true })
    }) && new Set(input.workspaces.map((item) => item.workspaceId)).size === input.workspaces.length
}

// ─── Enumerations ────────────────────────────────────────────────────────────

export type CwdSpec =
  | { kind: "projectRoot" }
  | { kind: "gitRoot" }
  | { kind: "relative"; path: string }

export type WorkspaceVerificationStatus =
  | "verified"
  | "missing"
  | "not-directory"
  | "unreadable"
  | "marker-missing"
  | "marker-mismatched-project"
  | "marker-mismatched-workspace"
  | "repo-missing"
  | "repo-mismatched"
  | "ambiguous"
  | "untrusted"
  | "needs-user-confirmation"

export type WorkspaceSource =
  | "create"
  | "clone"
  | "import"
  | "locate"
  | "repair"
  | "migrate_registry_manual"
  | "migrate_registry_cloud_hint"
  | "migrate_registry_attached_import"
  | "migrate_registry_slug_resolution"

export type WorkspaceLaneKind = "shared" | "branch" | "worktree" | "task" | "detached"

export type WorkspaceConflictReason =
  | "duplicate_path"
  | "marker_mismatch"
  | "repo_mismatch"
  | "missing_path"
  | "ambiguous_candidates"

export type WorkspaceConflictStatus = "open" | "resolved" | "ignored"

// ─── Repo identity ────────────────────────────────────────────────────────────

export type RepoIdentity =
  | { provider: "github"; fullName: string; url: string }
  | { provider: "gitlab"; fullName: string; url: string }
  | { provider: "cozea"; projectId: string; url: string }
  | { provider: "unknown"; url: string }

// ─── Workspace marker (written to disk) ──────────────────────────────────────

export interface WorkspaceMarker {
  version: 1
  workspaceId: string
  projectId: string
  createdBy: "cozea"
  createdAt: number
}

// ─── DTOs (renderer-safe, serializable) ──────────────────────────────────────

export interface LocalWorkspaceDTO {
  workspaceId: string
  projectId: string

  label: string | null

  /** Human-readable path shown in UI. */
  displayPath: string

  rootPath: string
  projectRootRelativePath: string
  projectRootPath: string

  gitRootPath: string | null
  gitOriginUrl: string | null
  gitRepoIdentity: RepoIdentity | null

  verificationStatus: WorkspaceVerificationStatus
  verificationReason: string | null
  verifiedAt: number | null

  source: WorkspaceSource

  isActive: boolean
  workspaceRevision: number

  createdAt: number
  updatedAt: number
  lastOpenedAt: number | null
}

export interface WorkspaceLaneDTO {
  laneId: string
  workspaceId: string
  projectId: string

  kind: WorkspaceLaneKind

  branch: string | null
  sharedBranch: string | null

  /** Human-readable path shown in UI. */
  displayPath: string

  projectRootPath: string
  gitRootPath: string | null

  isActive: boolean

  createdAt: number
  updatedAt: number
  lastOpenedAt: number | null
}

export interface RuntimeIdentityDTO {
  runtimeSessionId: string
  projectId: string
  workspaceId: string
  laneId: string
  workspaceRevision: number
}

export interface WorkspaceConflictDTO {
  conflictId: string
  projectId: string | null
  workspaceId: string | null
  candidatePath: string
  candidateRealPath: string | null
  existingWorkspaceId: string | null
  existingProjectId: string | null
  reason: WorkspaceConflictReason
  status: WorkspaceConflictStatus
  createdAt: number
  resolvedAt: number | null
}

// ─── Workspace candidates ─────────────────────────────────────────────────────

export interface WorkspaceCandidate {
  path: string
  realPath: string
  score: number
  reasons: string[]
  warnings: string[]
  verificationStatus: WorkspaceVerificationStatus
  repoIdentity: RepoIdentity | null
  markerProjectId: string | null
  markerWorkspaceId: string | null
}

// ─── Resolution actions ───────────────────────────────────────────────────────

export type WorkspaceResolutionAction =
  | { kind: "clone"; label: string }
  | { kind: "create"; label: string }
  | { kind: "locate"; label: string }
  | { kind: "forget"; workspaceId: string; label: string }
  | { kind: "force-bind"; label: string }
  | { kind: "open-found"; projectId: string; label: string }

// ─── workspace:resolveProject ─────────────────────────────────────────────────

export interface ResolveProjectWorkspaceRequest {
  projectId: string
  projectSlug?: string | null
  expectedRepo?: RepoIdentity | null
  preferredWorkspaceId?: string | null
  preferredLaneId?: string | null
  allowCandidateScan?: boolean
}

export type ResolveProjectWorkspaceResult =
  | {
      status: "ready"
      projectId: string
      workspace: LocalWorkspaceDTO
      lane: WorkspaceLaneDTO
      runtimeIdentity: RuntimeIdentityDTO
      collaborationScopeId: string
    }
  | {
      status: "missing-binding"
      projectId: string
      candidates?: WorkspaceCandidate[]
      actions: WorkspaceResolutionAction[]
    }
  | {
      status: "broken-binding"
      projectId: string
      workspace: LocalWorkspaceDTO
      reason: WorkspaceVerificationStatus
      candidates?: WorkspaceCandidate[]
      actions: WorkspaceResolutionAction[]
    }
  | {
      status: "ambiguous"
      projectId: string
      candidates: WorkspaceCandidate[]
      actions: WorkspaceResolutionAction[]
    }
  | {
      status: "needs-clone"
      projectId: string
      repo?: RepoIdentity
      actions: WorkspaceResolutionAction[]
    }

// ─── workspace:bindExistingFolder ────────────────────────────────────────────

export interface BindExistingFolderRequest {
  projectId: string
  folderPath: string
  projectRootRelativePath?: string
  expectedRepo?: RepoIdentity | null
  writeMarker?: boolean
  setActive?: boolean
  forceBind?: boolean
  source?: WorkspaceSource
}

export interface BindExistingFolderResult {
  success: boolean
  workspace?: LocalWorkspaceDTO
  conflicts?: WorkspaceConflictDTO[]
  error?: string
}

// ─── workspace:createForProject ──────────────────────────────────────────────

export interface CreateWorkspaceForProjectRequest {
  projectId: string
  slug: string
  rootId?: string
  rootPathOverride?: string
  initGit?: boolean
  setActive?: boolean
}

export interface CreateWorkspaceForProjectResult {
  success: boolean
  workspace?: LocalWorkspaceDTO
  error?: string
}

// ─── workspace:cloneForProject ───────────────────────────────────────────────

export interface CloneWorkspaceForProjectRequest {
  projectId: string
  slug: string
  repoUrl: string
  branch?: string
  provider?: string
  rootId?: string
  rootPathOverride?: string
  setActive?: boolean
}

export interface CloneWorkspaceForProjectResult {
  success: boolean
  workspace?: LocalWorkspaceDTO
  normalizedRepoUrl?: string
  error?: string
}

// ─── Active workspace context (renderer) ─────────────────────────────────────

export interface ActiveWorkspaceContextValue {
  projectId: string
  projectSlug: string | null
  projectName: string | null

  workspace: LocalWorkspaceDTO
  lane: WorkspaceLaneDTO
  runtime: RuntimeIdentityDTO

  collaborationScopeId: string
}

// ─── Internal DB record shape (electron-only, not exported to renderer) ───────
// These mirror the DB columns with camelCase names.

export interface LocalWorkspaceRecord {
  workspaceId: string
  projectId: string
  rootId: string | null
  label: string | null
  rootPath: string
  realPath: string
  projectRootRelativePath: string
  projectRootPath: string
  gitRootPath: string | null
  gitDirPath: string | null
  gitHeadBranch: string | null
  gitOriginUrl: string | null
  gitRepoIdentityJson: string | null
  filesystemDevice: string | null
  filesystemInode: string | null
  filesystemBirthtimeMs: number | null
  filesystemMtimeMs: number | null
  filesystemVolumeId: string | null
  markerWorkspaceId: string | null
  markerProjectId: string | null
  markerPath: string | null
  verificationStatus: WorkspaceVerificationStatus
  verificationReason: string | null
  verifiedAt: number | null
  source: WorkspaceSource
  isActive: number
  workspaceRevision: number
  createdAt: number
  updatedAt: number
  lastOpenedAt: number | null
}

export interface WorkspaceLaneRecord {
  laneId: string
  workspaceId: string
  projectId: string
  kind: WorkspaceLaneKind
  branch: string | null
  sharedBranch: string | null
  worktreePath: string | null
  worktreeRealPath: string | null
  projectRootRelativePath: string
  projectRootPath: string
  gitRootPath: string | null
  gitDirPath: string | null
  isActive: number
  createdAt: number
  updatedAt: number
  lastOpenedAt: number | null
}

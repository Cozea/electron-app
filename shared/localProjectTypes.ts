import type { Doc, Id } from "../convex/_generated/dataModel"
import type { LocalWorkspaceDTO } from "./workspaceTypes"

declare const localProjectIdentity: unique symbol

/** Historical project references remain valid local keys after backfill. */
export type LocalProjectId = string & { readonly [localProjectIdentity]: true }
export type CloudProjectId = Id<"projects">

export const LOCAL_PROJECT_ID_PREFIX = "lpj_"

export function isDeviceOnlyProjectId(value: string): boolean {
  return /^lpj_[0-9a-f]{32}$/.test(value)
}

export type LocalProjectStatus = "provisioning" | "active" | "removed"

export interface LocalProjectDTO {
  projectId: LocalProjectId
  name: string
  localName: string | null
  fallbackName: string
  slug: string
  hidden: boolean
  status: LocalProjectStatus
  cloudProjectId: CloudProjectId | null
  sharedName: string | null
  sharedStatus: Doc<"projects">["status"] | null
  /** Scope of the last observed projection, never authorization. */
  sharedIdentityKey: string | null
  sharedObservedAt: number | null
  createdAt: number
  updatedAt: number
}

export type LocalProjectResult<A> =
  | { success: true; value: A }
  | { success: false; error: string }

export interface CreateLocalProjectEntryRequest {
  operationId: string
  kind?: "create" | "attach"
  name: string
  slug: string
  details?: ProjectOperationDetails
}

export interface UpdateLocalProjectMetadataRequest {
  projectId: LocalProjectId
  localName?: string | null
  hidden?: boolean
}

export interface ObserveSharedProjectRequest {
  projectId: LocalProjectId
  cloudProjectId: CloudProjectId
  name: string
  slug: string
  status: Doc<"projects">["status"]
  identityKey: string
}

export type ProjectOperationKind = "create" | "attach" | "repair" | "remove" | "share" | "delete_shared" | "github_repo"
export type ProjectOperationState = "pending" | "running" | "unknown" | "failed" | "completed" | "cancelled"
export type ProjectOperationStage = "requested" | "prepared" | "effect_applied" | "binding_committed" | "completed"

export interface ProjectOperationDetails {
  name?: string
  slug?: string
  sourceFolder?: string
  parentFolder?: string
  sourceDevice?: string
  sourceInode?: string
  sourceBirthtime?: string
  destinationFolder?: string
  workspaceId?: string
  managedRootId?: string
  cloudProjectId?: CloudProjectId
  githubOwner?: string
  githubName?: string
  removeLocalData?: boolean
  trashManagedFolder?: boolean
  initGit?: boolean
  previousFolder?: string
  expectedWorkspaceRevision?: string
  repairOperationId?: string
  /** Preservation-only workspace close, journaled under the remove family. */
  closeOnly?: boolean
  removalScopeJson?: string
  runtimeRootsJson?: string
}

export interface RepairLocalProjectRequest {
  operationId: string
  projectId: LocalProjectId
  workspaceId: string
  folderPath: string
}

export interface CreateLocalProjectRequest {
  operationId: string
  name: string
  slug: string
  parentFolder?: string
}

export interface OpenLocalProjectRequest {
  operationId: string
  name: string
  slug: string
  folderPath: string
}

export interface LocalProjectWorkspaceOutcome {
  project: LocalProjectDTO
  workspace: LocalWorkspaceDTO
  operationId: string | null
  reusedExisting: boolean
}

export interface ProjectOperationDTO {
  operationId: string
  projectId: LocalProjectId
  kind: ProjectOperationKind
  state: ProjectOperationState
  stage: ProjectOperationStage
  details: ProjectOperationDetails
  requestDetails: ProjectOperationDetails
  revision: number
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export interface BeginProjectOperationRequest {
  operationId: string
  projectId: LocalProjectId
  kind: ProjectOperationKind
  details: ProjectOperationDetails
}

export interface AdvanceProjectOperationRequest {
  operationId: string
  expectedRevision: number
  state: ProjectOperationState
  stage?: ProjectOperationStage
  /** Add resource evidence; an already-recorded resource cannot be replaced. */
  details?: ProjectOperationDetails
  lastError?: string | null
}

export interface LocalProjectsElectronAPI {
  list: () => Promise<LocalProjectDTO[]>
  get: (projectId: string) => Promise<LocalProjectDTO | null>
  createEntry: (request: CreateLocalProjectEntryRequest) => Promise<LocalProjectResult<LocalProjectDTO>>
  updateMetadata: (request: UpdateLocalProjectMetadataRequest) => Promise<LocalProjectResult<LocalProjectDTO>>
  observeShared: (request: ObserveSharedProjectRequest) => Promise<LocalProjectResult<LocalProjectDTO>>
  beginOperation: (request: BeginProjectOperationRequest) => Promise<LocalProjectResult<ProjectOperationDTO>>
  getOperation: (operationId: string) => Promise<ProjectOperationDTO | null>
  getCompletedRepair: (workspaceId: string, previousFolder: string | null, currentFolder: string, previousRevision?: number) => Promise<ProjectOperationDTO | null>
  advanceOperation: (request: AdvanceProjectOperationRequest) => Promise<LocalProjectResult<ProjectOperationDTO>>
  listRecoverableOperations: (projectId?: string) => Promise<ProjectOperationDTO[]>
  create: (request: CreateLocalProjectRequest) => Promise<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  open: (request: OpenLocalProjectRequest) => Promise<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  resume: (operationId: string) => Promise<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  repair: (request: RepairLocalProjectRequest) => Promise<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  resumeRepair: (operationId: string) => Promise<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  close: (request: CloseLocalProjectWorkspaceRequest) => Promise<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  resumeClose: (operationId: string) => Promise<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  onRemovalRequest: (callback: (request: ProjectRemovalRendererRequest) => void) => () => void
  replyRemoval: (requestId: string, error: string | null) => Promise<void>
  remove: (request: RemoveLocalProjectRequest) => Promise<LocalProjectResult<LocalProjectRemovalOutcome>>
  resumeRemove: (operationId: string) => Promise<LocalProjectResult<LocalProjectRemovalOutcome>>
  cancelRemove: (operationId: string) => Promise<LocalProjectResult<ProjectOperationDTO>>
  confirmTrashOutcome: (operationId: string, workspaceId: string) => Promise<LocalProjectResult<ProjectOperationDTO>>
  cancelClose: (operationId: string) => Promise<LocalProjectResult<ProjectOperationDTO>>
}

export interface CloseLocalProjectWorkspaceRequest {
  operationId: string
  projectId: LocalProjectId
  workspaceId: string
}

export interface RemoveLocalProjectRequest {
  operationId: string
  projectId: LocalProjectId
  removeLocalData: boolean
  trashManagedFolder: boolean
}
export interface LocalProjectRemovalOutcome {
  projectId: LocalProjectId
  operationId: string
  retainedLocalData: boolean
}
export interface ProjectRemovalWorkspace {
  workspace: LocalWorkspaceDTO
  roots: string[]
  trash: { folder: string; staging: string; device: string; inode: string; birthtime: string } | null
}
export interface ProjectOperationEffect {
  effectId: string
  state: "requested" | "applied" | "unknown"
  evidenceJson: string
}

export interface ProjectRemovalRendererRequest {
  requestId: string
  operationId: string
  projectId: LocalProjectId
  slug: string
  workspaceIds: string[]
  phase: "quiesce" | "erase"
}

import type { CollaborationParticipantRole, CollaborationSessionDescriptor } from "./collaborationSession"
import type { CollaborationRuntimeAPI } from "./collaborationRuntime"
import type { LocalWorkspaceDTO } from "./workspaceTypes"

export interface RepositoryDownloadProgress {
  projectId: string
  phase: "authorizing" | "fetching" | "materializing" | "complete" | "cancelled" | "failed"
}

export const COLLABORATION_DATA_GENERATION = 3 as const

export interface SessionWorkspaceBinding {
  generation: typeof COLLABORATION_DATA_GENERATION
  sessionId: string
  projectId: string
  repositoryId: string
  workspaceId: string
  sourceWorkspaceId: string
  sessionBranch: string
  baseCommitSha: string
  role: CollaborationParticipantRole
  state: "joining" | "active" | "left" | "ended"
  joinedAt: number
  adoptedThroughSequence?: number
  recoveryKeyVersion?: number
}

export interface CollaborationWorkspaceAuthority {
  userId: string
  session: CollaborationSessionDescriptor
  role: CollaborationParticipantRole
  cloneUrl: string
  expiresAt: number
}

export interface CollaborationTextChange {
  path: string
  content: string | null
  executable?: boolean
}

export interface CollaborationImportCandidate extends CollaborationTextChange {
  /** Hash of reviewed local bytes (or the deletion sentinel). Rechecked on import. */
  reviewHash: string
}

export interface PreparedCollaborationCommit {
  generation: typeof COLLABORATION_DATA_GENERATION
  sessionId: string
  parentCommitSha: string
  commitSha: string
  throughSequence: number
  leaseExpiresAt: number
  preparedAt: number
  state: "prepared" | "pushed" | "published" | "discarded"
}

export interface PrepareCollaborationCommitInput {
  sessionId: string
  accessToken: string
  throughSequence: number
  textChanges: CollaborationTextChange[]
  binaryPaths: string[]
  message: string
  authorName: string
  authorEmail: string
}

export interface CollaborationDesktopAPI {
  downloadRepository(input: { projectId: string; slug: string }): Promise<LocalWorkspaceDTO>
  cancelDownload(projectId: string): Promise<void>
  onDownloadProgress(listener: (progress: RepositoryDownloadProgress) => void): () => void
  runtime: CollaborationRuntimeAPI
  prepare(input: { sessionId: string; sourceWorkspaceId: string; accessToken: string }): Promise<SessionWorkspaceBinding>
  leave(input: { sessionId: string; ended?: boolean }): Promise<SessionWorkspaceBinding>
  getBinding(sessionId: string): Promise<SessionWorkspaceBinding | null>
  bindingForWorkspace(workspaceId: string): Promise<SessionWorkspaceBinding | null>
  inspectImportableChanges(sourceWorkspaceId: string): Promise<CollaborationImportCandidate[]>
  readReviewedImport(input: { sessionId: string; selected: Array<{ path: string; reviewHash: string }>; accessToken: string }): Promise<CollaborationTextChange[]>
  prepareCommit(input: PrepareCollaborationCommitInput): Promise<PreparedCollaborationCommit>
  pushPrepared(input: { sessionId: string; accessToken: string }): Promise<PreparedCollaborationCommit>
  adoptPublished(input: { sessionId: string; accessToken: string; sharedPaths: string[] }): Promise<SessionWorkspaceBinding>
}

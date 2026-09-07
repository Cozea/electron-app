import type { CollaborationConnectionState } from "./CollaborationTransport"
import type { SharedSessionFile } from "./SessionFileDocument"
import type { PreparedCollaborationCommit } from "./collaborationDesktop"
import type { CollaborationBinaryCandidate, CollaborationBinarySelection, CollaborationPreparedReview } from "./collaborationCommitReview"

export interface SessionRuntimeSnapshot {
  sessionId: string
  role: "editor" | "observer"
  connection: CollaborationConnectionState
  error: string | null
  sequence: number
  files: Array<Omit<SharedSessionFile, "content">>
  conflicts: Array<{ path: string; fileIds: string[] }>
  renameConflicts?: Array<{ fileId: string; paths: string[] }>
  gitOnlyPaths: string[]
}
export interface RecoveredOfflineEntry { id: string; reason?: string; incomplete: boolean; retainedRecords: number; unresolvedFiles: number }
export interface RecoveredOfflineFile extends SharedSessionFile { recoveryId: string; canonicalContent: string | null; savingPath: string | null }
export interface CollaborationRuntimeAPI {
  recoveryEntries(sessionId: string): Promise<RecoveredOfflineEntry[]>
  recoveredFiles(sessionId: string): Promise<RecoveredOfflineFile[]>
  resolveRecovered(input: { sessionId: string; recoveryId: string; fileId: string; action: "save" | "discard"; path?: string }): Promise<void>
  recoveryInventory(): Promise<import("./collaborationRecovery").CollaborationRecoveryInventory>
  cleanupRecovery(sessionId: string): Promise<import("./collaborationRecovery").CollaborationRecoveryCleanupResult>
  setup(organizationId: string): Promise<{ authorizationUrl: string }>
  resolve(input: { projectId: string; branch?: string }): Promise<{ branch: string; commitSha: string; branches: string[]; resolutionId: string; repositoryId: string; fullName: string }>
  control(input: { operation: string; args: Record<string, unknown> }): Promise<unknown>
  open(input: { sessionId: string; sourceWorkspaceId: string }): Promise<boolean>
  active(projectId: string): Promise<string | null>
  snapshot(sessionId: string): Promise<SessionRuntimeSnapshot>
  openFile(input: { sessionId: string; path: string }): Promise<SharedSessionFile>
  editorState(sessionId: string): Promise<Uint8Array>
  edit(input: { sessionId: string; update: Uint8Array }): Promise<void>
  createFile(input: { sessionId: string; path: string; content?: string }): Promise<SharedSessionFile>
  renameFile(input: { sessionId: string; fileId: string; path: string }): Promise<void>
  deleteFile(input: { sessionId: string; fileId: string }): Promise<void>
  restoreFile(input: { sessionId: string; fileId: string; path?: string }): Promise<void>
  binaryCandidates(sessionId: string): Promise<CollaborationBinaryCandidate[]>
  reviewPrepared(input: { sessionId: string; commitSha: string }): Promise<CollaborationPreparedReview>
  commit(input: { sessionId: string; binaryPaths: string[]; binaryReviews?: CollaborationBinarySelection[]; message: string; authorName: string; authorEmail: string }): Promise<PreparedCollaborationCommit>
  push(input: { sessionId: string; commitSha: string }): Promise<PreparedCollaborationCommit>
  prepared(sessionId: string): Promise<PreparedCollaborationCommit | null>
  discard(sessionId: string): Promise<void>
  importChanges(input: { sessionId: string; selected: Array<{ path: string; reviewHash: string }> }): Promise<void>
  leave(input: { sessionId: string; end?: boolean }): Promise<void>
  retry(sessionId: string): Promise<void>
  onChanged(listener: (sessionId: string) => void): () => void
}

export interface ExternalWorkspaceChanges { paths: string[]; renames: Array<{ from: string; to: string; score: number }> }

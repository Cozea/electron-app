export const COLLABORATION_RECOVERY_LIMIT_BYTES = 1024 * 1024 * 1024
export const COLLABORATION_ROOM_RECOVERY_LIMIT_BYTES = 256 * 1024 * 1024

export interface RecoveryStorageInventory {
  bytes: number
  files: number
  directories: number
  pendingFiles: number
  outboxRecords: number
  editorIngressRecords: number
  checkpointRecords: number
  projectionBackups: number
}
export interface CollaborationRecoveryInventory extends RecoveryStorageInventory {
  limitBytes: number
  roomLimitBytes: number
}
export interface CollaborationRecoveryCleanupResult { files: number; bytes: number }

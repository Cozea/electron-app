export interface EncryptedCheckpointDescriptor {
  generation: 3
  id: string
  roomId: string
  projectId: string
  sequence: number
  keyVersion: number
  totalChars: number
  chunkCount: number
  digest: string
  createdAt: number
}
export interface CheckpointUploadLease {
  id: string
  userId: string
  sequence: number
  keyVersion: number
  expiresAt: number
}

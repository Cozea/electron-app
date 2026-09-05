export interface CollaborationOutboxRecord {
  id: string
  projectId: string
  roomId: string
  keyVersion: number
  updateBinary: string
  timestamp: number
  migratedFrom?: { keyVersion: number; id: string; kind?: "ingress" }
}
export interface CollaborationOutbox {
  enqueue(record: CollaborationOutboxRecord): Promise<void>
  list(roomId: string, keyVersion: number): Promise<CollaborationOutboxRecord[]>
  acknowledge(id: string): Promise<void>
  close(): void
}

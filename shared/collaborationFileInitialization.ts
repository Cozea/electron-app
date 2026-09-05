export interface FileInitializationLease {
  fileId: string
  leaseId: string
  userId: string
  keyVersion: number
  expiresAt: number
  sequence?: number
}
export interface FileInitializationOrigin {
  type: "file-initialization"
  fileId: string
  leaseId: string
}
export function fileInitializationOrigin(value: unknown): FileInitializationOrigin | null {
  if (!value || typeof value !== "object" || !("type" in value) || value.type !== "file-initialization") return null
  const origin = value as FileInitializationOrigin
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(origin.fileId) || !/^[A-Za-z0-9_-]{1,160}$/.test(origin.leaseId)) throw new Error("Invalid file initialization authority")
  return { type: "file-initialization", fileId: origin.fileId, leaseId: origin.leaseId }
}

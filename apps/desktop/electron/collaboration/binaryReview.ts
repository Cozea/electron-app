import { createHash } from "node:crypto"

export function isSharedTextBytes(buffer: Uint8Array): boolean {
  if (buffer.byteLength > 2 * 1024 * 1024 || buffer.includes(0)) return false
  try { new TextDecoder("utf-8", { fatal: true }).decode(buffer); return true } catch { return false }
}

/** Bind the selected byte snapshot and executable bit; a delete has a separate
 * domain from an empty file. Callers do not send raw binary bytes to the renderer. */
export function binaryReviewHash(buffer: Uint8Array | null, executable: boolean): string {
  const hash = createHash("sha256")
  hash.update(buffer === null ? "deleted\0" : `binary\0${executable ? "executable" : "regular"}\0`)
  if (buffer !== null) hash.update(buffer)
  return hash.digest("hex")
}

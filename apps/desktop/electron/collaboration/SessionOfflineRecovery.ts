import * as Y from "yjs"
import { assertSharedFilePath } from "../../../../shared/collaborationPaths"
import { createHash } from "node:crypto"
import { bytesToEnvelope, decryptPayload, encryptPayload, envelopeToBytes } from "../../../../shared/collaborationCipher"
import type { SharedSessionFile } from "../../../../shared/SessionFileDocument"
import { DurableSessionStore } from "./DurableSessionStore"

export interface RecoverySource { keyVersion: number; id: string; kind?: "ingress" }
export interface OfflineRecoveryEntry {
  id: string
  kind?: "external"
  reason?: string
  projection?: string
  incomplete: boolean
  sources: RecoverySource[]
  /** Full Yjs branch, including pending structs and delete sets, never applied to canonical state. */
  branch: string
  files: SharedSessionFile[]
  resolved: string[]
  saves: Record<string, { path: string; fileId: string; recordId: string; updateBinary: string; update: string; keyVersion: number }>
}
export interface OfflineRecoveryJournal { version: 1; entries: OfflineRecoveryEntry[] }
export interface RecoveryCipher { roomKeyBase64: string; keyVersion: number }
export const recoverySourceId = (source: RecoverySource): string => `${source.keyVersion}:${source.kind ?? "outbox"}:${source.id}`
export const recoveryEntryId = (sources: RecoverySource[]): string => createHash("sha256").update(sources.map(recoverySourceId).sort().join("\0")).digest("hex")

function validateJournal(value: unknown, keyVersion: number): asserts value is OfflineRecoveryJournal {
  const fail = (): never => { throw new Error("Offline recovery journal is malformed; encrypted records were retained") }
  const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value))
  const identity = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value)
  const binary = (value: unknown): value is string => typeof value === "string" && value.length <= 32 * 1024 * 1024 && value.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(value) && Buffer.from(value, "base64").toString("base64") === value
  if (!object(value) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 1000) throw fail()
  const entries = (value as { entries: unknown[] }).entries
  const entryIds = new Set<string>()
  for (const entry of entries) {
    if (!object(entry) || !identity(entry.id) || entryIds.has(entry.id) || typeof entry.incomplete !== "boolean" || entry.projection !== undefined && !binary(entry.projection) || !binary(entry.branch) ||
      !Array.isArray(entry.sources) || !entry.sources.length && entry.kind !== "external" || entry.kind !== undefined && entry.kind !== "external" || entry.reason !== undefined && (typeof entry.reason !== "string" || entry.reason.length > 1024) || entry.sources.length > 100_000 || !Array.isArray(entry.files) || entry.files.length > 10_000 || !Array.isArray(entry.resolved) || !object(entry.saves)) throw fail()
    entryIds.add(entry.id as string)
    try { Y.decodeUpdate(Buffer.from(entry.branch as string, "base64")) } catch { fail() }
    const sources = new Set<string>()
    for (const source of entry.sources as unknown[]) {
      if (!object(source) || !identity(source.id) || !Number.isSafeInteger(source.keyVersion) || (source.keyVersion as number) < 1 || (source.keyVersion as number) > keyVersion || source.kind !== undefined && source.kind !== "ingress") throw fail()
      const id = recoverySourceId(source as unknown as RecoverySource)
      if (sources.has(id)) throw fail(); sources.add(id)
    }
    const ids = new Set<string>()
    for (const file of entry.files as unknown[]) {
      if (!object(file) || !identity(file.id) || ids.has(file.id) || typeof file.path !== "string" || file.originalPath !== null && typeof file.originalPath !== "string" || typeof file.content !== "string" || Buffer.byteLength(file.content) > 2 * 1024 * 1024 || typeof file.deleted !== "boolean" || typeof file.executable !== "boolean") throw fail()
      try { assertSharedFilePath(file.path as string); if (file.originalPath) assertSharedFilePath(file.originalPath as string) } catch { fail() }
      ids.add(file.id as string)
    }
    if ((entry.resolved as unknown[]).some(id => typeof id !== "string" || !ids.has(id)) || new Set(entry.resolved as unknown[]).size !== (entry.resolved as unknown[]).length) throw fail()
    for (const [id, saved] of Object.entries(entry.saves as Record<string, unknown>)) {
      if (!ids.has(id) || !object(saved) || !identity(saved.fileId) || !identity(saved.recordId) || typeof saved.path !== "string" || !Number.isSafeInteger(saved.keyVersion) || (saved.keyVersion as number) < 1 || (saved.keyVersion as number) > keyVersion || !binary(saved.update) || !binary(saved.updateBinary)) throw fail()
      try { assertSharedFilePath(saved.path as string); Y.decodeUpdate(Buffer.from(saved.update as string, "base64")); bytesToEnvelope(Buffer.from(saved.updateBinary as string, "base64")) } catch { fail() }
    }
  }
}

export async function readOfflineRecovery(store: DurableSessionStore, cipher: RecoveryCipher, sessionId: string): Promise<OfflineRecoveryJournal> {
  const encoded = await store.readRecoveryJournal()
  if (!encoded) return { version: 1, entries: [] }
  const envelope = bytesToEnvelope(Buffer.from(encoded, "base64"))
  const metadata = JSON.parse(Buffer.from(envelope.aad, "base64").toString())
  if (envelope.keyVersion !== cipher.keyVersion || metadata.purpose !== "offline-recovery" || metadata.sessionId !== sessionId) throw new Error("Offline recovery identity differs; encrypted records were retained")
  const bytes = await decryptPayload({ envelope, roomKeyBase64: cipher.roomKeyBase64, expectedKind: "yjs_snapshot" })
  if (bytes.length > 32 * 1024 * 1024) throw new Error("Offline recovery journal exceeds its limit")
  const journal: unknown = JSON.parse(Buffer.from(bytes).toString())
  validateJournal(journal, cipher.keyVersion)
  return journal
}
export async function saveOfflineRecovery(store: DurableSessionStore, cipher: RecoveryCipher, sessionId: string, journal: OfflineRecoveryJournal): Promise<void> {
  validateJournal(journal, cipher.keyVersion)
  const envelope = await encryptPayload({ ...cipher, kind: "yjs_snapshot", plaintext: Buffer.from(JSON.stringify(journal)), metadata: { purpose: "offline-recovery", sessionId } })
  await store.saveRecoveryJournal(Buffer.from(envelopeToBytes(envelope)).toString("base64"))
}

import fs from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { ProjectdRecoveryExportResult } from "@cozea/projectd-protocol"
import type { ProjectdDatabase } from "../storage/Database"
import type { BackgroundSessionIntent } from "./BackgroundSessionStore"
import { PendingBinaryStore, type PendingBinaryRecord } from "./PendingBinaryStore"
import { LocalReplicaStore } from "./LocalReplicaStore"
import type { BinaryRevision } from "./BinaryStore"
import type { QueuedBatch } from "./OutboundBatchQueue"
import { OutboundBatchQueue } from "./OutboundBatchQueue"
import { SessionReplica } from "./SessionReplica"
import { BinaryContentCache } from "./BinaryContentCache"
import { resolveWorkspaceFilePath } from "../filesystem/workspacePath"
import { InvalidProjectPathError } from "./projectPath"

function json(value: unknown): string {
  return JSON.stringify(value, (_, item) => item instanceof Uint8Array
    ? { __b64: Buffer.from(item).toString("base64") } : item, 2)
}

/** Exports retained state, not unsaved source-folder bytes. No cloud calls or source writes. */
export async function exportLocalRecovery(db: ProjectdDatabase, descriptor: BackgroundSessionIntent,
  destinationParent: string, cache = new BinaryContentCache({ db })): Promise<ProjectdRecoveryExportResult> {
  if (!descriptor.roomKeyBase64) throw new Error("The local recovery key is unavailable")
  const keys = { sessionId: descriptor.publicSessionId, roomKey: Buffer.from(descriptor.roomKeyBase64, "base64"),
    roomKeyVersion: descriptor.roomKeyVersion,
    previousRoomKeys: Object.fromEntries(Object.entries(descriptor.previousRoomKeysBase64 ?? {})
      .map(([version, key]) => [version, Buffer.from(key, "base64")])) }
  // Reads are synchronous, so snapshot and pending journal are captured together
  // on the daemon's event loop before any asynchronous binary reads begin.
  const snapshot = new LocalReplicaStore(db, keys).load()
  const pending = new OutboundBatchQueue(db, keys).getPendingBatches(descriptor.publicSessionId, false)
  const stagedStore = new PendingBinaryStore(db, keys)
  const captured = stagedStore.captureForExport()
  try {
    const staged = captured.records.map((record) => ({ record, writeTo: (write: (chunk: Buffer) => Promise<void>) => captured.writeTo(record, write) }))
    if (!snapshot && pending.length === 0 && staged.length === 0) throw new Error("No local snapshot or pending changes are retained")
    const replica = new SessionReplica(descriptor.publicSessionId, `export_${randomUUID()}`)
    if (snapshot) replica.restoreSnapshot(snapshot.replica)
    for (const queued of pending) replica.applyBatch(queued.batch)
    return await exportRecoveryReplica({ replica, pending, staged, snapshotSequence: snapshot?.sequence ?? null,
      source: "local", sourceRoot: descriptor.rootPath, destinationParent,
      writeBinary: (revision, write) => cache.copyTo(revision.contentHash, revision.size, write) })
  } finally { captured.close() }
}

export interface RecoveryReplicaExportOptions {
  replica: SessionReplica
  pending: QueuedBatch[]
  snapshotSequence: number | null
  staged?: Array<{ record: PendingBinaryRecord; writeTo: (write: (chunk: Buffer) => Promise<void>) => Promise<void> }>
  source: "local" | "cloud"
  sourceRoot?: string
  destinationParent: string
  /** False means unavailable/corrupt local content; provisional output is discarded. */
  writeBinary: (revision: BinaryRevision, write: (chunk: Buffer) => Promise<void>) => Promise<boolean>
}

/** Shared writer for isolated local and cloud recovery; never opens a source file. */
export async function exportRecoveryReplica(options: RecoveryReplicaExportOptions): Promise<ProjectdRecoveryExportResult> {
  const { replica, pending, snapshotSequence, destinationParent, writeBinary } = options
  const parent = await fs.realpath(destinationParent)
  if (options.sourceRoot) {
    const source = await fs.realpath(options.sourceRoot).catch(() => path.resolve(options.sourceRoot!))
    const relative = path.relative(source, parent)
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error("Choose an export location outside the session workspace")
    }
  }
  const staged = options.staged ?? []
  const stagedPaths = new Set(staged.map(({ record }) => record.path))
  const sessionId = replica.sessionId
  const format = `cozea-${options.source}-recovery`
  const note = options.source === "local"
    ? "Retained snapshot, pending changes and staged binary versions only. Newer workspace edits are not included. Symlinks are metadata only in retained-state.json."
    : "Retained cloud snapshot only. Unsent local changes and newer workspace edits are not included. Symlinks are metadata only in retained-state.json."
  const directory = await fs.mkdtemp(path.join(parent, "cozea-recovery-"))
  await fs.chmod(directory, 0o700)
  let files = 0
  const missing: Array<{ fileId: string; revisionId: string; contentHash: string }> = []
  const exported: Array<{ fileId: string; originalPath: string; deleted: boolean; contentFiles: string[] }> = []
  const conflicts = replica.detectConflicts()
  const collisions = new Set(conflicts.pathCollisions.flatMap((conflict) => conflict.fileIds))
  const projectOmissions: Array<{ fileId: string; reason: string }> = []
  try {
    await fs.mkdir(path.join(directory, "project"), { mode: 0o700 })
    await fs.writeFile(path.join(directory, "retained-state.json"), json({ format, version: 1,
      publicSessionId: sessionId, snapshotSequence,
      replica: replica.captureSnapshot(), pending: pending.map((entry) => ({ localOrder: entry.localOrder, batch: entry.batch })),
      pendingBinaryVersions: staged.map(({ record }) => record) }),
    { mode: 0o600, flag: "wx" })
    for (const entry of replica.tree.listAllEntries()) {
      // Export paths are derived only from hashes, never from a collaborative
      // path or symlink target. Collisions/deleted variants remain distinct.
      const folder = `files/${createHash("sha256").update(entry.fileId).digest("hex")}`
      await fs.mkdir(path.join(directory, folder), { recursive: true, mode: 0o700 })
      const contentFiles: string[] = []
      let projectContent: string | null = null
      if (entry.kind === "text") {
        const content = `${folder}/content.txt`
        projectContent = path.join(directory, content)
        await fs.writeFile(projectContent, replica.textDocs.getTextContent(entry.fileId), { mode: 0o600, flag: "wx" })
        contentFiles.push(content)
        files++
      }
      for (const revision of replica.binaryStore.getRevisions(entry.fileId)) {
        const content = `${folder}/${createHash("sha256").update(revision.revisionId).digest("hex")}.bin`
        const contentPath = path.join(directory, content)
        const handle = await fs.open(contentPath, "wx", 0o600)
        let valid = false
        try {
          let size = 0
          const hash = createHash("sha256")
          const available = /^[a-f0-9]{64}$/.test(revision.contentHash) && await writeBinary(revision, async (chunk) => {
            if (size + chunk.length > revision.size) throw new Error("Recovery binary exceeds its revision size")
            let offset = 0
            while (offset < chunk.length) {
              const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, size)
              if (!bytesWritten) throw new Error("Recovery write made no progress")
              offset += bytesWritten
              size += bytesWritten
            }
            hash.update(chunk)
          })
          valid = available && size === revision.size && hash.digest("hex") === revision.contentHash
          if (valid) await handle.sync()
        } finally { await handle.close() }
        if (!valid) {
          await fs.unlink(contentPath)
          missing.push({ fileId: entry.fileId, revisionId: revision.revisionId, contentHash: revision.contentHash })
          continue
        }
        contentFiles.push(content)
        files++
        if (replica.binaryStore.getHeadRevision(entry.fileId)?.revisionId === revision.revisionId &&
          !replica.binaryStore.detectConcurrentRevisions(entry.fileId)) projectContent = contentPath
      }
      if (!entry.deleted) {
        if (!projectContent || collisions.has(entry.fileId) || stagedPaths.has(entry.path)) {
          projectOmissions.push({ fileId: entry.fileId, reason: stagedPaths.has(entry.path) ? "pending_binary_versions" : "conflicted_missing_or_symlink" })
        } else {
          try {
            const target = await resolveWorkspaceFilePath(path.join(directory, "project"), entry.path)
            await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
            await fs.copyFile(projectContent, target, constants.COPYFILE_EXCL)
            await fs.chmod(target, entry.mode & 0o111 ? 0o700 : 0o600)
          } catch (error) {
            if (!(error instanceof InvalidProjectPathError) && !["EEXIST", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error
            projectOmissions.push({ fileId: entry.fileId, reason: "invalid_path_or_path_conflict" })
          }
        }
      }
      exported.push({ fileId: entry.fileId, originalPath: entry.path, deleted: entry.deleted, contentFiles })
    }
    const stagedExports: Array<PendingBinaryRecord & { contentFile: string }> = []
    if (staged.length > 0) await fs.mkdir(path.join(directory, "pending-binaries"), { mode: 0o700 })
    for (const { record, writeTo } of staged) {
      const contentFile = `pending-binaries/${createHash("sha256").update(record.revisionId).digest("hex")}.bin`
      const handle = await fs.open(path.join(directory, contentFile), "wx", 0o600)
      try {
        await writeTo(async (chunk) => { await handle.writeFile(chunk) })
        await handle.sync()
      } finally { await handle.close() }
      stagedExports.push({ ...record, contentFile })
      files++
    }
    await fs.writeFile(path.join(directory, "manifest.json"), json({ format, version: 1,
      publicSessionId: sessionId, createdAt: Date.now(), files: exported,
      conflicts, missingBinaryContents: missing, projectOmissions, pendingBinaryVersions: stagedExports,
      note }),
    { mode: 0o600, flag: "wx" })
    await fs.writeFile(path.join(directory, "README.txt"),
      "Session recovery export\n\nproject/ contains unambiguous recovered files at their original paths.\n" +
      "files/ preserves text and binary variants separately. manifest.json maps them to their original paths and lists conflicts and unavailable content.\n" +
      "pending-binaries/ contains captured versions awaiting upload; their paths and original revision bases are in manifest.json. These paths are omitted from project/ until reconciled.\n" +
      "retained-state.json preserves CRDT state and pending changes. No device keys or credentials are included.\n\n" +
      `${note}\n`,
      { mode: 0o600, flag: "wx" })
    return { directory, files, pendingBinaryVersions: staged.length, pendingBatches: pending.length, missingBinaryContents: missing.length,
      pendingOnly: snapshotSequence === null, projectOmissions: projectOmissions.length }
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true })
    throw error
  }
}

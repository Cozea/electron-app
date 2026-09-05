import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import * as Y from "yjs"
import { SessionFileDocument, type SharedSessionFile } from "../../../../shared/SessionFileDocument"
import { assertSharedFilePath } from "../../../../shared/collaborationPaths"
import { bytesToEnvelope, decryptPayload, encryptPayload, envelopeToBytes } from "../../../../shared/collaborationCipher"
import type { DurableSessionStore } from "./DurableSessionStore"

interface DiskText { content: string; executable: boolean }
interface ProjectedFile { file: SharedSessionFile; update: string }
interface ProjectionIntent { id: string; before: ProjectedFile | null; after: ProjectedFile; backup: string | null }
interface ProjectionRecord { generation: 3; sessionId: string; files: Record<string, ProjectedFile>; intent: ProjectionIntent | null }
interface ProjectionOptions {
  sessionId: string
  root: string
  recoveryRoot: string
  files: SessionFileDocument
  role: "editor" | "observer"
  roomKeyBase64: string
  keyVersion: number
  store: Pick<DurableSessionStore, "readProjection" | "saveProjection">
  readBase(path: string): Promise<DiskText | null>
  persistEdits(): Promise<void>
}

/**
 * Projects canonical text without replacing an unknown local file. The encrypted
 * intent precedes each disk mutation. Displaced inodes remain recoverable, even
 * if an external process still holds an open descriptor and writes after rename.
 */
export class SessionFileProjection {
  private readonly options: ProjectionOptions
  private record: ProjectionRecord | null = null
  private tail: Promise<void> = Promise.resolve()
  constructor(options: ProjectionOptions) { this.options = options }

  reconcile(): Promise<void> {
    const next = this.tail.catch(() => {}).then(() => this.run())
    this.tail = next
    return next
  }
  async flush(): Promise<void> { await this.tail }

  readExternalText(relative: string): Promise<DiskText | null> { return this.read(relative) }

  trackCanonicalFile(id: string): Promise<void> {
    const file = this.options.files.file(id)
    if (!file) throw new Error("Canonical file is unavailable")
    const entry = { file, update: Buffer.from(this.options.files.checkpoint()).toString("base64") }
    const operation = this.tail.catch(() => {}).then(async () => {
      const record = await this.load()
      if (!record.files[id]) { record.files[id] = entry; await this.save() }
    })
    this.tail = operation
    return operation
  }

  private async load(): Promise<ProjectionRecord> {
    if (this.record) return this.record
    const ciphertext = await this.options.store.readProjection()
    if (!ciphertext) return this.record = { generation: 3, sessionId: this.options.sessionId, files: {}, intent: null }
    try {
      const envelope = bytesToEnvelope(Buffer.from(ciphertext, "base64"))
      const aad = JSON.parse(Buffer.from(envelope.aad, "base64").toString())
      if (envelope.keyVersion !== this.options.keyVersion || aad.purpose !== "local-projection" || aad.sessionId !== this.options.sessionId) throw new Error("Wrong projection identity")
      const plain = await decryptPayload({ envelope, roomKeyBase64: this.options.roomKeyBase64, expectedKind: "yjs_snapshot" })
      const value = JSON.parse(Buffer.from(plain).toString()) as ProjectionRecord
      if (value.generation !== 3 || value.sessionId !== this.options.sessionId || !value.files || Object.keys(value.files).length > 10_000) throw new Error("Invalid projection record")
      for (const [id, entry] of Object.entries(value.files)) {
        if (entry.file.id !== id || typeof entry.update !== "string") throw new Error("Invalid projected file")
        assertSharedFilePath(entry.file.path)
      }
      return this.record = value
    } catch { throw new Error("Encrypted file projection cannot be recovered; local files and recovery records were retained") }
  }

  private async save(): Promise<void> {
    const envelope = await encryptPayload({ roomKeyBase64: this.options.roomKeyBase64, keyVersion: this.options.keyVersion,
      kind: "yjs_snapshot", metadata: { purpose: "local-projection", sessionId: this.options.sessionId },
      plaintext: Buffer.from(JSON.stringify(this.record)),
    })
    await this.options.store.saveProjection(Buffer.from(envelopeToBytes(envelope)).toString("base64"))
  }

  private async filename(relative: string, createParents = false): Promise<string> {
    const parts = assertSharedFilePath(relative).split("/")
    let current = this.options.root
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part)
      if (createParents) await fs.mkdir(current).catch(error => { if (error.code !== "EEXIST") throw error })
      const stat = await fs.lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error })
      if (!stat) return path.join(this.options.root, relative)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("A shared path crosses a symlink or non-directory; projection paused")
    }
    return path.join(current, parts.at(-1)!)
  }

  private async read(relative: string): Promise<DiskText | null> {
    const filename = await this.filename(relative)
    const stat = await fs.lstat(filename).catch(error => { if (error.code === "ENOENT") return null; throw error })
    if (!stat) return null
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error("Shared text was replaced by a Git-only file; local bytes were retained")
    const bytes = await fs.readFile(filename)
    if (bytes.includes(0)) throw new Error("Shared text was replaced by binary data; local bytes were retained")
    return { content: new TextDecoder("utf-8", { fatal: true }).decode(bytes), executable: Boolean(stat.mode & 0o111) }
  }

  private same(a: DiskText | null, b: DiskText | null): boolean {
    return a === null || b === null ? a === b : a.content === b.content && a.executable === b.executable
  }

  private async run(): Promise<void> {
    if (this.options.role === "editor") await this.options.persistEdits()
    const record = await this.load()
    if (record.intent) await this.finishIntent(record.intent)
    if (this.options.files.pathConflicts().length) throw new Error("Resolve shared path collisions before projecting files")
    for (const file of this.options.files.files()) {
      let before = record.files[file.id] ?? null
      const sourcePath = before?.file.path ?? file.originalPath ?? file.path
      const expected = before ? before.file.deleted ? null : before.file : file.originalPath ? await this.options.readBase(file.originalPath) : null
      const actual = await this.read(sourcePath)
      if (!this.same(actual, expected)) {
        if (!before) throw new Error("Unreviewed local changes occupy a shared path; local bytes were retained")
        if (this.options.role !== "editor") throw new Error("Observer workspace has local changes; retained for recovery")
        if (before.file.deleted) throw new Error("A local file conflicts with a shared deletion; restore it explicitly")
        // Build the external branch once; the same CRDT identities are used
        // for live reconciliation and the next projected baseline.
        const basis = new SessionFileDocument(this.options.sessionId)
        try {
          Y.applyUpdate(basis.doc, Buffer.from(before.update, "base64"))
          const vector = Y.encodeStateVector(basis.doc)
          if (actual) { basis.replaceText(file.id, actual.content); basis.setExecutable(file.id, actual.executable) }
          else basis.deleteFile(file.id)
          Y.applyUpdate(this.options.files.doc, Y.encodeStateAsUpdate(basis.doc, vector), "external-write")
          await this.options.persistEdits()
          before = { file: basis.file(file.id)!, update: Buffer.from(basis.checkpoint()).toString("base64") }
        } finally { basis.destroy() }
      }
      const current = this.options.files.file(file.id)!
      const after = { file: current, update: Buffer.from(this.options.files.checkpoint()).toString("base64") }
      if (before && JSON.stringify(before.file) === JSON.stringify(current)) { record.files[file.id] = after; continue }
      // An intent is durable before any inode is displaced. For a first
      // projection the Git base is its expected pre-image.
      const baseline = before ?? (expected ? { file: { ...current, ...expected, path: sourcePath, deleted: false }, update: after.update } : null)
      record.intent = { id: randomUUID(), before: baseline, after, backup: null }
      await this.save()
      await this.finishIntent(record.intent)
    }
    await this.save()
  }

  private async finishIntent(intent: ProjectionIntent): Promise<void> {
    const record = this.record!
    await this.save()
    const before = intent.before?.file
    const after = intent.after.file
    const oldPath = before && !before.deleted ? before.path : null
    const newPath = after.deleted ? null : after.path
    const expected = before && !before.deleted ? before : null
    if (oldPath && !intent.backup) {
      const actual = await this.read(oldPath)
      // A completed write followed by a crash before saving its receipt.
      if (oldPath === newPath && this.same(actual, after)) {
        record.files[after.id] = intent.after; record.intent = null; await this.save(); return
      }
      if (!this.same(actual, expected)) throw new Error("Local file changed during projection; recovery intent retained")
      await fs.mkdir(this.options.recoveryRoot, { recursive: true, mode: 0o700 })
      const entries = await fs.readdir(this.options.recoveryRoot)
      let bytes = 0
      for (const name of entries) bytes += (await fs.lstat(path.join(this.options.recoveryRoot, name))).size
      if (bytes > 96 * 1024 * 1024) throw new Error("Projection recovery storage is full; synchronization paused")
      intent.backup = `${intent.id}.retained`
      await this.save()
    }
    if (intent.backup && oldPath) {
      if (!/^[a-f0-9-]+\.retained$/.test(intent.backup)) throw new Error("Invalid projection recovery path")
      const backup = path.join(this.options.recoveryRoot, intent.backup)
      const present = await fs.lstat(backup).catch(error => { if (error.code === "ENOENT") return null; throw error })
      if (!present) {
        if (!this.same(await this.read(oldPath), expected)) throw new Error("Local file changed before projection; recovery intent retained")
        await fs.rename(await this.filename(oldPath), backup)
        const moved = await fs.readFile(backup)
        const movedStat = await fs.lstat(backup)
        if (!expected || !moved.equals(Buffer.from(expected.content)) || Boolean(movedStat.mode & 0o111) !== expected.executable) throw new Error("External write raced projection; displaced bytes were retained")
        const directory = await fs.open(this.options.recoveryRoot, "r")
        try { await directory.sync() } finally { await directory.close() }
      }
    }
    if (newPath) {
      const actual = await this.read(newPath)
      if (!this.same(actual, after)) {
        if (actual) throw new Error("Projection target contains local work; both versions were retained")
        const filename = await this.filename(newPath, true)
        const staging = path.join(this.options.recoveryRoot, `${randomUUID()}.staging`)
        await fs.mkdir(this.options.recoveryRoot, { recursive: true, mode: 0o700 })
        const handle = await fs.open(staging, "wx", after.executable ? 0o755 : 0o644)
        try { await handle.writeFile(after.content, "utf8"); await handle.sync() } finally { await handle.close() }
        // Hard-link is an atomic create-if-absent; it cannot replace a racing
        // external write and readers never observe a half-written projection.
        await fs.link(staging, filename)
        await fs.unlink(staging)
        const directory = await fs.open(path.dirname(filename), "r")
        try { await directory.sync() } finally { await directory.close() }
      }
    }
    record.files[after.id] = intent.after; record.intent = null; await this.save()
  }
}

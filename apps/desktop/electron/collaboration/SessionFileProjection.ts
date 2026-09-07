import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import * as Y from "yjs"
import { SessionFileDocument, type SharedSessionFile } from "../../../../shared/SessionFileDocument"
import { assertSharedFilePath, sharedPathComparisonKey } from "../../../../shared/collaborationPaths"
import { bytesToEnvelope, decryptPayload, encryptPayload, envelopeToBytes } from "../../../../shared/collaborationCipher"
import type { DurableSessionStore } from "./DurableSessionStore"

interface DiskText { content: string; executable: boolean }
interface FileIdentity { dev: string; ino: string }
interface ProjectedFile { file: SharedSessionFile; update: string; recovery?: boolean; identity?: FileIdentity | null; externalRename?: { from: string; to: string } }
interface ExternalIntent { id: string; update: string; next: ProjectedFile; beforePath: string; beforeContent: string; projectionNext?: ProjectedFile }
interface ProjectionIntent { id: string; before: ProjectedFile | null; after: ProjectedFile; backup: string | null }
interface ProjectionRecord { generation: 3; sessionId: string; files: Record<string, ProjectedFile>; intent: ProjectionIntent | null; external?: ExternalIntent | null }
interface ProjectionOptions {
  sessionId: string
  root: string
  recoveryRoot: string
  files: SessionFileDocument
  role: "editor" | "observer"
  roomKeyBase64: string
  keyVersion: number
  store: Pick<DurableSessionStore, "readProjection" | "saveProjection"> & Partial<Pick<DurableSessionStore, "reserveProjectionWrite">>
  readBase(path: string): Promise<DiskText | null>
  persistEdits(): Promise<void>
  markGitOnly?(path: string): void
  retainRecovered?(file: SharedSessionFile | null, projection: string | null): Promise<void>
  applyExternal?(id: string, update: Uint8Array, beforePath: string, file: SharedSessionFile, beforeContent: string): Promise<boolean>
  retainConflict?(file: SharedSessionFile, update: string, reason: string): Promise<void>
}

/**
 * Projects canonical text without replacing an unknown local file. The encrypted
 * intent precedes each disk mutation. Displaced inodes remain recoverable, even
 * if an external process still holds an open descriptor and writes after rename.
 */
export class SessionFileProjection {
  private readonly options: ProjectionOptions
  private record: ProjectionRecord | null = null
  private recoveryRetain: ((file: SharedSessionFile | null, projection: string | null) => Promise<void>) | null = null
  private readonly retainedUnsupported = new Set<string>()
  private tail: Promise<void> = Promise.resolve()
  constructor(options: ProjectionOptions) { this.options = options; this.recoveryRetain = options.retainRecovered ?? null }

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
      if (!record.files[id]) { record.files[id] = { ...entry, identity: await this.identity(file.path) }; await this.save() }
    })
    this.tail = operation
    return operation
  }

  /** A quarantined history must never supply anchors for an external-write delta.
   * Retain both its encrypted intent and any divergent text before replacing the
   * baseline; normal write-ahead projection then preserves displaced inodes.
   */
  async prepareRecoveredFiles(ids: ReadonlySet<string>, retain: (file: SharedSessionFile | null, projection: string | null) => Promise<void>, unsupported: (path: string) => void, recoveredFiles: readonly SharedSessionFile[] = []): Promise<void> {
    this.recoveryRetain = retain
    const record = await this.load()
    const original = await this.options.store.readProjection()
    await retain(null, original)
    const intent = record.intent
    if (intent) {
      // A crash may have displaced an inode whose bytes differ from the
      // expected preimage. Surface those bytes before retiring the live intent.
      if (intent.backup && intent.before) {
        if (!/^[a-f0-9-]+\.retained$/.test(intent.backup)) throw new Error("Invalid projection recovery path")
        const filename = path.join(this.options.recoveryRoot, intent.backup)
        let actual: DiskText | null = null
        try {
          const directory = await fs.lstat(this.options.recoveryRoot)
          if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Unsafe recovery directory")
          actual = await this.readDisk(filename)
        } catch { unsupported(intent.before.file.path) }
        if (actual) await retain({ ...intent.before.file, ...actual, deleted: false }, original)
      }
      const target = intent.after.file
      if (!target.deleted) {
        let actual: DiskText | null = null
        try { actual = await this.read(target.path) } catch { this.retainedUnsupported.add(target.id); unsupported(target.path) }
        if (actual) await retain({ ...target, ...actual, deleted: false }, original)
      }
    }
    for (const file of recoveredFiles) {
      // Offline-created/renamed paths may have no canonical counterpart. Their
      // disk bytes still belong to recovery and cannot become ordinary imports.
      for (const relative of new Set([file.path, ...(file.originalPath ? [file.originalPath] : [])])) {
        let actual: DiskText | null = null
        try { actual = await this.read(relative) } catch { unsupported(relative); continue }
        const canonical = this.options.files.file(file.id)
        if (actual && !(canonical && !canonical.deleted && canonical.path === relative && actual.content === canonical.content && actual.executable === canonical.executable)) await retain({ ...file, path: relative, ...actual, deleted: false }, original)
      }
    }
    for (const id of ids) {
      const canonical = this.options.files.file(id)
      if (!canonical) continue
      const sourcePath = record.files[id]?.file.path ?? canonical.originalPath ?? canonical.path
      let actual: DiskText | null
      try { actual = await this.read(sourcePath) } catch { this.retainedUnsupported.add(id); unsupported(sourcePath); continue }
      if (actual && (actual.content !== canonical.content || actual.executable !== canonical.executable)) await retain({ ...canonical, path: sourcePath, ...actual, deleted: false }, original)
      // Re-read the canonical snapshot after awaiting durable retention: remote
      // edits may have advanced it while the filesystem operation was pending.
      const current = this.options.files.file(id)!
      record.files[id] = { recovery: true, file: { ...current, path: sourcePath, content: actual?.content ?? "", executable: actual?.executable ?? false, deleted: actual === null }, update: Buffer.from(this.options.files.checkpoint()).toString("base64") }
    }
    record.intent = null
    await this.save()
  }

  async retainQuarantinedPath(relative: string, file: SharedSessionFile): Promise<void> {
    if (!this.recoveryRetain) throw new Error("Recovered path changed; reopen the session to retain its bytes")
    const actual = await this.read(relative)
    await this.recoveryRetain({ ...file, path: relative, content: actual?.content ?? "", executable: actual?.executable ?? file.executable, deleted: actual === null }, await this.options.store.readProjection())
  }

  private async identity(relative: string): Promise<FileIdentity | null> {
    const filename = await this.filename(relative)
    const stat = await fs.lstat(filename, { bigint: true }).catch(error => { if (error.code === "ENOENT") return null; throw error })
    if (!stat) return null
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("External path is not a regular file")
    return { dev: String(stat.dev), ino: String(stat.ino) }
  }

  /** Correlate the whole workspace before any deletion or new-file import. */
  scanExternal(changes: import("../../../../shared/collaborationRuntime").ExternalWorkspaceChanges, excluded: ReadonlySet<string>): Promise<Set<string>> {
    const operation = this.tail.catch(() => {}).then(async () => {
      const record = await this.load(), consumed = new Set<string>()
      if (record.external) await this.finishExternal(record.external)
      if (record.intent) await this.finishIntent(record.intent)
      if (!this.options.applyExternal || !this.options.retainConflict || this.options.role !== "editor") return consumed
      const competingRenames = this.options.files.renameConflicts()
      for (const conflict of competingRenames) {
        const file = this.options.files.file(conflict.fileId)!
        for (const target of conflict.paths) await this.options.retainConflict({ ...file, path: target }, Buffer.from(this.options.files.checkpoint()).toString("base64"), "Concurrent rename targets require an explicit choice")
      }
      if (competingRenames.length) throw new Error("Choose a shared path for competing renames before projecting files")
      const matches = (a?: FileIdentity | null, b?: FileIdentity | null) => Boolean(a && b && a.dev === b.dev && a.ino === b.ino)
      const observations = new Map<string, { text: DiskText; identity: FileIdentity }>()
      const unsupported = new Set<string>()
      for (const relative of changes.paths) {
        if (excluded.has(sharedPathComparisonKey(relative)) && !Object.values(record.files).some(entry => !entry.recovery && !entry.file.deleted && sharedPathComparisonKey(entry.file.path) === sharedPathComparisonKey(relative))) continue
        try {
          const text = await this.read(relative), identity = await this.identity(relative)
          if (text && identity) observations.set(relative, { text, identity })
        } catch { unsupported.add(relative); this.options.markGitOnly?.(relative) }
      }
      for (const before of Object.values(record.files)) {
        const file = this.options.files.file(before.file.id)
        if (file && before.file.deleted && file.deleted && file.content !== before.file.content) {
          await this.options.retainConflict(file, Buffer.from(this.options.files.checkpoint()).toString("base64"), "Shared edits arrived after an external deletion")
          record.files[file.id] = { ...before, file }; await this.save()
        }
        if (record.files[before.file.id] !== before || !file || before.file.deleted || before.recovery) continue
        if (before.externalRename && file.path !== before.externalRename.to) {
          await this.options.retainConflict(before.file, before.update, "A shared rename conflicts with an external rename")
          record.files[file.id] = { ...before, externalRename: undefined, recovery: true }
          await this.save(); continue
        }
        const actual = await this.read(before.file.path)
        const currentIdentity = await this.identity(before.file.path)
        // A case-only rename can leave the old spelling addressable on macOS.
        const gitRename = changes.renames.find(rename => rename.from === before.file.path)
        const moved = [...observations].filter(([relative, value]) => relative !== before.file.path && matches(before.identity, value.identity))
        if (actual && matches(before.identity, currentIdentity) && !gitRename && !moved.some(([relative]) => sharedPathComparisonKey(relative) === sharedPathComparisonKey(before.file.path))) continue
        if (actual && !gitRename && !moved.length) continue // Atomic editor replacement is an edit, not a rename.
        const candidates = moved.length ? moved : [...observations].filter(([relative, value]) => changes.renames.some(rename => rename.from === before.file.path && rename.to === relative && rename.score === 100) && value.text.content === before.file.content && value.text.executable === before.file.executable)
        const unique = candidates.length === 1 && (moved.length > 0 || [...observations.values()].filter(value => value.text.content === before.file.content && value.text.executable === before.file.executable).length === 1) && !consumed.has(candidates[0]![0]) && !Object.values(record.files).some(other => other.file.id !== file.id && matches(other.identity, candidates[0]![1].identity))
        const candidate = unique ? candidates[0] : undefined
        const target = candidate?.[0]
        const collision = target && this.options.files.files().some(other => !other.deleted && other.id !== file.id && sharedPathComparisonKey(other.path) === sharedPathComparisonKey(target))
        const concurrentRename = target && file.path !== before.file.path && file.path !== target
        const changedRemotely = file.content !== before.file.content || file.deleted || file.path !== before.file.path
        const unpairedTargets = [...observations].filter(([relative]) => relative !== before.file.path && !consumed.has(relative) && !this.options.files.resolvePath(relative))
        if (!candidate && !actual && !changedRemotely && !unpairedTargets.length && !unsupported.size) continue // Unambiguous deletion is handled by the normal text projection.
        if (!candidate || collision || concurrentRename || file.deleted) {
          if (actual && !candidate && !gitRename) continue
          const variants = candidate ? [candidate] : unpairedTargets
          for (const [relative, value] of variants) {
            await this.options.retainConflict({ ...before.file, path: relative, ...value.text, deleted: false }, before.update, "External rename conflicts with current shared files")
            consumed.add(relative)
          }
          if (!variants.length) await this.options.retainConflict({ ...before.file, deleted: !actual }, before.update, unsupported.size ? `External operation includes Git-only paths: ${[...unsupported].join(", ")}` : "External deletion conflicts with newer shared edits")
          // Retention precedes rebasing. Canonical text can now be materialized
          // without interpreting an offline whole-file replacement as an edit.
          if (collision && candidate) {
            const owner = this.options.files.files().find(other => !other.deleted && other.id !== file.id && sharedPathComparisonKey(other.path) === sharedPathComparisonKey(candidate[0]))!
            record.files[owner.id] = { file: { ...owner, ...candidate[1].text }, update: Buffer.from(this.options.files.checkpoint()).toString("base64"), recovery: true, identity: candidate[1].identity }
          }
          record.files[file.id] = { file: { ...file, path: before.file.path, content: actual?.content ?? "", executable: actual?.executable ?? file.executable, deleted: !actual }, update: Buffer.from(this.options.files.checkpoint()).toString("base64"), recovery: true, identity: currentIdentity }
          await this.save(); continue
        }
        const [relative, value] = candidate
        // Revalidate both identity and bytes after all awaited observations.
        if (!matches(value.identity, await this.identity(relative)) || !this.same(value.text, await this.read(relative))) throw new Error("External rename changed during reconciliation; retry with local bytes retained")
        const basis = new SessionFileDocument(this.options.sessionId)
        try {
          Y.applyUpdate(basis.doc, Buffer.from(before.update, "base64"))
          const vector = Y.encodeStateVector(basis.doc)
          basis.renameFile(file.id, relative); basis.replaceText(file.id, value.text.content); basis.setExecutable(file.id, value.text.executable)
          record.external = { id: randomUUID(), beforePath: before.file.path, beforeContent: before.file.content, update: Buffer.from(Y.encodeStateAsUpdate(basis.doc, vector)).toString("base64"), next: { file: basis.file(file.id)!, update: Buffer.from(basis.checkpoint()).toString("base64"), identity: value.identity, externalRename: { from: before.file.path, to: relative } } }
          await this.save()
          await this.finishExternal(record.external)
          consumed.add(relative); consumed.add(before.file.path)
        } finally { basis.destroy() }
      }
      return consumed
    })
    this.tail = operation.then(() => {}, () => {})
    return operation
  }

  renameFile(id: string, target: string): Promise<void> {
    const operation = this.tail.catch(() => {}).then(async () => {
      const record = await this.load()
      if (record.external) await this.finishExternal(record.external)
      const before = this.options.files.file(id)
      if (!before) throw new Error("Shared file is unavailable")
      const basis = new SessionFileDocument(this.options.sessionId)
      try {
        Y.applyUpdate(basis.doc, this.options.files.checkpoint())
        const vector = Y.encodeStateVector(basis.doc)
        basis.renameFile(id, target)
        let projectionNext = record.files[id] ?? { file: before, update: Buffer.from(this.options.files.checkpoint()).toString("base64"), identity: await this.identity(before.path) }
        const conflict = this.options.files.renameConflicts().find(conflict => conflict.fileId === id)
        if (conflict) {
          const candidates = [...new Set([target, projectionNext.file.path, ...conflict.paths])]
          let sourcePath = projectionNext.file.path, actual: DiskText | null = null
          for (const relative of candidates) {
            const disk = await this.read(relative)
            if (disk) {
              await this.options.retainConflict?.({ ...before, path: relative, ...disk, deleted: false }, projectionNext.update, "Local bytes retained before choosing a shared rename target")
              if (!actual) { sourcePath = relative; actual = disk }
            }
          }
          projectionNext = { file: { ...before, path: sourcePath, content: actual?.content ?? "", executable: actual?.executable ?? before.executable, deleted: !actual }, update: Buffer.from(this.options.files.checkpoint()).toString("base64"), recovery: true, identity: actual ? await this.identity(sourcePath) : null }
        }
        record.external = { id: randomUUID(), beforePath: before.path, beforeContent: before.content,
          update: Buffer.from(Y.encodeStateAsUpdate(basis.doc, vector)).toString("base64"),
          next: { file: basis.file(id)!, update: Buffer.from(basis.checkpoint()).toString("base64") },
          projectionNext: { ...projectionNext, externalRename: undefined },
        }
        await this.save(); await this.finishExternal(record.external)
      } finally { basis.destroy() }
    })
    this.tail = operation.then(() => {}, () => {})
    return operation
  }

  private async finishExternal(intent: ExternalIntent): Promise<void> {
    if (!this.options.applyExternal) throw new Error("External operation recovery requires an editor")
    const accepted = await this.options.applyExternal(intent.id, Buffer.from(intent.update, "base64"), intent.beforePath, intent.next.file, intent.beforeContent)
    this.record!.files[intent.next.file.id] = { ...(accepted ? intent.projectionNext ?? intent.next : intent.next), ...(accepted ? {} : { recovery: true, externalRename: undefined }) }
    this.record!.external = null
    await this.save()
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
      const validateProjected = (entry: ProjectedFile) => {
        const file = entry?.file
        if (!file || typeof file.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(file.id) || typeof file.content !== "string" || Buffer.byteLength(file.content) > 2 * 1024 * 1024 || file.content.includes("\0") || typeof file.deleted !== "boolean" || typeof file.executable !== "boolean" || typeof entry.update !== "string" || entry.update.length > 32 * 1024 * 1024) throw new Error("Invalid projected file")
        assertSharedFilePath(file.path)
        if (file.originalPath !== null) assertSharedFilePath(file.originalPath)
        if (entry.identity && (typeof entry.identity.dev !== "string" || typeof entry.identity.ino !== "string" || !/^\d{1,30}$/.test(entry.identity.dev) || !/^\d{1,30}$/.test(entry.identity.ino))) throw new Error("Invalid projected inode")
        if (entry.externalRename) { assertSharedFilePath(entry.externalRename.from); assertSharedFilePath(entry.externalRename.to) }
        if (entry.recovery !== undefined && typeof entry.recovery !== "boolean") throw new Error("Invalid recovery marker")
        Y.decodeUpdate(Buffer.from(entry.update, "base64"))
      }
      for (const [id, entry] of Object.entries(value.files)) { validateProjected(entry); if (entry.file.id !== id) throw new Error("Projected file identity differs") }
      if (value.external) {
        if (!/^[a-f0-9-]{36}$/.test(value.external.id) || typeof value.external.update !== "string" || value.external.update.length > 4 * 1024 * 1024) throw new Error("Invalid external operation intent")
        validateProjected(value.external.next)
        if (value.external.projectionNext) validateProjected(value.external.projectionNext)
        assertSharedFilePath(value.external.beforePath)
        if (typeof value.external.beforeContent !== "string" || Buffer.byteLength(value.external.beforeContent) > 2 * 1024 * 1024) throw new Error("Invalid external preimage")
        Y.decodeUpdate(Buffer.from(value.external.update, "base64"))
        const snapshot = new SessionFileDocument(this.options.sessionId)
        try {
          Y.applyUpdate(snapshot.doc, Buffer.from(value.external.next.update, "base64"))
          if (JSON.stringify(snapshot.file(value.external.next.file.id)) !== JSON.stringify(value.external.next.file)) throw new Error("External receipt differs from its Yjs history")
        } finally { snapshot.destroy() }
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
    return this.readDisk(await this.filename(relative))
  }

  private async readDisk(filename: string): Promise<DiskText | null> {
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
    if (this.options.files.renameConflicts().length) throw new Error("Choose a shared path for competing renames before projecting files")
    if (this.options.files.pathConflicts().length) throw new Error("Resolve shared path collisions before projecting files")
    for (const file of this.options.files.files()) {
      if (this.retainedUnsupported.has(file.id)) continue
      let before = record.files[file.id] ?? null
      const sourcePath = before?.file.path ?? file.originalPath ?? file.path
      const expected = before ? before.file.deleted ? null : before.file : file.originalPath ? await this.options.readBase(file.originalPath) : null
      const actual = await this.read(sourcePath)
      if (before?.recovery && !this.same(actual, expected)) {
        if (!this.recoveryRetain) throw new Error("Recovered projection changed; reopen the session to retain the newer local bytes")
        await this.recoveryRetain(actual ? { ...before.file, ...actual, deleted: false } : { ...before.file, deleted: true }, await this.options.store.readProjection())
        before = { ...before, file: { ...before.file, content: actual?.content ?? "", executable: actual?.executable ?? false, deleted: actual === null } }
        record.files[file.id] = before
        await this.save()
      } else if (!this.same(actual, expected)) {
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
          const update = Y.encodeStateAsUpdate(basis.doc, vector)
          const next = { file: basis.file(file.id)!, update: Buffer.from(basis.checkpoint()).toString("base64"), identity: actual ? await this.identity(sourcePath) : null }
          if (this.options.applyExternal) {
            record.external = { id: randomUUID(), update: Buffer.from(update).toString("base64"), beforePath: before.file.path, beforeContent: before.file.content, next }
            await this.save(); await this.finishExternal(record.external)
            before = record.files[file.id]!
          } else {
            Y.applyUpdate(this.options.files.doc, update, "external-write")
            await this.options.persistEdits(); before = next
          }
        } finally { basis.destroy() }
      }
      const current = this.options.files.file(file.id)!
      const after = { file: current, update: Buffer.from(this.options.files.checkpoint()).toString("base64"), identity: current.deleted ? null : await this.identity(current.path), externalRename: before?.externalRename }
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
        record.files[after.id] = { ...intent.after, identity: newPath ? await this.identity(newPath) : null }; record.intent = null; await this.save(); return
      }
      if (!this.same(actual, expected)) throw new Error("Local file changed during projection; recovery intent retained")
      await fs.mkdir(this.options.recoveryRoot, { recursive: true, mode: 0o700 })
      const entries = await fs.readdir(this.options.recoveryRoot)
      let bytes = 0
      for (const name of entries) bytes += (await fs.lstat(path.join(this.options.recoveryRoot, name))).size
      if (bytes + Buffer.byteLength(expected?.content ?? "") > 96 * 1024 * 1024) throw new Error("Projection recovery storage is full; synchronization paused")
      intent.backup = `${intent.id}.retained`
      await this.save()
    }
    if (intent.backup && oldPath) {
      if (!/^[a-f0-9-]+\.retained$/.test(intent.backup)) throw new Error("Invalid projection recovery path")
      const backup = path.join(this.options.recoveryRoot, intent.backup)
      const present = await fs.lstat(backup).catch(error => { if (error.code === "ENOENT") return null; throw error })
      if (!present) {
        if (!this.same(await this.read(oldPath), expected)) throw new Error("Local file changed before projection; recovery intent retained")
        const source = await this.filename(oldPath)
        const retain = () => fs.rename(source, backup)
        if (this.options.store.reserveProjectionWrite) await this.options.store.reserveProjectionWrite((await fs.lstat(source)).size, retain)
        else await retain()
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
        const materialize = async () => {
          const handle = await fs.open(staging, "wx", after.executable ? 0o755 : 0o644)
          try { await handle.writeFile(after.content, "utf8"); await handle.sync() } finally { await handle.close() }
          // Hard-link is an atomic create-if-absent; it cannot replace a racing
          // external write and readers never observe a half-written projection.
          await fs.link(staging, filename)
          await fs.unlink(staging)
        }
        if (this.options.store.reserveProjectionWrite) await this.options.store.reserveProjectionWrite(Buffer.byteLength(after.content), materialize)
        else await materialize()
        const directory = await fs.open(path.dirname(filename), "r")
        try { await directory.sync() } finally { await directory.close() }
      }
    }
    record.files[after.id] = { ...intent.after, identity: newPath ? await this.identity(newPath) : null }; record.intent = null; await this.save()
  }
}

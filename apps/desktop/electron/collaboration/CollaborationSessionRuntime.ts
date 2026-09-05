import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { createHash, randomUUID } from "node:crypto"
import { lstat } from "node:fs/promises"
import path from "node:path"
import { watch, type FSWatcher } from "node:fs"
import { CollabWsProvider, type CollabSessionDescriptor, type CollaborationConnectionState } from "../../../../shared/CollaborationTransport"
import type { SessionRuntimeSnapshot } from "../../../../shared/collaborationRuntime"
export type { SessionRuntimeSnapshot } from "../../../../shared/collaborationRuntime"
import { SessionFileDocument, type SharedSessionFile } from "../../../../shared/SessionFileDocument"
import { assertSharedFilePath, sharedPathComparisonKey } from "../../../../shared/collaborationPaths"
import type { FileInitializationLease } from "../../../../shared/collaborationFileInitialization"
import type { CollaborationTextChange } from "../../../../shared/collaborationDesktop"
import { readOfflineRecovery, saveOfflineRecovery, recoverySourceId, type OfflineRecoveryJournal } from "./SessionOfflineRecovery"
import { DurableSessionStore } from "./DurableSessionStore"
import { SessionCheckpointClient } from "./SessionCheckpointClient"
import { SessionFileProjection } from "./SessionFileProjection"
import { bytesToEnvelope, decryptPayload, encryptPayload, envelopeToBytes } from "../../../../shared/collaborationCipher"
import { validateEncryptedCollaborationEnvelope } from "../../../../shared/collaborationWire"

interface SessionRuntimeOptions {
  sessionId: string
  role: "editor" | "observer"
  session: CollabSessionDescriptor
  encryption: { roomKeyBase64: string; keyVersion: number }
  store: DurableSessionStore
  checkpoints: SessionCheckpointClient
  refreshSession: () => Promise<CollabSessionDescriptor | null>
  claimFile: (fileId: string) => Promise<{ lease?: FileInitializationLease; sequence?: number; waiting?: boolean }>
  readBaseFile: (filePath: string) => Promise<{ content: string; executable: boolean } | null>
  onPublication: (commitSha: string, sequence: number) => void
  onAuthorityFailure: (reason: string) => void
  onRecoveryRequired?: (code: string) => void
  projection?: { root: string; recoveryRoot: string }
  shouldTrackExternal?: (filePath: string) => Promise<boolean>
  changedPaths?: () => Promise<string[]>
  offline?: boolean
  beforeReplay?: (acknowledgedUpdate: Uint8Array, canonicalState: (sequence?: number) => Promise<Uint8Array>) => Promise<void>
}

/** One main-process runtime owns transport, CRDT state and encrypted recovery. */
export class CollaborationSessionRuntime {
  readonly files: SessionFileDocument
  private readonly options: SessionRuntimeOptions
  private readonly awareness: Awareness
  private recoveryMutation: Promise<void> = Promise.resolve()
  private recovered = false
  private provider: CollabWsProvider | null = null
  private recovery: OfflineRecoveryJournal = { version: 1, entries: [] }
  private connection: CollaborationConnectionState = "idle"
  private error: string | null = null
  private stopped = false
  private stopping = false
  private stopPromise: Promise<void> | null = null
  private readonly checkpointOperations = new Set<Promise<void>>()
  private editorQueue: Promise<void> = Promise.resolve()
  private readonly pendingEditor = new Map<string, Uint8Array>()
  private startPromise: Promise<boolean> | null = null
  private readonly listeners = new Set<(snapshot: SessionRuntimeSnapshot) => void>()
  private readonly fileOperations = new Map<string, Promise<SharedSessionFile>>()
  private projection: SessionFileProjection | null = null
  private watcher: FSWatcher | null = null
  private projectionTimer: ReturnType<typeof setTimeout> | null = null
  private projectionPaused = false
  private externalQueue: Promise<void> = Promise.resolve()
  private readonly gitOnlyPaths = new Set<string>()
  private observingExternal = false
  private readonly externalTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(options: SessionRuntimeOptions) {
    this.options = options
    this.files = new SessionFileDocument(options.sessionId)
    this.awareness = new Awareness(this.files.doc)
    this.files.doc.on("update", this.emit)
    this.files.doc.on("update", this.scheduleProjection)
  }

  subscribe(listener: (snapshot: SessionRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener); listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot(): SessionRuntimeSnapshot {
    return { sessionId: this.options.sessionId, role: this.options.role, connection: this.connection, error: this.error, sequence: this.provider?.getKnownSeq() ?? 0,
      files: this.files.files().map(({ content: _content, ...file }) => file), conflicts: this.files.pathConflicts(), gitOnlyPaths: [...this.gitOnlyPaths] }
  }
  private readonly emit = (): void => { const snapshot = this.snapshot(); for (const listener of this.listeners) listener(snapshot) }

  async start(): Promise<boolean> {
    if (this.stopped || this.stopping) throw new Error("Session runtime has stopped")
    if (this.provider && this.recovered) return true
    if (!this.startPromise) this.startPromise = this.open().finally(() => { this.startPromise = null })
    return this.startPromise
  }

  private async open(): Promise<boolean> {
    this.connection = "connecting"; this.error = null; this.emit()
    try {
      const recovered = await (this.options.offline ? this.options.checkpoints.recoverLocal() : this.options.checkpoints.bootstrap())
      if (!recovered) { this.connection = "idle"; this.error = "Waiting for an editor to initialize the encrypted session"; this.emit(); return false }
      if (this.stopped || this.stopping) return false
      this.recovery = await readOfflineRecovery(this.options.store, this.options.encryption, this.options.sessionId)
      Y.applyUpdate(this.files.doc, recovered.update, "snapshot")
      this.provider = new CollabWsProvider({
        doc: this.files.doc, awareness: this.awareness, session: this.options.session, encryption: this.options.encryption,
        initialKnownSeq: recovered.sequence, initialAcknowledgedUpdate: recovered.update,
        canonicalOnly: Boolean(this.options.beforeReplay) && !this.options.offline,
        outbox: {
          enqueue: record => this.options.store.enqueue(record), acknowledge: id => this.options.store.acknowledge(id), close: () => this.options.store.close(),
          list: async (roomId, keyVersion) => {
            const records = await this.options.store.list(roomId, keyVersion)
            const excluded = new Set(this.recovery.entries.flatMap(entry => entry.sources.filter(source => source.keyVersion === keyVersion && !source.kind).map(source => source.id)))
            for (const record of records) if (record.migratedFrom?.keyVersion === keyVersion && !record.migratedFrom.kind) excluded.add(record.migratedFrom.id)
            return records.filter(record => !excluded.has(record.id))
          },
        },
        refreshSession: this.options.refreshSession,
        onApplied: (sequence, encoded) => this.options.store.saveAcknowledged(sequence, encoded),
        onStateChange: (state, error) => { this.connection = state; this.error = error ?? null; this.emit() },
        onPermanentFailure: reason => { this.connection = "error"; this.error = reason; if (!this.stopping) this.options.onAuthorityFailure(reason); this.emit() },
        onBaseAdvanced: (sha, sequence) => { if (!this.stopping) this.options.onPublication(sha, sequence) },
        onRecoveryRequired: this.options.onRecoveryRequired,
        canWrite: this.options.role === "editor",
      })
      if (this.options.offline) {
        await this.provider.startOffline()
        this.connection = "reconnecting"; this.error = "Offline. Local edits are saved; reconnect before publishing."; this.emit()
      } else this.provider.start()
      await this.provider.waitForLocalRecovery()
      if (!this.options.offline && this.options.beforeReplay) {
        const canonical = (sequence?: number) => this.provider!.canonicalState(sequence).then(state => state.update)
        await this.options.beforeReplay(await canonical(), canonical)
        if (this.stopped || this.stopping) return false
      }
      this.recovery = await readOfflineRecovery(this.options.store, this.options.encryption, this.options.sessionId)
      await this.retireResolvedRecovery()
      await this.provider.resumeLocalRecovery()
      for (const ingress of await this.options.store.listEditorIngress()) {
        if (this.recovery.entries.some(entry => entry.sources.some(source => source.keyVersion === this.options.encryption.keyVersion && source.kind === "ingress" && source.id === ingress.id))) continue
        validateEncryptedCollaborationEnvelope(ingress.updateBinary, { roomId: this.options.session.roomId, projectId: this.options.session.projectId,
          kind: "yjs_update", keyVersion: this.options.encryption.keyVersion, idempotencyKey: ingress.id })
        const update = await decryptPayload({ envelope: bytesToEnvelope(Buffer.from(ingress.updateBinary, "base64")), roomKeyBase64: this.options.encryption.roomKeyBase64 })
        Y.applyUpdate(this.files.doc, update, "editor-recovery")
        await this.provider.flushLocalPersistence()
        await this.options.store.acknowledgeEditorIngress(ingress.id)
      }
      if (this.options.projection && !this.stopping) {
        this.projection = new SessionFileProjection({ ...this.options.projection, sessionId: this.options.sessionId,
          files: this.files, role: this.options.role, ...this.options.encryption, store: this.options.store,
          readBase: this.options.readBaseFile, persistEdits: () => this.provider!.flushLocalPersistence(),
        })
        const recoveryEntries = this.recovery.entries
        if (recoveryEntries.length) await this.projection.prepareRecoveredFiles(new Set(recoveryEntries.flatMap(entry => entry.files.map(file => file.id))), async (file, projection) => {
          await this.mutateRecovery(next => {
          if (projection) for (const entry of next.entries) if (!entry.projection) entry.projection = projection
          if (file && !next.entries.some(entry => entry.files.some(saved => saved.id === file.id && saved.content === file.content && saved.path === file.path && saved.executable === file.executable && saved.deleted === file.deleted))) {
            const id = createHash("sha256").update(`disk\0${file.id}\0${file.path}\0${file.content}\0${file.executable}\0${file.deleted}`).digest("hex")
            const sources = [...new Map(recoveryEntries.flatMap(entry => entry.sources).map(source => [recoverySourceId(source), source])).values()]
            next.entries.push({ id, incomplete: false, sources, branch: Buffer.from(new Uint8Array([0, 0])).toString("base64"), files: [file], resolved: [], saves: {} })
          }
          })
        }, relative => this.gitOnlyPaths.add(relative), recoveryEntries.flatMap(entry => entry.files))
        this.watcher = watch(this.options.projection.root, { recursive: true }, (_event, filename) => {
          if (this.stopping || this.stopped) return
          if (!filename) { this.scheduleProjection(); return }
          const relative = filename.toString().replaceAll("\\", "/")
          if (relative.split("/").includes(".git")) return
          const timer = this.externalTimers.get(relative)
          if (timer) clearTimeout(timer)
          this.externalTimers.set(relative, setTimeout(() => {
            this.externalTimers.delete(relative)
            this.externalQueue = this.externalQueue.catch(() => {}).then(() => this.observeExternalPath(relative))
            void this.externalQueue.catch(error => { this.projectionPaused = true; this.error = error instanceof Error ? error.message : "External file synchronization paused"; this.emit() })
          }, 80))
        })
        this.watcher.on("error", () => { this.projectionPaused = true; this.error = "Session file watcher stopped; local files are retained. Retry synchronization."; this.emit() })
        this.scheduleProjection()
      }
      this.recovered = true
      this.scheduleProjection()
      return true
    } catch (error) {
      await this.provider?.shutdown()
      this.provider = null; this.recovered = false
      this.connection = "error"; this.error = error instanceof Error ? error.message : "Session recovery failed"; this.emit(); throw error
    }
  }

  private readonly scheduleProjection = (): void => {
    if (!this.recovered || !this.projection || this.stopped || this.stopping || this.projectionPaused || this.projectionTimer || this.observingExternal || this.fileOperations.size) return
    this.projectionTimer = setTimeout(() => {
      this.projectionTimer = null
      void this.projectFiles().catch(() => {})
    }, 40)
  }

  async projectFiles(): Promise<void> {
    if (!this.recovered || this.stopped || this.stopping || this.observingExternal || this.fileOperations.size) return
    try { await this.projection?.reconcile() }
    catch (error) {
      this.projectionPaused = true
      this.error = error instanceof Error ? error.message : "Shared file projection paused"
      this.emit(); throw error
    }
  }

  async retryProjection(): Promise<void> { this.projectionPaused = false; this.error = null; await this.projectFiles(); this.emit() }
  async retry(): Promise<void> {
    this.provider?.retry()
    await this.provider?.waitForLocalRecovery()
    if (this.provider) for (const [id, update] of this.pendingEditor) await this.persistEditorUpdate(this.provider, update, id)
    await this.retryProjection()
  }

  recoveryEntries(): import("../../../../shared/collaborationRuntime").RecoveredOfflineEntry[] {
    return this.recovery.entries.filter(entry => entry.incomplete || entry.files.some(file => !entry.resolved.includes(file.id))).map(entry => ({
      id: entry.id, incomplete: entry.incomplete, retainedRecords: entry.sources.length, unresolvedFiles: entry.files.filter(file => !entry.resolved.includes(file.id)).length,
    }))
  }
  private mutateRecovery(change: (journal: typeof this.recovery) => void, retire = false): Promise<void> {
    const operation = this.recoveryMutation.catch(() => {}).then(async () => {
      const next = structuredClone(this.recovery)
      change(next)
      await saveOfflineRecovery(this.options.store, this.options.encryption, this.options.sessionId, next)
      this.recovery = next
      if (retire) await this.retireResolvedRecovery()
    })
    this.recoveryMutation = operation
    return operation
  }

  private async retireResolvedRecovery(): Promise<void> {
    const unresolved = new Set(this.recovery.entries.filter(entry => entry.incomplete || entry.files.length === 0 || entry.files.some(file => !entry.resolved.includes(file.id))).flatMap(entry => entry.sources.map(recoverySourceId)))
    for (const entry of this.recovery.entries) if (!entry.incomplete && entry.files.length > 0 && entry.files.every(file => entry.resolved.includes(file.id))) await this.options.store.retireRecoverySources(entry.sources.filter(source => !unresolved.has(recoverySourceId(source))))
  }

  recoveredFiles(): import("../../../../shared/collaborationRuntime").RecoveredOfflineFile[] {
    return this.recovery.entries.flatMap(entry => entry.files.filter(file => !entry.resolved.includes(file.id)).map(file => ({
      ...file, recoveryId: entry.id, canonicalContent: this.files.file(file.id)?.content ?? null, savingPath: entry.saves[file.id]?.path ?? null,
    })))
  }

  async resolveRecovered(input: { recoveryId: string; fileId: string; action: "save" | "discard"; path?: string }): Promise<void> {
    const operation = this.editorQueue.catch(() => {}).then(() => this.resolveRecoveredFile(input))
    this.editorQueue = operation
    return operation
  }
  private async resolveRecoveredFile(input: { recoveryId: string; fileId: string; action: "save" | "discard"; path?: string }): Promise<void> {
    if (this.stopping || this.stopped) throw new Error("Session runtime has stopped")
    const nextRecovery = structuredClone(this.recovery)
    const entry = nextRecovery.entries.find(entry => entry.id === input.recoveryId)
    const file = entry?.files.find(file => file.id === input.fileId)
    if (!entry || !file) throw new Error("Recovered offline file not found")
    if (entry.resolved.includes(file.id)) { await this.mutateRecovery(() => {}, true); return }
    if (input.action !== "save" && input.action !== "discard") throw new Error("Choose a recovery action")
    if (input.action === "save") {
      const provider = this.assertEditor()
      let saved = entry.saves[file.id]
      if (!saved) {
        const filePath = assertSharedFilePath(input.path ?? "")
        if (this.files.resolvePath(filePath) || await this.options.readBaseFile(filePath) || this.options.projection && await lstat(path.join(this.options.projection.root, filePath)).then(() => true, error => { if (error.code === "ENOENT") return false; throw error })) throw new Error("Choose an unused path for recovered content; an existing file occupies this path")
        this.assertEditor()
        const clone = new SessionFileDocument(this.options.sessionId)
        try {
          Y.applyUpdate(clone.doc, this.files.checkpoint())
          const vector = Y.encodeStateVector(clone.doc)
          const fileId = createHash("sha256").update(`recovered\0${entry.id}\0${file.id}`).digest("hex")
          clone.initializeFile({ id: fileId, path: filePath, content: file.content, executable: file.executable, originalPath: null }, "recovered-offline-file")
          saved = { path: filePath, fileId, recordId: "", updateBinary: "", update: Buffer.from(Y.encodeStateAsUpdate(clone.doc, vector)).toString("base64"), keyVersion: 0 }
        } finally { clone.destroy() }
      } else if (input.path && input.path !== saved.path) throw new Error("Retry the previously chosen recovery path")
      if (saved.keyVersion !== this.options.encryption.keyVersion) {
        const recordId = `recovery_${createHash("sha256").update(`${entry.id}\0${file.id}\0${this.options.encryption.keyVersion}`).digest("hex")}`
        const encrypted = await encryptPayload({ ...this.options.encryption, kind: "yjs_update", plaintext: Buffer.from(saved.update, "base64"),
          metadata: { roomId: this.options.session.roomId, projectId: this.options.session.projectId, sessionId: this.options.sessionId, idempotencyKey: recordId } })
        saved = { ...saved, recordId, keyVersion: this.options.encryption.keyVersion, updateBinary: Buffer.from(envelopeToBytes(encrypted)).toString("base64") }
        const prepared = saved
        await this.mutateRecovery(latest => { latest.entries.find(current => current.id === entry.id)!.saves[file.id] = prepared })
      }
      this.assertEditor()
      await this.options.store.enqueue({ id: saved.recordId, projectId: this.options.session.projectId, roomId: this.options.session.roomId,
        keyVersion: saved.keyVersion, updateBinary: saved.updateBinary, timestamp: Date.now() })
      await provider.resumeLocalRecovery()
      await provider.captureCommitState()
    } else if (entry.saves[file.id]) throw new Error("This recovery save is pending acknowledgement; retry saving before discarding")
    // ACK waits run outside the journal queue. Merge the disposition into the
    // latest durable branch, including disk variants retained during the wait.
    await this.mutateRecovery(latest => {
      const current = latest.entries.find(current => current.id === entry.id)!
      if (!current.resolved.includes(file.id)) current.resolved.push(file.id)
    }, true)
    this.emit()
  }

  async createFile(filePath: string, content = ""): Promise<SharedSessionFile> {
    const provider = this.assertEditor()
    assertSharedFilePath(filePath)
    if (this.files.resolvePath(filePath) || await this.options.readBaseFile(filePath)) throw new Error("A file already occupies this path")
    this.assertEditor() // The awaited Git read may outlive a Leave/quit fence.
    if (content.includes("\0") || Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error("New file exceeds the shared text limit")
    const id = randomUUID()
    this.files.initializeFile({ id, path: filePath, content, originalPath: null }, "create-file")
    await provider.flushLocalPersistence()
    return this.files.file(id)!
  }

  async renameFile(id: string, targetPath: string): Promise<void> {
    const provider = this.assertEditor()
    const file = this.files.file(id)
    if (!file) throw new Error("Shared file not found")
    if (targetPath !== file.path && await this.options.readBaseFile(targetPath)) throw new Error("A Git file already occupies the target path")
    this.assertEditor() // Recheck after the asynchronous target-base lookup.
    this.files.renameFile(id, targetPath)
    await provider.flushLocalPersistence()
  }

  async deleteFile(id: string): Promise<void> { const provider = this.assertEditor(); this.files.deleteFile(id); await provider.flushLocalPersistence() }
  async replaceFile(id: string, content: string, executable?: boolean): Promise<void> {
    const provider = this.assertEditor()
    if (Buffer.byteLength(content) > 2 * 1024 * 1024 || content.includes("\0")) throw new Error("Shared text limit exceeded")
    this.files.replaceText(id, content)
    if (executable !== undefined) this.files.setExecutable(id, executable)
    await provider.flushLocalPersistence()
  }
  async restoreFile(id: string, targetPath?: string): Promise<void> { const provider = this.assertEditor(); this.files.restoreFile(id, targetPath); await provider.flushLocalPersistence() }

  private assertEditor(): CollabWsProvider {
    if (this.stopped || this.stopping || this.options.role !== "editor") throw new Error("An active editor is required to change shared files")
    if (!this.provider || !this.recovered) throw new Error("Wait for encrypted session recovery before editing")
    return this.provider
  }

  async openFile(filePath: string): Promise<SharedSessionFile> {
    if (this.stopped || this.stopping) throw new Error("Session runtime is stopping")
    assertSharedFilePath(filePath)
    const existing = this.files.resolvePath(filePath)
    if (existing) return existing
    const pending = this.fileOperations.get(filePath)
    if (pending) return pending
    const operation = this.initializeFile(filePath).finally(() => { this.fileOperations.delete(filePath); this.scheduleProjection() })
    this.fileOperations.set(filePath, operation)
    return operation
  }

  private async initializeFile(filePath: string): Promise<SharedSessionFile> {
    const provider = this.provider
    if (!provider) throw new Error("Wait for encrypted session recovery")
    await this.projection?.flush()
    const id = createHash("sha256").update(`${this.options.sessionId}\0${filePath}`).digest("hex")
    const claim = await this.options.claimFile(id)
    if (claim.sequence !== undefined) await provider.waitForSequence(claim.sequence)
    else if (claim.lease) {
      this.assertEditor()
      const base = await this.options.readBaseFile(filePath)
      if (!base) throw new Error("This path is absent from the Git base; create a new shared file explicitly")
      if (Buffer.byteLength(base.content) > 2 * 1024 * 1024 || base.content.includes("\0")) throw new Error("This file is Git-only because it is binary or exceeds the shared text limit")
      this.assertEditor()
      const basisId = randomUUID()
      const recoveryBasis = { id: basisId, keyVersion: this.options.encryption.keyVersion }
      const basis = await encryptPayload({ ...this.options.encryption, kind: "yjs_snapshot", plaintext: this.files.checkpoint(),
        metadata: { purpose: "file-initialization-basis", sessionId: this.options.sessionId, fileId: id, leaseId: claim.lease.leaseId } })
      await this.options.store.saveInitializationBasis(basisId, Buffer.from(envelopeToBytes(basis)).toString("base64"))
      this.assertEditor()
      this.files.initializeFile({ id, path: filePath, originalPath: filePath, ...base }, { type: "file-initialization", fileId: id, leaseId: claim.lease.leaseId, recoveryBasis })
      await this.projection?.trackCanonicalFile(id)
      await provider.captureCommitState()
    } else throw new Error("Waiting for an editor to open this shared file")
    const initialized = this.files.file(id)
    if (!initialized) throw new Error("Canonical file initialization was not received; retry synchronization")
    return initialized
  }

  private async observeExternalPath(relative: string): Promise<void> {
    this.observingExternal = true
    try {
      // A projection already queued before this watcher event must finish
      // before a newly discovered file enters the CRDT. Otherwise that older
      // projection can see the new file before its disk baseline is recorded.
      await this.projection?.flush()
      await this.reconcileExternalPath(relative)
    }
    finally { this.observingExternal = false; this.scheduleProjection() }
  }

  private async reconcileExternalPath(relative: string): Promise<void> {
    if (this.stopped || this.stopping || this.projectionPaused || !this.projection) return
    assertSharedFilePath(relative)
    if (this.files.files().some(file => file.path === relative || file.originalPath === relative)) {
      try { await this.projection.readExternalText(relative) }
      catch { this.gitOnlyPaths.add(relative); throw new Error("A shared file now contains unsupported bytes; retain the local file and resolve it before committing") }
      this.scheduleProjection(); return
    }
    // Recovery dispositions retain ownership of their original disk paths even
    // after explicit discard. A watcher must never publish them as new files.
    const quarantined = this.recovery.entries.flatMap(entry => entry.files).find(file => sharedPathComparisonKey(file.path) === sharedPathComparisonKey(relative) || file.originalPath && sharedPathComparisonKey(file.originalPath) === sharedPathComparisonKey(relative))
    if (quarantined) {
      try { await this.projection.retainQuarantinedPath(relative, quarantined) }
      catch (error) { this.gitOnlyPaths.add(relative); throw error }
      this.emit(); return
    }
    if (this.options.role !== "editor" || !this.options.shouldTrackExternal || !await this.options.shouldTrackExternal(relative)) return
    let local: { content: string; executable: boolean } | null
    try { local = await this.projection.readExternalText(relative) }
    catch { this.gitOnlyPaths.add(relative); this.emit(); return }
    if (!local) return
    let base: { content: string; executable: boolean } | null
    try { base = await this.options.readBaseFile(relative) }
    catch { this.gitOnlyPaths.add(relative); this.emit(); return }
    if (base) await this.openFile(relative)
    else {
      const file = await this.createFile(relative, local.content)
      this.files.setExecutable(file.id, local.executable)
      await this.provider!.flushLocalPersistence()
      await this.projection.trackCanonicalFile(file.id)
    }
    this.scheduleProjection()
  }

  /** Editor bindings receive canonical CRDT bytes, never room keys or Git credentials. */
  editorState(): Uint8Array { return Y.encodeStateAsUpdate(this.files.doc) }

  async applyEditorUpdate(update: Uint8Array): Promise<void> {
    const provider = this.assertEditor()
    if (!(update instanceof Uint8Array) || update.length > 2 * 1024 * 1024) throw new Error("Editor update exceeds its limit; local changes must be retained")
    const saved = update.slice()
    const operation = this.editorQueue.catch(() => {}).then(() => this.persistEditorUpdate(provider, saved))
    this.editorQueue = operation
    return operation
  }

  private async persistEditorUpdate(provider: CollabWsProvider, update: Uint8Array, retryId?: string): Promise<void> {
    const candidate = new SessionFileDocument(this.options.sessionId)
    try {
      Y.applyUpdate(candidate.doc, this.editorState()); Y.applyUpdate(candidate.doc, update)
      const files = candidate.files()
      if (files.length > 10_000 || files.some(file => Buffer.byteLength(file.content) > 2 * 1024 * 1024)) throw new Error("Shared text storage limit reached")
      const metadata = (values: SharedSessionFile[]) => JSON.stringify(values.map(({ content: _content, ...file }) => file))
      if (metadata(files) !== metadata(this.files.files())) throw new Error("Use the session file coordinator for create, rename, delete and mode changes")
      const id = retryId ?? `ingress_${randomUUID()}`
      this.pendingEditor.set(id, update)
      const encrypted = await encryptPayload({ ...this.options.encryption, kind: "yjs_update", plaintext: update,
        metadata: { roomId: this.options.session.roomId, projectId: this.options.session.projectId, sessionId: this.options.sessionId, idempotencyKey: id } })
      await this.options.store.saveEditorIngress({ id, projectId: this.options.session.projectId, roomId: this.options.session.roomId, keyVersion: this.options.encryption.keyVersion,
        updateBinary: Buffer.from(envelopeToBytes(encrypted)).toString("base64"), timestamp: Date.now() })
      Y.applyUpdate(this.files.doc, update, "editor")
      await provider.flushLocalPersistence()
      await this.options.store.acknowledgeEditorIngress(id)
      this.pendingEditor.delete(id)
    } finally { candidate.destroy() }
  }

  async captureCommit(): Promise<{ sequence: number; textChanges: CollaborationTextChange[] }> {
    if (this.projectionPaused) throw new Error("Resolve paused file synchronization before committing; local bytes were retained")
    const snapshot = await this.assertEditor().captureCommitState()
    const acknowledged = new SessionFileDocument(this.options.sessionId)
    try { Y.applyUpdate(acknowledged.doc, snapshot.update); return { sequence: snapshot.sequence, textChanges: acknowledged.snapshotChanges() } }
    finally { acknowledged.destroy() }
  }

  async waitForSequence(sequence: number): Promise<void> {
    if (!this.provider) throw new Error("Session is not initialized")
    await this.provider.waitForSequence(sequence)
  }

  async readyForWorkspace(): Promise<void> {
    if (!this.provider) throw new Error("Encrypted session is not initialized")
    if (!this.options.offline) await this.provider.waitForCatchUp()
    for (const relative of await this.options.changedPaths?.() ?? []) await this.observeExternalPath(relative)
    await this.projectFiles()
  }

  async reconnectAuthorized(session: CollabSessionDescriptor): Promise<void> {
    if (!this.provider) throw new Error("Session is not initialized")
    await this.provider.reconnectAuthorized(session)
  }

  async frozenCheckpoint(sequence: number): Promise<{ sequence: number; update: Uint8Array }> {
    if (!this.provider) throw new Error("Session is not initialized")
    return this.provider.frozenCheckpoint(sequence)
  }

  reportRecoveryError(error: unknown): void {
    this.error = error instanceof Error ? error.message : "Session recovery needs attention; local files were retained"
    this.emit()
  }

  checkpointPublished(sequence: number): Promise<void> {
    const provider = this.provider
    if (!provider || this.stopping || this.stopped || this.options.role !== "editor") return Promise.resolve()
    const operation = (async () => {
      if (((await this.options.store.recover()).checkpoint?.sequence ?? -1) >= sequence) return
      await provider.waitForSequence(sequence)
      const state = provider.acknowledgedCheckpoint()
      if (await this.options.checkpoints.checkpoint(state.sequence, state.update)) provider.compactAcknowledged(sequence)
    })().finally(() => this.checkpointOperations.delete(operation))
    this.checkpointOperations.add(operation)
    return operation
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopping = true
    // Fence timers and future filesystem events before waiting on any producer.
    // Already accepted editor/file/checkpoint work is drained, not discarded.
    this.watcher?.close(); this.watcher = null
    for (const timer of this.externalTimers.values()) clearTimeout(timer)
    this.externalTimers.clear()
    if (this.projectionTimer) clearTimeout(this.projectionTimer)
    this.projectionTimer = null
    const operation = (async () => {
      await this.startPromise?.catch(() => {})
      await this.editorQueue.catch(() => {})
      if (this.provider) for (const [id, update] of this.pendingEditor) await this.persistEditorUpdate(this.provider, update, id)
      await Promise.allSettled([...this.fileOperations.values(), ...this.checkpointOperations])
      await this.externalQueue.catch(() => {})
      await this.projection?.flush().catch(() => {})
      await this.recoveryMutation.catch(() => {})
      await this.provider?.flushLocalPersistence()
      // Close the receive input and await in-flight decryption/acknowledgement
      // callbacks before the last store flush or destruction of the Yjs owner.
      await this.provider?.shutdown()
      await this.options.store.flush()
      this.provider = null
      this.stopped = true
      this.awareness.destroy(); this.files.doc.off("update", this.emit); this.files.doc.off("update", this.scheduleProjection); this.files.destroy(); this.listeners.clear()
    })()
    this.stopPromise = operation
    void operation.catch(() => { if (this.stopPromise === operation) this.stopPromise = null })
    return operation
  }
}

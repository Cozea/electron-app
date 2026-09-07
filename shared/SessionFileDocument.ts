import * as Y from "yjs"
import DiffMatchPatch from "diff-match-patch"
import type { CollaborationTextChange } from "./collaborationDesktop"
import { assertSharedFilePath, sharedPathComparisonKey } from "./collaborationPaths"

export interface SharedSessionFile {
  id: string
  path: string
  originalPath: string | null
  deleted: boolean
  executable: boolean
  content: string
}

/**
 * Stable file identities keep text independent of path operations. Tombstones
 * retain text and CRDT identities for late/offline edits and explicit recovery.
 * Unopened, unchanged files remain in Git and never enter this document.
 */
export class SessionFileDocument {
  readonly doc: Y.Doc
  private readonly renameIntents: Y.Map<{ fileId: string; from: string; to: string }>
  private readonly paths: Y.Map<string>
  private readonly originalPaths: Y.Map<string>
  private readonly deleted: Y.Map<boolean>
  private readonly executable: Y.Map<boolean>
  private readonly diff = new DiffMatchPatch()

  constructor(sessionId: string, doc?: Y.Doc) {
    this.doc = doc ?? new Y.Doc({ guid: `cozea:g3:${sessionId}`, gc: false })
    this.doc.gc = false
    this.paths = this.doc.getMap("file-paths")
    this.renameIntents = this.doc.getMap("file-rename-intents")
    this.originalPaths = this.doc.getMap("file-origins")
    this.deleted = this.doc.getMap("file-tombstones")
    this.executable = this.doc.getMap("file-modes")
  }

  text(id: string): Y.Text {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error("Invalid shared file identity")
    return this.doc.getText(`file-content:${id}`)
  }

  /** Only the room's initialization lease holder calls this for a Git file. */
  initializeFile(input: { id: string; path: string; content: string; originalPath?: string | null; executable?: boolean }, origin: unknown = "initialize-file"): void {
    assertSharedFilePath(input.path)
    if (this.paths.has(input.id)) throw new Error("This shared file already has a canonical history")
    if (input.originalPath) assertSharedFilePath(input.originalPath)
    this.doc.transact(() => {
      this.paths.set(input.id, input.path)
      this.originalPaths.set(input.id, input.originalPath ?? "")
      this.executable.set(input.id, input.executable ?? false)
      this.text(input.id).insert(0, input.content)
    }, origin)
  }

  files(): SharedSessionFile[] {
    return [...this.paths].map(([id, filePath]) => ({
      id, path: assertSharedFilePath(filePath), originalPath: this.originalPaths.get(id) || null,
      deleted: this.deleted.get(id) === true, executable: this.executable.get(id) === true,
      content: this.text(id).toString(),
    })).sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id))
  }

  file(id: string): SharedSessionFile | null { return this.files().find(file => file.id === id) ?? null }

  resolvePath(filePath: string): SharedSessionFile | null {
    const key = sharedPathComparisonKey(filePath)
    const matches = this.files().filter(file => !file.deleted && sharedPathComparisonKey(file.path) === key)
    if (matches.length > 1) throw new Error("Concurrent files share this path; resolve the collision first")
    return matches[0] ?? null
  }

  renameFile(id: string, targetPath: string): void {
    if (!this.paths.has(id)) throw new Error("Shared file not found")
    assertSharedFilePath(targetPath)
    const collision = this.files().find(file => !file.deleted && file.id !== id && sharedPathComparisonKey(file.path) === sharedPathComparisonKey(targetPath))
    if (collision) throw new Error("Rename would overwrite another shared file")
    const from = this.paths.get(id)!
    this.doc.transact(() => {
      for (const [key, intent] of this.renameIntents) if (intent.fileId === id) this.renameIntents.delete(key)
      this.renameIntents.set(globalThis.crypto.randomUUID(), { fileId: id, from, to: targetPath })
      this.paths.set(id, targetPath)
    })
  }

  renameConflicts(): Array<{ fileId: string; paths: string[] }> {
    const grouped = new Map<string, Set<string>>()
    for (const intent of this.renameIntents.values()) {
      if (!intent || typeof intent.fileId !== "string" || typeof intent.from !== "string" || typeof intent.to !== "string" || !this.paths.has(intent.fileId)) throw new Error("Invalid shared rename intent")
      assertSharedFilePath(intent.from); assertSharedFilePath(intent.to)
      const paths = grouped.get(intent.fileId) ?? new Set<string>()
      paths.add(intent.to); grouped.set(intent.fileId, paths)
      if (paths.size > 128) throw new Error("Too many competing shared rename targets; history retained")
    }
    return [...grouped].filter(([, paths]) => paths.size > 1).map(([fileId, paths]) => ({ fileId, paths: [...paths].sort() }))
  }

  deleteFile(id: string): void {
    if (!this.paths.has(id)) throw new Error("Shared file not found")
    this.deleted.set(id, true)
  }

  setExecutable(id: string, executable: boolean): void {
    if (!this.paths.has(id)) throw new Error("Shared file not found")
    this.executable.set(id, executable)
  }

  restoreFile(id: string, targetPath?: string): void {
    const file = this.file(id)
    if (!file) throw new Error("Deleted shared file not found")
    if (targetPath === undefined && this.renameConflicts().some(conflict => conflict.fileId === id)) throw new Error("Choose a path to restore competing shared renames")
    const target = targetPath ?? file.path
    const collision = this.resolvePath(target)
    if (collision && collision.id !== id) throw new Error("Choose a different path to recover this file")
    this.doc.transact(() => {
      this.renameFile(id, target)
      this.deleted.set(id, false)
    }, "restore-file")
  }

  replaceText(id: string, content: string, origin: unknown = "editor"): void {
    if (!this.paths.has(id)) throw new Error("Shared file not initialized")
    const text = this.text(id)
    const changes = this.diff.diff_main(text.toString(), content)
    this.diff.diff_cleanupSemantic(changes)
    this.doc.transact(() => {
      let index = 0
      for (const [operation, value] of changes) {
        if (operation === 0) index += value.length
        else if (operation === -1) text.delete(index, value.length)
        else { text.insert(index, value); index += value.length }
      }
    }, origin)
  }

  /**
   * Interpret a CLI/formatter write against the CRDT state last projected to
   * disk. Applying its delta to the live doc preserves concurrent remote edits;
   * diffing stale disk bytes against the live text would erase those edits.
   */
  reconcileExternalWrite(id: string, content: string, projectedState: Uint8Array): void {
    const projection = new SessionFileDocument(this.doc.guid)
    try {
      Y.applyUpdate(projection.doc, projectedState)
      const vector = Y.encodeStateVector(projection.doc)
      projection.replaceText(id, content, "external-write")
      Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(projection.doc, vector), "external-write")
    } finally { projection.destroy() }
  }

  pathConflicts(): Array<{ path: string; fileIds: string[] }> {
    const groups = new Map<string, SharedSessionFile[]>()
    for (const file of this.files().filter(file => !file.deleted)) {
      const key = sharedPathComparisonKey(file.path)
      const entries = groups.get(key) ?? []
      entries.push(file)
      groups.set(key, entries)
    }
    const conflicts: Array<{ path: string; fileIds: string[] }> = []
    for (const [key, entries] of groups) {
      const children = [...groups.entries()].filter(([other]) => other.startsWith(`${key}/`)).flatMap(([, values]) => values)
      if (entries.length > 1 || children.length) conflicts.push({ path: entries[0]!.path, fileIds: [...entries, ...children].map(file => file.id) })
    }
    return conflicts
  }

  snapshotChanges(): CollaborationTextChange[] {
    if (this.renameConflicts().length) throw new Error("Resolve competing shared renames before committing or projecting files")
    if (this.pathConflicts().length) throw new Error("Resolve shared path collisions before committing or projecting files")
    const files = this.files()
    const changes = new Map<string, CollaborationTextChange>()
    for (const file of files) {
      if (file.originalPath && (file.deleted || file.path !== file.originalPath)) changes.set(file.originalPath, { path: file.originalPath, content: null })
      if (file.deleted && !file.originalPath) changes.set(file.path, { path: file.path, content: null })
    }
    for (const file of files) if (!file.deleted) changes.set(file.path, { path: file.path, content: file.content, executable: file.executable })
    return [...changes.values()].sort((a, b) => a.path.localeCompare(b.path))
  }

  checkpoint(): Uint8Array { return Y.encodeStateAsUpdate(this.doc) }
  destroy(): void { this.doc.destroy() }
}

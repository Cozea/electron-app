#!/usr/bin/env node
// Temporary isolated-checkout integration driver; remove after verification.
import fs from "node:fs";
const edits = new Map();
function replace(file, before, after) {
  const source = edits.get(file) ?? fs.readFileSync(file, "utf8");
  if (source.includes(after)) return;
  if (source.split(before).length !== 2) throw new Error(`Expected one receive-drain anchor in ${file}`);
  edits.set(file, source.replace(before, after));
}
const transport = "shared/CollaborationTransport.ts";
replace(transport, '  private destroyed = false', '  private destroyed = false\n  private resourcesReleased = false\n  private shutdownPromise: Promise<void> | null = null');
replace(transport, '    await this.restoreOutboxAndConnect(false)', '    this.recoveryPromise = this.restoreOutboxAndConnect(false)\n    await this.recoveryPromise');
replace(transport, '  destroy(): void {\n    this.destroyed = true', '  private stopReceiving(): void {\n    if (this.destroyed) return\n    this.destroyed = true');
replace(transport, '    this.barrierWaiters.clear()\n    const socket', '    this.barrierWaiters.clear()\n    for (const done of this.drainWaiters) done()\n    this.drainWaiters.clear()\n    const socket');
replace(transport, `    this.outbox.close()
    this.acknowledged.destroy()
  }

  getConnectionState()`, `  }

  /** Fence producers before awaiting consumers. An already-entered encrypted
   * receive callback can still be awaiting onApplied after the socket closes.
   * A store.flush() alone cannot see a write that has not entered the store yet. */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.stopReceiving()
    this.shutdownPromise = (async () => {
      // Recovery and receive failures retain their durable source (outbox/room)
      // for replay. They must settle before those owners can be disposed.
      await Promise.allSettled([this.recoveryPromise, this.incomingQueue])
      await this.flushLocalPersistence()
      this.destroy()
    })()
    return this.shutdownPromise
  }

  destroy(): void {
    this.stopReceiving()
    if (this.resourcesReleased) return
    this.resourcesReleased = true
    this.outbox.close()
    this.acknowledged.destroy()
  }

  getConnectionState()`);
replace(transport, '    socket.onmessage = (event) => {\n      this.incomingQueue', '    socket.onmessage = (event) => {\n      if (this.destroyed || this.socket !== socket) return\n      this.incomingQueue');
replace(transport, `    if (update.updateBinary.length > COLLABORATION_CHUNK_CHARS) {
      for (const chunk of await splitCollaborationUpdate(update.idempotencyKey, update.updateBinary)) {
        this.socket.send(JSON.stringify({ type: "update.chunk", payload: { roomId: this.session.roomId, chunk, timestamp: update.timestamp } }))
      }
      return
    }`, `    if (update.updateBinary.length > COLLABORATION_CHUNK_CHARS) {
      const socket = this.socket
      const chunks = await splitCollaborationUpdate(update.idempotencyKey, update.updateBinary)
      for (const chunk of chunks) {
        // Closing during asynchronous chunk preparation is not a local
        // persistence failure: the exact ciphertext is already in the outbox.
        if (this.destroyed || this.outgoingSuspended || this.socket !== socket || socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify({ type: "update.chunk", payload: { roomId: this.session.roomId, chunk, timestamp: update.timestamp } }))
      }
      return
    }`);
const runtime = "apps/desktop/electron/collaboration/CollaborationSessionRuntime.ts";
replace(runtime, '  private stopping = false', '  private stopping = false\n  private stopPromise: Promise<void> | null = null\n  private readonly checkpointOperations = new Set<Promise<void>>()');
replace(runtime, '    if (this.stopped) throw new Error("Session runtime has stopped")', '    if (this.stopped || this.stopping) throw new Error("Session runtime has stopped")');
replace(runtime, '      if (this.stopped) return false', '      if (this.stopped || this.stopping) return false');
replace(runtime, '      await this.options.beforeReplay?.(recovered.update)\n      Y.applyUpdate', '      await this.options.beforeReplay?.(recovered.update)\n      if (this.stopped || this.stopping) return false\n      Y.applyUpdate');
replace(runtime, '        onBaseAdvanced: this.options.onPublication,', '        onBaseAdvanced: (sha, sequence) => { if (!this.stopping) this.options.onPublication(sha, sequence) },');
replace(runtime, '        onPermanentFailure: reason => { this.connection = "error"; this.error = reason; this.options.onAuthorityFailure(reason); this.emit() },', '        onPermanentFailure: reason => { this.connection = "error"; this.error = reason; if (!this.stopping) this.options.onAuthorityFailure(reason); this.emit() },');
replace(runtime, '      if (this.options.projection) {', '      if (this.options.projection && !this.stopping) {');
replace(runtime, '        this.watcher = watch(this.options.projection.root, { recursive: true }, (_event, filename) => {\n          if (!filename)', '        this.watcher = watch(this.options.projection.root, { recursive: true }, (_event, filename) => {\n          if (this.stopping || this.stopped) return\n          if (!filename)');
replace(runtime, '    if (!this.projection || this.stopped || this.projectionPaused', '    if (!this.projection || this.stopped || this.stopping || this.projectionPaused');
replace(runtime, '    if (this.observingExternal || this.fileOperations.size) return', '    if (this.stopped || this.stopping || this.observingExternal || this.fileOperations.size) return');
replace(runtime, '    if (this.files.resolvePath(filePath) || await this.options.readBaseFile(filePath)) throw new Error("A file already occupies this path")\n    if (content.includes', '    if (this.files.resolvePath(filePath) || await this.options.readBaseFile(filePath)) throw new Error("A file already occupies this path")\n    this.assertEditor() // The awaited Git read may outlive a Leave/quit fence.\n    if (content.includes');
replace(runtime, '    this.files.renameFile(id, targetPath)', '    this.assertEditor() // Recheck after the asynchronous target-base lookup.\n    this.files.renameFile(id, targetPath)');
replace(runtime, '  async openFile(filePath: string): Promise<SharedSessionFile> {\n    assertSharedFilePath', '  async openFile(filePath: string): Promise<SharedSessionFile> {\n    if (this.stopped || this.stopping) throw new Error("Session runtime is stopping")\n    assertSharedFilePath');
replace(runtime, '      this.files.initializeFile({ id, path: filePath, originalPath: filePath, ...base },', '      this.assertEditor()\n      this.files.initializeFile({ id, path: filePath, originalPath: filePath, ...base },');
replace(runtime, '    if (this.stopped || this.projectionPaused || !this.projection) return', '    if (this.stopped || this.stopping || this.projectionPaused || !this.projection) return');
replace(runtime, `  async checkpointPublished(sequence: number): Promise<void> {
    if (!this.provider || this.options.role !== "editor") return
    if (((await this.options.store.recover()).checkpoint?.sequence ?? -1) >= sequence) return
    await this.provider.waitForSequence(sequence)
    const state = this.provider.acknowledgedCheckpoint()
    if (await this.options.checkpoints.checkpoint(state.sequence, state.update)) this.provider.compactAcknowledged(sequence)
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.editorQueue.catch(() => {})
    if (this.provider) for (const [id, update] of this.pendingEditor) await this.persistEditorUpdate(this.provider, update, id)
    this.stopped = true
    this.watcher?.close(); this.watcher = null
    for (const timer of this.externalTimers.values()) clearTimeout(timer)
    this.externalTimers.clear()
    if (this.projectionTimer) clearTimeout(this.projectionTimer)
    this.projectionTimer = null
    await this.startPromise?.catch(() => {})
    await this.externalQueue.catch(() => {})
    await this.projection?.flush().catch(() => {})
    await this.provider?.flushLocalPersistence()
    this.provider?.destroy(); this.provider = null
    await this.options.store.flush()
    this.awareness.destroy(); this.files.doc.off("update", this.emit); this.files.doc.off("update", this.scheduleProjection); this.files.destroy(); this.listeners.clear()
  }`, `  checkpointPublished(sequence: number): Promise<void> {
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
  }`);
for (const [file, content] of edits) {
  console.log(file);
  if (!process.argv.includes("--check")) fs.writeFileSync(file, content);
}

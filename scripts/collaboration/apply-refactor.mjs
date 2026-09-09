import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
const changed = new Set();
const edit = (name, transform) => { const before = readFileSync(name, "utf8"); const after = transform(before); if (before === after) throw new Error(`No transformation: ${name}`); writeFileSync(name, after); changed.add(name); };
const replace = (source, before, after) => { const at = source.indexOf(before); if (at < 0 || source.indexOf(before, at + before.length) >= 0) throw new Error(`Exact anchor changed: ${before.slice(0, 100)}`); return source.slice(0, at) + after + source.slice(at + before.length); };
const create = (name, content) => { if (existsSync(name)) throw new Error(`File already exists: ${name}`); mkdirSync(path.dirname(name), { recursive: true }); writeFileSync(name, content); changed.add(name); };

edit("cloudflare/worker/src/lib/protocol.ts", source => {
  source = 'import type { CollaborationChunk } from "../../../../shared/collaborationWire"\n' + source;
  source = replace(source, '    knownSeq: number\n    clientType:', '    knownSeq: number\n    collaborationRevision?: number\n    clientType:');
  source = replace(source, '    resyncRequired: boolean', '    resyncRequired: boolean\n    collaborationRevision?: number');
  source = replace(source, 'export interface UpdateAckMessage {', 'export interface UpdateChunkMessage {\n  type: "update.chunk"\n  payload: { roomId: string; chunk: CollaborationChunk; timestamp: number }\n}\nexport interface SyncChunkMessage {\n  type: "sync.chunk"\n  payload: { roomId: string; sequence: number; headSeq: number; chunk: CollaborationChunk }\n}\n\nexport interface UpdateAckMessage {');
  source = replace(source, '  | UpdatePushMessage\n', '  | UpdatePushMessage\n  | UpdateChunkMessage\n');
  return replace(source, '  | SyncDeltaMessage\n', '  | SyncDeltaMessage\n  | SyncChunkMessage\n');
});

edit("cloudflare/worker/src/lib/collaborationLimits.ts", source => {
  source = 'import { COLLABORATION_MAX_ENCODED_UPDATE, COLLABORATION_CHUNK_CHARS } from "../../../../shared/collaborationWire"\n' + source;
  source = replace(source, "update.updateBinary.length > COLLAB_MAX_UPDATE_BYTES", "update.updateBinary.length > COLLABORATION_MAX_ENCODED_UPDATE");
  return replace(source, 'return update.updateBinary.length + update.idempotencyKey.length * 2 + 1024', 'return update.updateBinary.length + update.idempotencyKey.length * 2 + 1024 + Math.ceil(update.updateBinary.length / COLLABORATION_CHUNK_CHARS) * 256');
});

edit("cloudflare/worker/src/durableObjects/CollabRoom.ts", source => {
  source = 'import { RoomUpdateChunks, encodeStoredUpdate, readStoredUpdate, updateReceiptKey, type StoredSessionUpdate } from "./RoomUpdateChunks"\nimport { COLLABORATION_PROTOCOL_REVISION, requireProtocolRevision } from "../../../../shared/collaborationProtocol"\nimport { COLLABORATION_CHUNK_CHARS, collaborationDigest, splitCollaborationUpdate } from "../../../../shared/collaborationWire"\n' + source;
  source = replace(source, '  UpdatePushMessage,', '  UpdatePushMessage,\n  UpdateChunkMessage,');
  const startType = source.indexOf('interface StoredSessionUpdate {');
  const endType = source.indexOf("const UPDATE_PREFIX", startType);
  if (startType < 0 || endType < 0) throw new Error("Stored update anchor changed");
  source = source.slice(0, startType) + source.slice(endType);
  source = replace(source, '  private readonly checkpoints: RoomCheckpointStore', '  private readonly checkpoints: RoomCheckpointStore\n  private readonly updateChunks: RoomUpdateChunks');
  source = replace(source, '    this.checkpoints = new RoomCheckpointStore(state.storage)', '    this.checkpoints = new RoomCheckpointStore(state.storage)\n    this.updateChunks = new RoomUpdateChunks(state.storage)');
  source = replace(source, '      if (roomSessionId) {\n', '      if (roomSessionId) {\n        requireProtocolRevision(message.payload.collaborationRevision)\n');
  source = replace(source, '          headSeq,\n          mediaClientId:', '          headSeq,\n          ...(roomSessionId ? { collaborationRevision: COLLABORATION_PROTOCOL_REVISION } : {}),\n          mediaClientId:');
  source = replace(source, "if (connection.sessionId && message.type !== 'update.push')", "if (connection.sessionId && message.type !== 'update.push' && message.type !== 'update.chunk')");
  source = replace(source, "      case 'sync.request':\n        await this.handleSyncRequest(socket, connection, message)\n        return", String.raw`      case 'sync.request': {
        const operation = this.updateQueue.then(() => this.handleSyncRequest(socket, connection, message))
        this.updateQueue = operation.catch(() => undefined)
        await operation
        return
      }
      case 'update.chunk': {
        const operation = this.updateQueue.then(() => this.handleUpdateChunk(socket, connection, message))
        this.updateQueue = operation.catch(() => undefined)
        await operation
        return
      }`);
  source = replace(source, "        this.handleMediaState(socket, connection, message)\n        return\n    }", "        this.handleMediaState(socket, connection, message)\n        return\n      default: throw new CollaborationProtocolError('UNKNOWN_OPERATION', 'Unsupported room message')\n    }");
  const startSync = source.indexOf('      const toSeq = updates.at(-1)?.seq ?? message.payload.knownSeq');
  const endSync = source.indexOf('\n      return\n    }', startSync);
  if (startSync < 0 || endSync < 0) throw new Error("Replay anchor changed");
  source = source.slice(0, startSync) + String.raw`      const next = updates[0]
      if (next) await this.sendCanonicalUpdate(socket, connection.roomId, next.seq, headSeq, await readStoredUpdate(this.state.storage, next))
      else socket.send(stringifyMessage({ type: 'sync.delta', payload: { roomId: connection.roomId, fromSeq: known, toSeq: known, headSeq, hasMore: false, updatesBinary: [] } }))` + source.slice(endSync);
  source = replace(source, 'limit: 1, // Bounded legacy-sized replay until chunked replay is installed.', 'limit: 1, // One bounded update per page; large payloads use bounded chunk frames.');
  const startBroadcast = source.indexOf('    this.broadcast({\n      type: \'sync.delta\'', source.indexOf('  private async handleUpdatePush('));
  const endBroadcast = source.indexOf('\n  private async persistSessionUpdate(', startBroadcast);
  if (startBroadcast < 0 || endBroadcast < 0) throw new Error("Live broadcast anchor changed");
  source = source.slice(0, startBroadcast) + String.raw`    const headSeq = isV2Room(connection.roomId) ? await this.getSessionHeadSequence() : result.seq
    for (const peer of this.state.getWebSockets()) {
      if (peer === socket || attachmentOf(peer)?.roomId !== connection.roomId) continue
      try { await this.sendCanonicalUpdate(peer, connection.roomId, result.seq, headSeq, message.payload.updateBinary) }
      catch { try { peer.close(1011, 'Replay required') } catch { /* A closed peer cannot roll back a durable acknowledgement. */ } }
    }
  }

  private async sendCanonicalUpdate(socket: WebSocket, roomId: string, sequence: number, headSeq: number, encoded: string): Promise<void> {
    if (encoded.length > COLLABORATION_CHUNK_CHARS) {
      for (const chunk of await splitCollaborationUpdate(` + '`seq_${sequence}`' + String.raw`, encoded)) socket.send(stringifyMessage({ type: "sync.chunk", payload: { roomId, sequence, headSeq, chunk } }))
    } else socket.send(stringifyMessage({ type: "sync.delta", payload: { roomId, fromSeq: sequence - 1, toSeq: sequence, headSeq, hasMore: sequence < headSeq, updatesBinary: [encoded] } }))
  }

  private async handleUpdateChunk(socket: WebSocket, connection: SocketAttachment, message: UpdateChunkMessage): Promise<void> {
    if (!connection.sessionId) throw new CollaborationProtocolError("PROTOCOL_MISMATCH", "Chunked updates require an explicit live session", 409)
    const authority = await this.requireRoomAuthority(connection, true)
    const encoded = await this.updateChunks.accept(authority, message.payload.chunk, message.payload.timestamp)
    if (encoded === null) return
    await this.handleUpdatePush(socket, connection, { type: "update.push", payload: { roomId: connection.roomId,
      idempotencyKey: message.payload.chunk.id, updateBinary: encoded, timestamp: message.payload.timestamp, authorType: "user", authorId: connection.principalId } })
    await this.updateChunks.finish(authority, message.payload.chunk.id)
  }
` + source.slice(endBroadcast);
  source = replace(source, '    const idempotencyKey = `${IDEMPOTENCY_PREFIX}${message.payload.idempotencyKey}`', String.raw`    const receiptKey = updateReceiptKey(authority, message.payload.idempotencyKey)
    const digest = await collaborationDigest(message.payload.updateBinary)
    const accepted = await this.state.storage.get<{ sequence: number; digest: string }>(receiptKey)
    if (accepted) {
      if (accepted.digest !== digest) throw new CollaborationProtocolError("IDEMPOTENCY_MISMATCH", "An accepted update ID was reused with different bytes", 409)
      return { seq: accepted.sequence }
    }
    const idempotencyKey = ` + '`${IDEMPOTENCY_PREFIX}${message.payload.idempotencyKey}`');
  source = replace(source, '      if (!saved || saved.updateBinary !== message.payload.updateBinary)', '      if (!saved || await readStoredUpdate(this.state.storage, saved) !== message.payload.updateBinary)');
  source = replace(source, '    const stored: StoredSessionUpdate = {', '    const prepared = await encodeStoredUpdate({');
  source = replace(source, '      clientId: connection.clientId,\n      timestamp:', '      clientId: connection.clientId,\n      principalId: authority.principalId,\n      keyVersion: authority.keyVersion,\n      timestamp:');
  source = replace(source, '      retainedBytes,\n    }\n    await this.state.storage.put({', '      retainedBytes,\n    })\n    await this.state.storage.put({\n      ...prepared.pieces,\n      [receiptKey]: { sequence: seq, digest },');
  source = replace(source, '      [updateKey(seq)]: stored,', '      [updateKey(seq)]: prepared.update,');
  source = replace(source, 'update.retainedBytes ?? update.updateBinary.length + update.idempotencyKey.length * 2 + 1024', 'update.retainedBytes ?? (update.updateBinary?.length ?? update.totalChars ?? 0) + update.idempotencyKey.length * 2 + 1024');
  source = replace(source, '    const authority = await currentRoomAuthority(this.env, connection.identityKey, connection.sessionId)\n', '    const authority = await currentRoomAuthority(this.env, connection.identityKey, connection.sessionId)\n    if (connection.expiresAt <= Date.now() || await this.state.storage.get("g3:closed")) throw new CollaborationProtocolError("SESSION_EXPIRED", "Session stopped while authority was being refreshed", 401, true)\n');
  source = replace(source, '          await this.updateQueue\n          await this.state.storage.put("g3:closed", true)', '          const closing = this.updateQueue.then(() => this.state.storage.put("g3:closed", true))\n          this.updateQueue = closing.catch(() => undefined)\n          await closing');
  return source;
});

edit("shared/CollaborationTransport.ts", source => {
  source = 'import { COLLABORATION_PROTOCOL_REVISION, requireProtocolRevision } from "./collaborationProtocol"\n' + source;
  source = replace(source, '  private pendingUpdates = new Map<string, PendingUpdate>()', '  private pendingUpdates = new Map<string, PendingUpdate>()\n  private readonly remoteAcknowledgements = new Map<string, number>()');
  source = replace(source, '          protocolVersion: this.session.protocolVersion,', '          protocolVersion: this.session.protocolVersion,\n          ...(this.session.sessionId ? { collaborationRevision: COLLABORATION_PROTOCOL_REVISION } : {}),');
  source = replace(source, '    if (message.type === "ready") {', '    if (message.type === "ready") {\n      if (this.session.sessionId) requireProtocolRevision(payload.collaborationRevision)');
  source = replace(source, '      this.resolveReadyBarriers()\n      if (payload.hasMore', '      await this.retireCanonicalAcknowledgements()\n      this.resolveReadyBarriers()\n      if (payload.hasMore');
  source = replace(source, '        await this.outbox.acknowledge(id)\n        this.pendingUpdates.delete(id)\n        if (!this.pendingUpdates.size) for (const done of this.drainWaiters) done()', String.raw`        const sequence = finiteSequence(payload.seq)!
        const previous = this.remoteAcknowledgements.get(id)
        if (previous !== undefined && previous !== sequence) throw new Error("The room assigned two sequences to one update identity")
        this.remoteAcknowledgements.set(id, sequence)
        // A remote ACK is not a replacement for local recovery. Retire the
        // outbox only once onApplied has durably saved the contiguous echo.
        await this.retireCanonicalAcknowledgements()`);
  source = replace(source, '  private resolveReadyBarriers(): void {', String.raw`  private async retireCanonicalAcknowledgements(): Promise<void> {
    for (const [id, sequence] of this.remoteAcknowledgements) {
      if (sequence > this.knownSeq) continue
      await this.outbox.acknowledge(id)
      this.pendingUpdates.delete(id)
      this.remoteAcknowledgements.delete(id)
    }
    if (!this.pendingUpdates.size) for (const done of this.drainWaiters) done()
  }

  private resolveReadyBarriers(): void {`);
  source = replace(source, '      await this.sendUpdate(update)\n    }\n  }', '      if (!this.remoteAcknowledgements.has(update.idempotencyKey)) await this.sendUpdate(update)\n    }\n  }');
  source = replace(source, '    this.localPersistenceError = null\n    if (connect)', '    await this.retireCanonicalAcknowledgements()\n    this.localPersistenceError = null\n    if (connect)');
  return source;
});

edit("tests/collaboration/checkpointIntegration.test.ts", source => {
  source = replace(source, 'class MemoryStorage implements RoomStorage {', 'export class MemoryStorage implements RoomStorage {');
  return replace(source, '    if (typeof key === "string") this.data.set(key, structuredClone(value))', '    for (const item of typeof key === "string" ? [value] : Object.values(key)) if (JSON.stringify(item).length > 128 * 1024) throw new Error("KV value exceeds production 128 KiB bound")\n    if (typeof key === "string") this.data.set(key, structuredClone(value))');
});

// Tests are created in a separate source module to keep the candidate recipe
// reviewable. They use the actual provider and real room protocol over sockets.
const tests = readFileSync("scripts/collaboration/transport-tests.template", "utf8");
create("tests/collaboration/transportIntegration.test.ts", tests);
mkdirSync(".agent/collaboration-evidence", { recursive: true });
writeFileSync(".agent/collaboration-candidate.json", JSON.stringify({ message: "fix: persist bounded update chunks and retain local edits until canonical durability", paths: [...changed] }, null, 2));
console.log(`Prepared ${changed.size} transport transformations for real protocol validation.`);

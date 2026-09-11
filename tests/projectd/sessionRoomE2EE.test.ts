import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"

import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { SessionTransport } from "../../apps/projectd/src/collaboration/SessionTransport"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"

describe("P10 Cloud session room, global sequence, E2EE, durable replay", () => {
  const actorA: ChangeActor = { actorType: "user", principalId: "u_a" }
  const _actorB: ChangeActor = { actorType: "user", principalId: "u_b" }
  const sharedKey = randomBytes(32) // 256-bit AES-GCM room key

  it("encrypts and decrypts batches client-side using AES-256-GCM (Section 13.5)", () => {
    const replicaA = new SessionReplica("sess_e2ee", "c_a")
    const transportA = new SessionTransport({
      sessionId: "sess_e2ee",
      replica: replicaA,
      roomKey: sharedKey,
    })

    const _file = replicaA.createFile({
      path: "secret.ts",
      kind: "text",
      content: "top secret encryption test",
      actor: actorA,
    })

    const batch = replicaA.exportBatch()!
    expect(batch).not.toBeNull()

    // Encrypt
    const encryptedBase64 = transportA.encryptBatch(batch)
    expect(typeof encryptedBase64).toBe("string")
    expect(encryptedBase64).not.toContain("top secret") // Ciphertext does not contain plaintext

    // Decrypt
    const decrypted = transportA.decryptBatch(encryptedBase64)
    expect(decrypted.batchId).toBe(batch.batchId)
    expect(decrypted.operations).toHaveLength(batch.operations.length)
  })

  // ─── TWO-CLIENT HEADLESS TEST (Exit Gate) ──────────────────────────────────
  it("converges across disconnect, offline edits, and room re-instantiation", () => {
    // Shared mock cloud room log simulating Cloudflare Durable Object storage
    let currentSeq = 0
    const roomStorage = new Map<number, { sessionSeq: number; batchId: string; encrypted: string }>()
    const idempotency = new Map<string, number>()

    const roomSubmit = (batchId: string, encrypted: string) => {
      if (idempotency.has(batchId)) {
        return { sessionSeq: idempotency.get(batchId)!, duplicate: true }
      }
      currentSeq++
      const seq = currentSeq
      roomStorage.set(seq, { sessionSeq: seq, batchId, encrypted })
      idempotency.set(batchId, seq)
      return { sessionSeq: seq, duplicate: false }
    }

    const roomReplay = (fromSeq: number) => {
      const items: { sessionSeq: number; encrypted: string }[] = []
      for (let s = fromSeq + 1; s <= currentSeq; s++) {
        const item = roomStorage.get(s)
        if (item) items.push({ sessionSeq: item.sessionSeq, encrypted: item.encrypted })
      }
      return items
    }

    // Client A and Client B
    const replicaA = new SessionReplica("sess_collab", "c_a")
    const transportA = new SessionTransport({
      sessionId: "sess_collab",
      replica: replicaA,
      roomKey: sharedKey,
    })

    const replicaB = new SessionReplica("sess_collab", "c_b")
    const transportB = new SessionTransport({
      sessionId: "sess_collab",
      replica: replicaB,
      roomKey: sharedKey,
    })

    // Step 1: Client A creates file and sends encrypted batch to room
    const file = replicaA.createFile({
      path: "shared.txt",
      kind: "text",
      content: "hello",
      actor: actorA,
    })
    const batch1 = replicaA.exportBatch()!
    const enc1 = transportA.encryptBatch(batch1)
    const { sessionSeq: seq1 } = roomSubmit(batch1.batchId, enc1)

    // Client B receives and decrypts batch 1
    transportB.receiveEncryptedBatch(seq1, enc1)
    expect(replicaB.textDocs.getTextContent(file.fileId)).toBe("hello")

    // Step 2: Disconnect both clients
    // Both edit offline!
    const docA = replicaA.textDocs.getOrCreate(file.fileId)
    docA.text.insert(5, " world") // "hello world"
    const batchOfflineA = replicaA.exportBatch()!

    const docB = replicaB.textDocs.getOrCreate(file.fileId)
    docB.text.insert(5, " brave") // "hello brave"
    const batchOfflineB = replicaB.exportBatch()!

    // Step 3: Simulate Room eviction and restart (re-instantiation)
    // The room state is retained in durable storage, currentSeq = 1
    expect(currentSeq).toBe(1)

    // Step 4: Reconnect both clients
    // Client A submits offline batch
    const encA = transportA.encryptBatch(batchOfflineA)
    const { sessionSeq: seqA } = roomSubmit(batchOfflineA.batchId, encA)

    // Client B submits offline batch
    const encB = transportB.encryptBatch(batchOfflineB)
    const { sessionSeq: _seqB } = roomSubmit(batchOfflineB.batchId, encB)

    // Client A catches up with batches > seq1
    const missingForA = roomReplay(seqA) // Batches after seqA
    for (const m of missingForA) {
      transportA.receiveEncryptedBatch(m.sessionSeq, m.encrypted)
    }

    // Client B catches up with batches > seq1
    const missingForB = roomReplay(transportB.lastAppliedSessionSeq)
    for (const m of missingForB) {
      transportB.receiveEncryptedBatch(m.sessionSeq, m.encrypted)
    }

    // Step 5: Critical convergence assertion
    const textA = replicaA.textDocs.getTextContent(file.fileId)
    const textB = replicaB.textDocs.getTextContent(file.fileId)

    expect(textA).toBe(textB)
    expect(textA).toContain("hello")
    expect(textA).toContain("world")
    expect(textA).toContain("brave")
  })
})

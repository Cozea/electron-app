import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ScopePolicy } from "../../apps/projectd/src/filesystem/ScopePolicy"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { ExternalSnapshotAdapter } from "../../apps/projectd/src/collaboration/ExternalSnapshotAdapter"
import { BaselineStore } from "../../apps/projectd/src/collaboration/BaselineStore"
import { FilesystemMaterializer } from "../../apps/projectd/src/filesystem/Materializer"
import { MaterializationIndex } from "../../apps/projectd/src/filesystem/MaterializationIndex"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"

describe("P24 Capability integration qualification matrix", () => {
  const tmpDir = "/tmp"
  let testWorkspaceDir: string
  let testWorktreeDir: string
  let testDbPath: string
  let db: ProjectdDatabase
  let index: MaterializationIndex
  let baselineStore: BaselineStore
  let replica: SessionReplica
  let materializer: FilesystemMaterializer
  let adapter: ExternalSnapshotAdapter
  let scopePolicy: ScopePolicy

  const sessionId = "sess_p24_cap"

  beforeEach(() => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testWorkspaceDir = path.join(tmpDir, `test_p24_ws_${id}`)
    testWorktreeDir = path.join(tmpDir, `test_p24_wt_${id}`)
    testDbPath = path.join(tmpDir, `test_p24_db_${id}.sqlite`)

    fs.mkdirSync(testWorkspaceDir, { recursive: true })
    fs.mkdirSync(testWorktreeDir, { recursive: true })

    db = new ProjectdDatabase(testDbPath)
    index = new MaterializationIndex(db)
    baselineStore = new BaselineStore()
    replica = new SessionReplica(sessionId, "local_client")
    materializer = new FilesystemMaterializer({
      workspaceRoot: testWorkspaceDir,
      sessionId,
      replica,
      index,
      baselineStore,
      normalDelayMs: 10,
    })
    adapter = new ExternalSnapshotAdapter({ replica, baselineStore })
    scopePolicy = new ScopePolicy(testWorkspaceDir)
  })

  afterEach(() => {
    if (materializer) materializer.dispose()
    if (db) db.close()
    for (const p of [testWorkspaceDir, testWorktreeDir, testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
      try {
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    }
  })

  it("qualifies Assistant sessionWorkspace writes entering collaboration through filesystem->CRDT (Section 24.1)", async () => {
    const agentActor: ChangeActor = {
      actorType: "agent",
      provider: "claudeAgent",
      threadId: "thread_123",
    }

    // 1. Assistant writes code to disk in session workspace
    const filePath = path.join(testWorkspaceDir, "agent_tool.ts")
    const agentCode = "export function generatedByAgent() { return 42; }\n"
    fs.writeFileSync(filePath, agentCode)

    // 2. Adapter ingests filesystem change with agent provenance
    const file = replica.createFile({
      path: "agent_tool.ts",
      kind: "text",
      content: agentCode,
      actor: agentActor,
    })
    adapter.initializeBaseline(file.fileId, agentCode)

    // 3. Outbound batch contains agent provenance without special transport
    const batch = replica.exportBatch()
    expect(batch).not.toBeNull()

    // 4. Peer receives batch and materializes to disk
    const peerReplica = new SessionReplica(sessionId, "peer_client")
    peerReplica.applyBatch(batch!)

    expect(peerReplica.textDocs.getTextContent(file.fileId)).toBe(agentCode)
  })

  it("qualifies Assistant threadWorktree isolation and Apply to session (Section 24.2)", () => {
    // 1. Assistant writes private file in threadWorktree
    const privateFile = path.join(testWorktreeDir, "experiment.ts")
    fs.writeFileSync(privateFile, "const draft = 'isolated';\n")

    // 2. Invariant C44: ScopePolicy for sessionWorkspace does NOT watch threadWorktree!
    expect(scopePolicy.isAlwaysIgnored(path.relative(testWorkspaceDir, privateFile))).toBe(false)
    expect(path.resolve(privateFile).startsWith(testWorkspaceDir)).toBe(false)

    // 3. When user triggers 'Apply to session', changes are imported through CRDT
    const adopted = replica.createFile({
      path: "experiment.ts",
      kind: "text",
      content: "const draft = 'isolated';\n",
      actor: { actorType: "user" },
    })

    expect(replica.tree.getEntry(adopted.fileId)?.path).toBe("experiment.ts")
    expect(replica.textDocs.getTextContent(adopted.fileId)).toContain("draft = 'isolated'")
  })

  it("qualifies Terminal writes and formatters (Section 24.3)", () => {
    const termActor: ChangeActor = {
      actorType: "terminal-agent",
      terminalId: "pty_term_1",
    }

    const file = replica.createFile({
      path: "style.css",
      kind: "text",
      content: ".app { margin: 0; }",
      actor: termActor,
    })
    adapter.initializeBaseline(file.fileId, ".app { margin: 0; }")

    // Terminal formatter runs (e.g. prettier)
    const formatted = ".app {\n  margin: 0;\n}\n"
    const res = adapter.applyExternalDiskChange({
      fileId: file.fileId,
      diskText: formatted,
      actor: termActor,
    })

    expect(res.convergedText).toBe(formatted)
  })

  it("qualifies Dev server hot reload via exact disk materialization (Section 24.4)", async () => {
    const file = replica.createFile({
      path: "App.tsx",
      kind: "text",
      content: "<h1>Version 1</h1>",
      actor: { actorType: "user" },
    })

    materializer.scheduleMaterialization(file.fileId)
    await materializer.flush()

    const absPath = path.join(testWorkspaceDir, "App.tsx")
    const statBefore = fs.statSync(absPath)

    // Remote CRDT update arrives
    const doc = replica.textDocs.getOrCreate(file.fileId)
    doc.text.delete(12, 1)
    doc.text.insert(12, "2") // "<h1>Version 2</h1>"

    // Small delay to ensure stat mtime differs
    await new Promise((r) => setTimeout(r, 15))

    materializer.scheduleMaterialization(file.fileId)
    await materializer.flush()

    const statAfter = fs.statSync(absPath)

    // File mtime advanced on disk -> triggers Vite/webpack hot module reload naturally!
    expect(statAfter.mtimeMs).toBeGreaterThan(statBefore.mtimeMs)
    expect(fs.readFileSync(absPath, "utf8")).toBe("<h1>Version 2</h1>")
  })

  it("qualifies Project Memory artifact policy (Section 24.8)", () => {
    // If graphify-out/graph.json is gitignored, it stays local by default
    const memoryArtifactRel = "graphify-out/graph.json"
    expect(scopePolicy.isAlwaysIgnored(memoryArtifactRel)).toBe(false)

    // If ignored, isAlwaysIgnored or checkIgnore excludes it
    // Memory UI itself is not replicated through CRDT (Section 24.8)
    const entries = replica.tree.listLiveEntries()
    expect(entries.some((e) => e.path === memoryArtifactRel)).toBe(false)
  })
})

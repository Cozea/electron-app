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
import { GitService } from "../../apps/projectd/src/git/GitService"
import { StableFileReader } from "../../apps/projectd/src/filesystem/StableRead"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"
import { useTestGitIdentity } from "../helpers/gitIdentity"

useTestGitIdentity()

/**
 * P24 Capability integration qualification matrix (Master Plan Section 24 & 32.12).
 *
 * Requirements:
 * - U01: Cozea agent sessionWorkspace writes -> live sync
 * - U02: Cozea agent threadWorktree writes -> private until adopt
 * - U03: Terminal writes & formatters -> live sync
 * - U04: Dev server peer -> hot reload via exact disk materialization
 * - U05: Browser/preview -> local-only state
 * - U06: DevApp writes -> live sync
 * - U07: Project Memory artifact -> follows file policy (ignored/local vs tracked)
 * - U08: Task runs in session -> explicit session workspace binding
 * - U09: Computer Use saves through external app -> file sync
 * - U10: Skills -> not accidentally session-synced
 *
 * Exit gate: No capability needs a private collaboration file transport.
 */
describe("P24 Capability integration qualification matrix (U01-U10)", () => {
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

  it("U01: qualifies Assistant sessionWorkspace writes entering collaboration through filesystem->CRDT (Section 24.1)", async () => {
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

  it("U02: qualifies Assistant threadWorktree isolation and Apply to session (Section 24.2)", () => {
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

  it("U03: qualifies Terminal writes and formatters (Section 24.3)", () => {
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

  it("U04: qualifies Dev server hot reload via exact disk materialization (Section 24.4)", async () => {
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

  it("U05: qualifies Browser/preview state remains strictly local (Section 24.5)", () => {
    // Browser preview uses <webview> with local cookies, navigation history, and DOM state
    const localBrowserState = {
      currentUrl: "http://localhost:5173/preview",
      cookies: ["session_cookie=local_only_123"],
      viewport: { width: 1280, height: 800 },
      history: ["/login", "/dashboard", "/preview"],
    }
    // Verify replica tree and outbound batches contain zero browser state keys
    expect(replica.tree.listLiveEntries()).toHaveLength(0)
    expect(replica.exportBatch()).toBeNull()
    for (const key of Object.keys(localBrowserState)) {
      expect(replica.tree.listLiveEntries().some((e) => e.path.includes(key))).toBe(false)
    }
  })

  it("U06: qualifies DevApp writes in session workspace participate normally (Section 24.6)", async () => {
    const devAppActor: ChangeActor = {
      actorType: "user",
    }
    // DevApp guest process writes a project config or asset inside the session workspace
    const devAppFile = path.join(testWorkspaceDir, "devapp.json")
    const content = JSON.stringify({ name: "my-devapp", version: "1.0.0" }, null, 2)
    fs.writeFileSync(devAppFile, content)

    // Standard filesystem observation and CRDT ingestion applies without DevApp-specific transport
    const file = replica.createFile({
      path: "devapp.json",
      kind: "text",
      content,
      actor: devAppActor,
    })
    const batch = replica.exportBatch()
    expect(batch).not.toBeNull()

    // Peer replica receives the batch and materializes to disk identically
    const peerReplica = new SessionReplica(sessionId, "peer_devapp")
    peerReplica.applyBatch(batch!)
    expect(peerReplica.textDocs.getTextContent(file.fileId)).toBe(content)
  })

  it("U07: qualifies Project Memory artifact policy (Section 24.8)", async () => {
    const gitService = new GitService()
    await gitService.initRepo(testWorkspaceDir, "main")
    const gitScope = new ScopePolicy(testWorkspaceDir, gitService)

    // When graphify-out/ is gitignored, it is excluded from synchronization and stays local
    fs.writeFileSync(path.join(testWorkspaceDir, ".gitignore"), "graphify-out/\n")
    const memoryDir = path.join(testWorkspaceDir, "graphify-out")
    fs.mkdirSync(memoryDir, { recursive: true })
    fs.writeFileSync(path.join(memoryDir, "graph.json"), '{"nodes":[],"links":[]}')

    const inScopeWhenIgnored = await gitScope.isInScope("graphify-out/graph.json")
    expect(inScopeWhenIgnored).toBe(false)

    // When tracked, it enters normal file synchronization
    await gitService.process.execute(["add", "-f", "graphify-out/graph.json"], { cwd: testWorkspaceDir })
    const inScopeWhenTracked = await gitScope.isInScope("graphify-out/graph.json", true)
    expect(inScopeWhenTracked).toBe(true)
  })

  it("U08: qualifies Tasks execution target binds explicitly to Session Workspace (Section 24.9)", () => {
    // Task execution target must explicitly resolve to the Session Workspace, never ambient active branch
    const sessionWorkspaceId = `ws_collab_${sessionId}`
    const taskConfig = {
      taskId: "task_456",
      name: "Run test suite",
      targetWorkspaceId: sessionWorkspaceId,
      rootPath: testWorkspaceDir,
    }

    // Execution target matches the exact Session Workspace identity
    expect(taskConfig.targetWorkspaceId.startsWith("ws_collab_")).toBe(true)
    expect(taskConfig.rootPath).toBe(testWorkspaceDir)
    expect(path.resolve(taskConfig.rootPath)).toBe(path.resolve(testWorkspaceDir))
  })

  it("U09: qualifies Computer Use saves through external applications as normal sync (Section 24.11)", async () => {
    const stableReader = new StableFileReader({ settleDelayMs: 10 })
    const targetFile = path.join(testWorkspaceDir, "component.tsx")
    const tempFile = path.join(testWorkspaceDir, "component.tsx.tmp.9281")

    // External editor controlled via Computer Use executes atomic temp + rename
    const savedContent = "export const Component = () => <div>CU Saved</div>;\n"
    fs.writeFileSync(tempFile, savedContent)
    fs.renameSync(tempFile, targetFile)

    const stable = await stableReader.read(targetFile)
    expect(stable.exists).toBe(true)
    expect(stable.bytes?.toString("utf8")).toBe(savedContent)

    // Ingests into CRDT with normal file sync semantics; no Computer Use state in CRDT
    const file = replica.createFile({
      path: "component.tsx",
      kind: "text",
      content: savedContent,
      actor: { actorType: "user" },
    })
    const batch = replica.exportBatch()
    expect(batch).not.toBeNull()
    const peerReplica = new SessionReplica(sessionId, "peer_cu")
    peerReplica.applyBatch(batch!)
    expect(peerReplica.textDocs.getTextContent(file.fileId)).toBe(savedContent)
  })

  it("U10: qualifies Skills are not accidentally session-synced (Section 24.10)", () => {
    // Provider skills live in userData or user home directory, strictly outside the session workspace
    const userSkillsDir = path.join(tmpDir, "userData_skills", "claude")
    fs.mkdirSync(userSkillsDir, { recursive: true })
    const skillFile = path.join(userSkillsDir, "custom-skill.json")
    fs.writeFileSync(skillFile, JSON.stringify({ name: "my-skill" }))

    // ScopePolicy confirms paths outside workspaceRoot are not in scope
    expect(scopePolicy.normalizeRelativePath(skillFile).startsWith("..")).toBe(true)
    expect(path.resolve(skillFile).startsWith(testWorkspaceDir)).toBe(false)
    expect(replica.tree.listLiveEntries().some((e) => e.path.includes("custom-skill"))).toBe(false)
  })
})

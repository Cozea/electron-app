import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ScopePolicy } from "../../apps/projectd/src/filesystem/ScopePolicy"
import { StableFileReader } from "../../apps/projectd/src/filesystem/StableRead"
import { MaterializationIndex } from "../../apps/projectd/src/filesystem/MaterializationIndex"
import { WorkspaceScanner } from "../../apps/projectd/src/filesystem/Scanner"
import {
  WorkspaceFilesystemWatcher,
  type NormalizedFsEvent,
} from "../../apps/projectd/src/filesystem/WorkspaceFilesystemWatcher"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { GitService } from "../../apps/projectd/src/git/GitService"

describe("P06 native FSEvents + scanner/materialization index", () => {
  const tmpDir = "/tmp"
  let testWorkspaceDir: string
  let testDbPath: string
  let db: ProjectdDatabase
  let index: MaterializationIndex
  let scopePolicy: ScopePolicy
  let gitService: GitService

  const sessionId = "sess_fsevents_test"

  beforeEach(async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testWorkspaceDir = path.join(tmpDir, `test_fs_${id}`)
    testDbPath = path.join(tmpDir, `test_fs_db_${id}.sqlite`)

    fs.mkdirSync(testWorkspaceDir, { recursive: true })

    gitService = new GitService()
    await gitService.initRepo(testWorkspaceDir, "main")

    db = new ProjectdDatabase(testDbPath)
    index = new MaterializationIndex(db)
    scopePolicy = new ScopePolicy(testWorkspaceDir, gitService)
  })

  afterEach(() => {
    if (db) {
      db.close()
    }
    for (const p of [testWorkspaceDir, testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
      try {
        if (fs.existsSync(p)) {
          fs.rmSync(p, { recursive: true, force: true })
        }
      } catch {
        // Ignore
      }
    }
  })

  it("handles VS Code atomic save fixture (temp file + rename)", async () => {
    const stableReader = new StableFileReader({ settleDelayMs: 10 })
    const targetPath = path.join(testWorkspaceDir, "index.ts")
    const tempPath = path.join(testWorkspaceDir, "index.ts.tmp.82918")

    // Write temp file then rename
    fs.writeFileSync(tempPath, "console.log('atomic save')")
    fs.renameSync(tempPath, targetPath)

    const stable = await stableReader.read(targetPath)
    expect(stable.exists).toBe(true)
    expect(stable.bytes?.toString("utf8")).toBe("console.log('atomic save')")
    expect(stable.contentHash).toBeDefined()
  })

  it("filters Vim transient swap and probe files via ScopePolicy", () => {
    expect(scopePolicy.isAlwaysIgnored(".main.ts.swp")).toBe(true)
    expect(scopePolicy.isAlwaysIgnored(".main.ts.swo")).toBe(true)
    expect(scopePolicy.isAlwaysIgnored("main.ts~")).toBe(true)
    expect(scopePolicy.isAlwaysIgnored(".#main.ts")).toBe(true)
    expect(scopePolicy.isAlwaysIgnored("main.ts.tmp.123")).toBe(true)
    expect(scopePolicy.isAlwaysIgnored("main.ts")).toBe(false)
  })

  it("preserves tracked dist/build/vendor files regardless of folder name (Invariant C39)", async () => {
    const buildDir = path.join(testWorkspaceDir, "build")
    fs.mkdirSync(buildDir, { recursive: true })
    const bundlePath = path.join(buildDir, "bundle.js")
    fs.writeFileSync(bundlePath, "export const app = 1;")

    // Invariant C39: If tracked hint is true, tracked file is ALWAYS in scope
    const inScope = await scopePolicy.isInScope("build/bundle.js", true)
    expect(inScope).toBe(true)
    expect(scopePolicy.isAdmitted("build/bundle.js")).toBe(true)
  })

  it("excludes untracked git-ignored files by default (Invariant C40)", async () => {
    fs.writeFileSync(path.join(testWorkspaceDir, ".gitignore"), ".env*\n*.secret\n")

    fs.writeFileSync(path.join(testWorkspaceDir, ".env.local"), "SECRET=abc")
    fs.writeFileSync(path.join(testWorkspaceDir, "app.secret"), "classified")
    fs.writeFileSync(path.join(testWorkspaceDir, "app.ts"), "export {}")

    expect(await scopePolicy.isInScope(".env.local")).toBe(false)
    expect(await scopePolicy.isInScope("app.secret")).toBe(false)
    expect(await scopePolicy.isInScope("app.ts")).toBe(true)
  })

  it("maintains sticky membership once admitted (Invariant C41)", async () => {
    scopePolicy.admit("config.local.json")
    expect(scopePolicy.isAdmitted("config.local.json")).toBe(true)

    // Even if added to gitignore later, admitted file remains in scope
    fs.writeFileSync(path.join(testWorkspaceDir, ".gitignore"), "config.local.json\n")
    expect(await scopePolicy.isInScope("config.local.json")).toBe(true)
  })

  it("enforces hash-based echo suppression without timers (Invariant C14 / Section 12.7)", async () => {
    const filePath = path.join(testWorkspaceDir, "doc.txt")
    fs.writeFileSync(filePath, "version 1")

    const reader = new StableFileReader({ settleDelayMs: 0 })
    const stable1 = await reader.read(filePath)

    // Record materialization in index
    index.recordMaterialization({
      sessionId,
      fileId: "file_doc",
      relativePath: "doc.txt",
      kind: "text",
      mode: 0o100644,
      diskHash: stable1.contentHash!,
      diskSize: stable1.size!,
      diskMtimeMs: stable1.mtimeMs!,
      state: "materialized",
    })

    // 1. When reading stable1 content hash -> isEcho is true (Suppressed!)
    expect(index.isEcho(sessionId, "doc.txt", stable1.contentHash!)).toBe(true)

    // 2. Writer modifies immediately with new content -> isEcho is false (Genuine local edit!)
    fs.writeFileSync(filePath, "version 2 with immediate edit")
    const stable2 = await reader.read(filePath)

    expect(stable2.contentHash).not.toBe(stable1.contentHash)
    expect(index.isEcho(sessionId, "doc.txt", stable2.contentHash!)).toBe(false)
  })

  it("detects path collisions when multiple fileIds claim one normalized path (Invariant C18)", () => {
    index.recordMaterialization({
      sessionId,
      fileId: "file_1",
      relativePath: "src/App.tsx",
      kind: "text",
      mode: 0o100644,
      diskHash: "hash1",
      diskSize: 100,
      diskMtimeMs: 1000,
      state: "materialized",
    })

    // Second file claims same normalized path
    index.recordMaterialization({
      sessionId,
      fileId: "file_2",
      relativePath: "src/App.tsx",
      kind: "text",
      mode: 0o100644,
      diskHash: "hash2",
      diskSize: 100,
      diskMtimeMs: 1000,
      state: "materialized",
    })

    const entry1 = index.getByFileId(sessionId, "file_1")
    const entry2 = index.getByFileId(sessionId, "file_2")

    // Both files are preserved without silent overwrite
    expect(entry1).not.toBeNull()
    expect(entry2).not.toBeNull()
    expect(entry1?.fileId).toBe("file_1")
    expect(entry2?.fileId).toBe("file_2")
  })

  it("reconstructs exact filesystem state after daemon downtime / restart (Exit Gate)", async () => {
    // 1. Initial state: 2 files materialized in index
    fs.writeFileSync(path.join(testWorkspaceDir, "file_a.txt"), "content A")
    fs.writeFileSync(path.join(testWorkspaceDir, "file_b.txt"), "content B initial")

    const reader = new StableFileReader({ settleDelayMs: 0 })
    const readA = await reader.read(path.join(testWorkspaceDir, "file_a.txt"))
    const readB = await reader.read(path.join(testWorkspaceDir, "file_b.txt"))

    index.recordMaterialization({
      sessionId,
      fileId: "fa",
      relativePath: "file_a.txt",
      kind: "text",
      mode: 0o100644,
      diskHash: readA.contentHash!,
      diskSize: readA.size!,
      diskMtimeMs: readA.mtimeMs!,
      state: "materialized",
    })
    index.recordMaterialization({
      sessionId,
      fileId: "fb",
      relativePath: "file_b.txt",
      kind: "text",
      mode: 0o100644,
      diskHash: readB.contentHash!,
      diskSize: readB.size!,
      diskMtimeMs: readB.mtimeMs!,
      state: "materialized",
    })

    // 2. Simulate offline modifications while daemon was down:
    // - file_a.txt is deleted
    // - file_b.txt is modified
    // - file_c.txt is created
    fs.rmSync(path.join(testWorkspaceDir, "file_a.txt"))
    fs.writeFileSync(path.join(testWorkspaceDir, "file_b.txt"), "content B modified offline")
    fs.writeFileSync(path.join(testWorkspaceDir, "file_c.txt"), "content C created offline")

    // 3. Scanner runs on startup
    const scanner = new WorkspaceScanner(testWorkspaceDir, scopePolicy, reader)
    const diff = await scanner.diffAgainstIndex(sessionId, index)

    expect(diff.created).toHaveLength(1)
    expect(diff.created[0].relativePath).toBe("file_c.txt")

    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].relativePath).toBe("file_b.txt")

    expect(diff.deleted).toHaveLength(1)
    expect(diff.deleted[0].relativePath).toBe("file_a.txt")
    expect(diff.deleted[0].fileId).toBe("fa")
  })

  it("handles 500-file format burst with bounded scanner performance", async () => {
    const burstDir = path.join(testWorkspaceDir, "burst")
    fs.mkdirSync(burstDir, { recursive: true })

    const count = 500
    for (let i = 0; i < count; i++) {
      fs.writeFileSync(path.join(burstDir, `file_${i}.ts`), `export const v = ${i};`)
    }

    const reader = new StableFileReader({ settleDelayMs: 0 })
    const scanner = new WorkspaceScanner(testWorkspaceDir, scopePolicy, reader)

    const startTime = Date.now()
    const scanned = await scanner.scanTree()
    const elapsedMs = Date.now() - startTime

    expect(scanned.length).toBeGreaterThanOrEqual(count)
    expect(elapsedMs).toBeLessThan(5000) // Fast 500-file tree scan under 5 seconds
  })

  it.skipIf(process.platform !== "darwin")("orchestrates startup buffering and emits normalized events", async () => {
    // Write initial test file
    fs.writeFileSync(path.join(testWorkspaceDir, "hello.txt"), "hello world")

    const events: NormalizedFsEvent[] = []
    const watcher = new WorkspaceFilesystemWatcher({
      workspaceRoot: testWorkspaceDir,
      sessionId,
      scopePolicy,
      index,
    })

    watcher.on("event", (evt) => {
      events.push(evt)
    })

    // Start watcher (Section 12.3: buffers hints, full scans, reconciles offline state, transitions to ready)
    await watcher.start()
    expect(watcher.state).toBe("ready")

    // The initial file not in index should have been emitted as offline creation
    expect(events.some((e) => e.type === "change" && e.relativePath === "hello.txt")).toBe(true)

    watcher.stop()
    expect(watcher.state).toBe("stopped")
  })
})

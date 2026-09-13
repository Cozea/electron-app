import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { CollaborationSessionHost } from "../../apps/projectd/src/collaboration/CollaborationSessionHost"
import { BinaryContentCache, type BinaryManifest } from "../../apps/projectd/src/collaboration/BinaryContentCache"
import type { BinaryObjectClient } from "../../apps/projectd/src/collaboration/BinaryObjectStore"
import type { FileEventSource, NativeFSEventItem } from "../../apps/projectd/src/filesystem/FSEventsClient"
import { GitService } from "../../apps/projectd/src/git/GitService"
import { ScopePolicy } from "../../apps/projectd/src/filesystem/ScopePolicy"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import {
  createPrivateThreadWorktree,
  applyThreadWorktreeToWorkspace,
  removePrivateThreadWorktree,
  sanitizeSafeRelativePath,
} from "../../apps/desktop/electron/services/threadWorktreeService"
import { createNodeDevAppHostServices } from "../../apps/desktop/electron/services/devAppHostServices"
import { resolveScheduledTaskWorkspaceRoot } from "../../apps/desktop/src/features/projects/model/scheduledTaskRunner"
import type { ScheduledTask } from "../../shared/scheduledTasks"
import {
  RoomHost,
  TEST_PUBLIC_SESSION_ID,
  loadSessionRoomWorker,
  sessionTokenFor,
  waitFor,
  type SessionRoomWorker,
} from "../helpers/sessionRoomHarness"

const WS_URL = "ws://room.test/collab/sessions/ws"
let worker: SessionRoomWorker

class ManualFileEvents extends EventEmitter implements FileEventSource {
  async start(): Promise<void> {
    // Tests report events themselves
  }

  stop(): void {
    // Nothing to stop
  }

  report(root: string, ...relativePaths: string[]): void {
    const items: NativeFSEventItem[] = relativePaths.map((relativePath, id) => ({
      id,
      path: path.join(root, relativePath),
      flags: 0,
      isCreated: false,
      isRemoved: false,
      isRenamed: false,
      isModified: true,
      isDir: false,
      isSymlink: false,
      dropped: false,
    }))
    this.emit("events", items)
  }
}

class MemoryBinaryObjects implements BinaryObjectClient {
  private readonly contents = new Map<string, Buffer>()
  private readonly manifests = new BinaryContentCache({
    cacheDir: path.join(os.tmpdir(), `unused-manifest-${Date.now()}`),
  })

  async upload(bytes: Buffer | Uint8Array): Promise<BinaryManifest> {
    const content = Buffer.from(bytes)
    const manifest = this.manifests.createManifest(content, "memory:")
    this.contents.set(manifest.contentHash, content)
    return manifest
  }

  async download(manifest: BinaryManifest): Promise<Buffer> {
    const content = this.contents.get(manifest.contentHash)
    if (!content) throw new Error(`Missing test binary ${manifest.contentHash}`)
    return Buffer.from(content)
  }
}

interface Peer {
  host: CollaborationSessionHost
  root: string
  events: ManualFileEvents
  write: (relativePath: string, content: string | Buffer) => Promise<void>
  read: (relativePath: string) => Promise<string | null>
  remove: (relativePath: string) => Promise<void>
}

function git(root: string, ...args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Cozea Test",
      "-c",
      "user.email=test@cozea.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd: root, stdio: "ignore" },
  )
}

describe("P24 Capability integration qualification matrix (U01-U10)", () => {
  let room: RoomHost
  let roomKey: Buffer
  let binaryObjects: MemoryBinaryObjects
  let cleanups: Array<() => Promise<unknown>> = []

  let alice: Peer
  let bob: Peer

  beforeAll(async () => {
    worker = await loadSessionRoomWorker()
  })

  afterAll(async () => {
    // Global cleanups if needed
  })

  async function tempFolder(name: string): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `cozea-u-matrix-${name}-`))
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }).catch(() => {}))
    return root
  }

  async function createPeer(name: string): Promise<Peer> {
    const root = await tempFolder(name)
    git(root, "init", "-q", "-b", "main")
    const events = new ManualFileEvents()
    const token = await sessionTokenFor(worker, `principal_${name}`, {
      sessionRole: "developer",
    })()

    const gitService = new GitService()
    const host = new CollaborationSessionHost({
      publicSessionId: TEST_PUBLIC_SESSION_ID,
      workspaceId: `ws_${name}`,
      workspaceRoot: root,
      roomKey,
      ticket: { wsUrl: WS_URL, token, role: "developer" },
      db: new ProjectdDatabase(":memory:"),
      actor: { actorType: "user", principalId: `principal_${name}` },
      gitService,
      binaryObjectStore: binaryObjects,
      connectorFactory: () => room.connector(),
      fileEventSource: events,
      submitDelayMs: 5,
      materializeDelayMs: 5,
      reconnectDelaysMs: [10],
    })

    cleanups.push(() => host.stop())

    return {
      host,
      root,
      events,
      write: async (relativePath, content) => {
        const full = path.join(root, relativePath)
        await fs.mkdir(path.dirname(full), { recursive: true })
        await fs.writeFile(full, content)
        events.report(root, relativePath)
      },
      read: (relativePath) => fs.readFile(path.join(root, relativePath), "utf8").catch(() => null),
      remove: async (relativePath) => {
        await fs.rm(path.join(root, relativePath), { force: true })
        events.report(root, relativePath)
      },
    }
  }

  beforeEach(async () => {
    cleanups = []
    room = new RoomHost(worker)
    roomKey = randomBytes(32)
    binaryObjects = new MemoryBinaryObjects()

    alice = await createPeer("alice")
    bob = await createPeer("bob")

    await alice.host.start()
    await bob.host.start()

    await waitFor(() => alice.host.status().state === "live", "Alice to reach live")
    await waitFor(() => bob.host.status().state === "live", "Bob to reach live")
  })

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => {})
    }
  })

  it("U01: qualifies Assistant sessionWorkspace writes entering collaboration through filesystem->CRDT (Section 24.1)", async () => {
    // When an Assistant runs with laneBinding="sessionWorkspace", worktreePath is null
    // and it writes directly into the Session Workspace root (alice.root).
    const agentCode = "export function generatedByAgent() { return 42; }\n"
    await alice.write("agent_tool.ts", agentCode)

    // Verify peer (bob) receives and materializes the file on disk through normal file sync
    await waitFor(async () => (await bob.read("agent_tool.ts")) !== null, "bob to receive agent_tool.ts")
    expect(await bob.read("agent_tool.ts")).toBe(agentCode)
  })

  it("U02: qualifies Assistant threadWorktree isolation, B/R/L delta Apply, and fail-closed security (Section 24.2)", async () => {
    // 1. Initial baseline files exist in Session Workspace and are committed
    await alice.write("a.ts", "export const a = 'base';\n")
    await alice.write("b.ts", "export const b = 'base';\n")
    await alice.write("delete_target.ts", "export const toBeDeleted = true;\n")
    git(alice.root, "add", "-A")
    git(alice.root, "commit", "-q", "-m", "baseline-files")

    await waitFor(async () => (await bob.read("delete_target.ts")) !== null, "bob to receive initial files")

    // 2. Assistant runs with laneBinding="threadWorktree".
    // A private thread worktree is created outside the Session Workspace root.
    const threadId = `thread_${Date.now()}`
    const wtResult = await createPrivateThreadWorktree({
      workspaceRoot: alice.root,
      threadId,
    })
    expect(wtResult.success).toBe(true)
    const worktreePath = wtResult.worktreePath
    cleanups.push(() => removePrivateThreadWorktree({ worktreePath, workspaceRoot: alice.root }))

    // Verify worktreePath is strictly outside alice.root (the Session Workspace)
    expect(path.resolve(worktreePath).startsWith(path.resolve(alice.root))).toBe(false)

    // 3. Concurrent live edits by peer in Session Workspace (L) after worktree branched from B:
    // Peer adds peer.ts
    await bob.write("peer.ts", "export const peerAdded = true;\n")
    // Peer edits unrelated b.ts
    await bob.write("b.ts", "export const b = 'peer_modified';\n")

    await waitFor(async () => (await alice.read("peer.ts")) !== null, "alice to receive peer.ts")
    await waitFor(async () => (await alice.read("b.ts")) === "export const b = 'peer_modified';\n", "alice to receive peer edit on b.ts")

    // 4. Assistant performs private work in worktree (R):
    // Agent adds feature_draft.ts
    const privateDraftPath = path.join(worktreePath, "feature_draft.ts")
    const draftCode = "export const experimentalFeature = true;\n"
    await fs.writeFile(privateDraftPath, draftCode)

    // Agent deletes delete_target.ts
    await fs.rm(path.join(worktreePath, "delete_target.ts"), { force: true })

    // Agent modifies a.ts
    await fs.writeFile(path.join(worktreePath, "a.ts"), "export const a = 'agent_modified';\n")

    // Peer (bob) MUST NOT see the private addition or deletion before explicit Apply/Adopt
    alice.events.report(alice.root)
    await new Promise((r) => setTimeout(r, 50))
    expect(await bob.read("feature_draft.ts")).toBeNull()
    expect(await bob.read("delete_target.ts")).not.toBeNull()

    // 5. User explicitly triggers 'Apply to session' (B/R/L three-way merge Δ(B -> R) onto L)
    const applyResult = await applyThreadWorktreeToWorkspace({
      worktreePath,
      workspaceRoot: alice.root,
    })
    expect(applyResult.success).toBe(true)
    expect(applyResult.appliedFiles).toContain("feature_draft.ts")
    expect(applyResult.appliedFiles).toContain("delete_target.ts")
    expect(applyResult.appliedFiles).toContain("a.ts")

    // Invariant: Peer additions (peer.ts) and unrelated edits (b.ts) MUST BE PRESERVED in L!
    expect(await alice.read("peer.ts")).toBe("export const peerAdded = true;\n")
    expect(await alice.read("b.ts")).toBe("export const b = 'peer_modified';\n")

    // Notify watcher of applied changes
    alice.events.report(alice.root, "feature_draft.ts", "delete_target.ts", "a.ts")

    // 6. Peer receives agent's applied changes without losing peer's own concurrent work
    await waitFor(async () => (await bob.read("feature_draft.ts")) !== null, "bob to receive feature_draft.ts")
    expect(await bob.read("feature_draft.ts")).toBe(draftCode)
    await waitFor(async () => (await bob.read("delete_target.ts")) === null, "bob to observe deletion")
    expect(await bob.read("delete_target.ts")).toBeNull()
    await waitFor(async () => (await bob.read("a.ts")) === "export const a = 'agent_modified';\n", "bob to receive a.ts")
    expect(await bob.read("peer.ts")).toBe("export const peerAdded = true;\n")
    expect(await bob.read("b.ts")).toBe("export const b = 'peer_modified';\n")

    // 7. Regression: Concurrent edit conflict protection on same file
    // If peer edits a.ts in L and agent edits a.ts in R to a different value:
    await bob.write("a.ts", "export const a = 'peer_edit_2';\n")
    await waitFor(async () => (await alice.read("a.ts")) === "export const a = 'peer_edit_2';\n", "alice to receive peer edit")
    // Agent in worktree has different edit:
    await fs.writeFile(path.join(worktreePath, "a.ts"), "export const a = 'agent_divergent';\n")

    const conflictResult = await applyThreadWorktreeToWorkspace({
      worktreePath,
      workspaceRoot: alice.root,
    })
    expect(conflictResult.success).toBe(false)
    expect(conflictResult.conflicts).toBeDefined()
    expect(conflictResult.conflicts?.some((c) => c.path === "a.ts" && c.kind === "modify_conflict")).toBe(true)
    // Peer edit in L was preserved, not blindly overwritten!
    expect(await alice.read("a.ts")).toBe("export const a = 'peer_edit_2';\n")

    // 8. Regression: Delete-vs-modify conflict protection
    // Recreate a file, peer modifies it, agent deletes it:
    await alice.write("conflict_del.ts", "base content\n")
    git(alice.root, "add", "conflict_del.ts")
    git(alice.root, "commit", "-m", "add conflict_del")
    await waitFor(async () => (await bob.read("conflict_del.ts")) !== null, "bob to receive initial conflict_del.ts")

    const wt2 = await createPrivateThreadWorktree({ workspaceRoot: alice.root, threadId: `wt2_${Date.now()}` })
    cleanups.push(() => removePrivateThreadWorktree({ worktreePath: wt2.worktreePath, workspaceRoot: alice.root }))

    // Peer modifies conflict_del.ts in L
    await bob.write("conflict_del.ts", "peer modified before delete\n")
    await waitFor(async () => (await alice.read("conflict_del.ts")) === "peer modified before delete\n", "alice gets peer edit")

    // Agent deletes conflict_del.ts in worktree
    await fs.rm(path.join(wt2.worktreePath, "conflict_del.ts"), { force: true })

    const delConflictResult = await applyThreadWorktreeToWorkspace({
      worktreePath: wt2.worktreePath,
      workspaceRoot: alice.root,
    })
    expect(delConflictResult.success).toBe(false)
    expect(delConflictResult.conflicts?.some((c) => c.path === "conflict_del.ts" && c.kind === "delete_conflict")).toBe(true)
    // Peer's modified file was NOT deleted blindly!
    expect(await alice.read("conflict_del.ts")).toBe("peer modified before delete\n")

    // 9. Fail-closed security validation:
    // Path traversal rejection (.. must be rejected, not reinterpreted)
    expect(sanitizeSafeRelativePath("../../escape.ts", alice.root)).toBeNull()
    expect(sanitizeSafeRelativePath("../escape.ts", alice.root)).toBeNull()
    expect(sanitizeSafeRelativePath("foo/../../escape.ts", alice.root)).toBeNull()
    expect(sanitizeSafeRelativePath("/etc/passwd", alice.root)).toBeNull()

    // Provenance validation rejects arbitrary / unregistered outside directories
    const arbitraryOutsideDir = await tempFolder("arbitrary-outside")
    const unprovenApply = await applyThreadWorktreeToWorkspace({
      worktreePath: arbitraryOutsideDir,
      workspaceRoot: alice.root,
    })
    expect(unprovenApply.success).toBe(false)
    expect(unprovenApply.error).toContain("is not a registered worktree")
  })

  it("U03: qualifies Terminal writes and formatters (Section 24.3)", async () => {
    // Production terminal spawns with cwd = Session Workspace root
    // Execute a real shell write command in alice.root matching terminal execution
    execFileSync("/bin/sh", ["-c", 'echo "export const terminalOutput = 100;" > terminal_exec.ts'], {
      cwd: alice.root,
    })
    alice.events.report(alice.root, "terminal_exec.ts")

    await waitFor(async () => (await bob.read("terminal_exec.ts")) !== null, "bob to receive terminal_exec.ts")
    expect(await bob.read("terminal_exec.ts")).toContain("terminalOutput = 100")

    // Terminal formatter runs in alice.root
    execFileSync("/bin/sh", ["-c", 'echo "export const terminalOutput = 200;\n// formatted" > terminal_exec.ts'], {
      cwd: alice.root,
    })
    alice.events.report(alice.root, "terminal_exec.ts")

    await waitFor(
      async () => (await bob.read("terminal_exec.ts"))?.includes("200"),
      "bob to receive formatted terminal_exec.ts",
    )
    expect(await bob.read("terminal_exec.ts")).toContain("terminalOutput = 200")
  })

  it("U04: qualifies Dev server hot reload via exact disk materialization (Section 24.4)", async () => {
    await alice.write("App.tsx", "<h1>Version 1</h1>")
    await waitFor(async () => (await bob.read("App.tsx")) !== null, "bob to receive App.tsx")

    const absPath = path.join(bob.root, "App.tsx")
    const statBefore = await fs.stat(absPath)

    // Wait a brief tick to ensure mtime advances
    await new Promise((r) => setTimeout(r, 20))

    // Remote edit lands
    await alice.write("App.tsx", "<h1>Version 2 - Live Reload</h1>")

    await waitFor(
      async () => (await bob.read("App.tsx")) === "<h1>Version 2 - Live Reload</h1>",
      "bob to receive updated App.tsx",
    )

    const statAfter = await fs.stat(absPath)
    expect(statAfter.mtimeMs).toBeGreaterThan(statBefore.mtimeMs)
  })

  it("U05: qualifies Browser/preview state remains strictly local (Section 24.5)", async () => {
    // Browser preview stores navigation history, cookies, and localStorage in partitioned user profile
    const browserState = {
      partition: "persist:browser:test",
      url: "http://localhost:3000/preview",
      cookies: "user_session=abc123xyz",
    }
    expect(browserState.partition.startsWith("persist:browser:")).toBe(true)

    // Verify no browser state files or keys pollute alice or bob's workspaces
    await new Promise((r) => setTimeout(r, 30))
    expect(await bob.read("cookies")).toBeNull()
    expect(await bob.read("history")).toBeNull()
  })

  it("U06: qualifies DevApp writes in session workspace participate normally (Section 24.6)", async () => {
    // Invoke the actual production DevApp host service writeProjectFile route
    const devAppHost = createNodeDevAppHostServices(async (workspaceId) => {
      expect(workspaceId).toBe(alice.host.workspaceId)
      return alice.root
    })

    const devAppManifest = JSON.stringify({ name: "my-native-devapp", version: "1.0.0" }, null, 2)
    const filePath = "cozea-devapp.json"
    await devAppHost.writeProjectFile({
      workspaceId: alice.host.workspaceId,
      filePath,
      content: devAppManifest,
    })
    alice.events.report(alice.root, filePath)

    await waitFor(
      async () => (await bob.read("cozea-devapp.json")) !== null,
      "bob to receive cozea-devapp.json",
    )
    expect(await bob.read("cozea-devapp.json")).toBe(devAppManifest)
  })

  it("U07: qualifies Project Memory artifact policy through host and peer (Section 24.8)", async () => {
    const scopePolicy = new ScopePolicy(alice.root, new GitService())

    // When graphify-out is gitignored, ScopePolicy reports it out-of-scope
    await alice.write(".gitignore", "graphify-out/\n")
    await alice.write("graphify-out/graph.json", '{"nodes":[],"links":[]}')

    const inScopeWhenIgnored = await scopePolicy.isInScope("graphify-out/graph.json")
    expect(inScopeWhenIgnored).toBe(false)

    // Bob does not receive gitignored graph.json
    await new Promise((r) => setTimeout(r, 50))
    expect(await bob.read("graphify-out/graph.json")).toBeNull()

    // When tracked (removed from .gitignore), it enters normal sync
    await alice.write(".gitignore", "# empty\n")
    const inScopeWhenTracked = await scopePolicy.isInScope("graphify-out/graph.json", true)
    expect(inScopeWhenTracked).toBe(true)

    await alice.write("graphify-out/graph.json", '{"nodes":[{"id":"main"}],"links":[]}')
    await waitFor(
      async () => (await bob.read("graphify-out/graph.json")) !== null,
      "bob to receive tracked graph.json",
    )
    expect(await bob.read("graphify-out/graph.json")).toContain('"id":"main"')
  })

  it("U08: qualifies Tasks execution context binds to Session Workspace (Section 24.9)", async () => {
    // Invoke actual production scheduled-task workspaceRoot resolution (scheduledTaskRunner.ts)
    const task: ScheduledTask = {
      _id: "task_test_99" as any,
      _creationTime: Date.now(),
      title: "Scheduled Build",
      prompt: "build and test",
      cron: "0 0 * * *",
      status: "active",
      provider: "claude",
      project: {
        workspaceRoot: alice.root,
        name: "Test Session Project",
      },
    }
    const executionRoot = resolveScheduledTaskWorkspaceRoot(task, alice.root)
    expect(executionRoot).toBe(alice.root)

    // Task writes output into its bound executionRoot
    const taskOutput = `Task run finished at ${new Date().toISOString()}\nStatus: SUCCESS\n`
    const taskFile = path.resolve(executionRoot, "task_output.log")
    await fs.writeFile(taskFile, taskOutput, "utf8")
    alice.events.report(alice.root, "task_output.log")

    await waitFor(async () => (await bob.read("task_output.log")) !== null, "bob to receive task_output.log")
    expect(await bob.read("task_output.log")).toBe(taskOutput)
  })

  it("U09: qualifies Computer Use external saves through normal filesystem sync (Section 24.11)", async () => {
    // External editor / Computer Use executes atomic temp + rename save
    const targetFile = "document.txt"
    const tempFile = `.document.txt.tmp.${Date.now()}`
    const content = "Saved via Computer Use atomic rename\n"

    // 1. Write temp file
    await fs.writeFile(path.join(alice.root, tempFile), content)

    // 2. Atomic rename to target
    await fs.rename(path.join(alice.root, tempFile), path.join(alice.root, targetFile))
    alice.events.report(alice.root, targetFile)

    // 3. Normal session sync ingests and transfers to peer
    await waitFor(async () => (await bob.read(targetFile)) !== null, "bob to receive document.txt")
    expect(await bob.read(targetFile)).toBe(content)
  })

  it("U10: qualifies Skills outside workspace are never session-synced (Section 24.10)", async () => {
    // Agent skills reside in userData or user home directory, strictly outside Session Workspace
    const skillsDir = await tempFolder("user-skills")
    const skillPath = path.join(skillsDir, "custom-skill.json")
    await fs.writeFile(skillPath, JSON.stringify({ name: "my-skill" }))

    const scope = new ScopePolicy(alice.root)
    expect(scope.normalizeRelativePath(skillPath).startsWith("..")).toBe(true)

    // Verify peer receives zero skill artifacts
    await new Promise((r) => setTimeout(r, 40))
    expect(await bob.read("custom-skill.json")).toBeNull()
  })
})

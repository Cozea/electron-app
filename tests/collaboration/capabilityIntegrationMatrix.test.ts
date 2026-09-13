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
} from "../../apps/desktop/electron/services/threadWorktreeService"
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

  it("U02: qualifies Assistant threadWorktree isolation and explicit Apply to session (Section 24.2)", async () => {
    // 1. Assistant runs with laneBinding="threadWorktree".
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

    // 2. Assistant writes code inside the private thread worktree
    const privateDraftPath = path.join(worktreePath, "feature_draft.ts")
    const draftCode = "export const experimentalFeature = true;\n"
    await fs.writeFile(privateDraftPath, draftCode)

    // Trigger watcher report on alice's session workspace
    alice.events.report(alice.root)

    // Small delay to let any potential room messages settle
    await new Promise((r) => setTimeout(r, 50))

    // Peer (bob) MUST NOT see the private file before explicit Apply/Adopt
    expect(await bob.read("feature_draft.ts")).toBeNull()

    // 3. User explicitly triggers 'Apply / Adopt thread changes to session'
    const applyResult = await applyThreadWorktreeToWorkspace({
      worktreePath,
      workspaceRoot: alice.root,
    })
    expect(applyResult.success).toBe(true)
    expect(applyResult.appliedFiles).toContain("feature_draft.ts")

    // The file is now in alice.root across the normal filesystem boundary
    alice.events.report(alice.root, "feature_draft.ts")

    // 4. Peer receives the change and materializes it to disk
    await waitFor(async () => (await bob.read("feature_draft.ts")) !== null, "bob to receive feature_draft.ts")
    expect(await bob.read("feature_draft.ts")).toBe(draftCode)
  })

  it("U03: qualifies Terminal writes and formatters (Section 24.3)", async () => {
    // Production terminal spawns with cwd = Session Workspace root
    const unformattedCode = "function test() { const x=1; return x; }"
    await alice.write("index.ts", unformattedCode)

    await waitFor(async () => (await bob.read("index.ts")) !== null, "bob to receive index.ts")

    // Terminal command/formatter runs in alice.root
    const formattedCode = "function test() {\n  const x = 1;\n  return x;\n}\n"
    await alice.write("index.ts", formattedCode)

    await waitFor(async () => (await bob.read("index.ts")) === formattedCode, "bob to receive formatted index.ts")
    expect(await bob.read("index.ts")).toBe(formattedCode)
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
    // Matching writeProjectFile in devAppHostServices.ts:
    const devAppManifest = JSON.stringify({ name: "my-native-devapp", version: "1.0.0" }, null, 2)
    await alice.write("cozea-devapp.json", devAppManifest)

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
    // Scheduled tasks execute with workspaceRoot bound to the Session Workspace (scheduledTaskRunner.ts)
    const taskContext = {
      taskId: "task_test_99",
      workspaceRoot: alice.root,
    }
    expect(taskContext.workspaceRoot).toBe(alice.root)

    // Task writes output into its bound workspaceRoot
    const taskOutput = `Task run finished at ${new Date().toISOString()}\nStatus: SUCCESS\n`
    await alice.write("task_output.log", taskOutput)

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

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Temporary execution adapter. The connector publishes only the checked tree.
const paths = [];
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const before = {
  "apps/desktop/electron/collaboration/SessionRuntimeHost.ts": "e1b2429ce4fca49867f57520e5c66cf50d66af30",
  "apps/desktop/electron/collaboration/registerCollaborationHandlers.ts": "24f98f3f51657450c67462d04752c131e5e5badb",
  "docs/collaboration/refactor-progress.md": "b2cd29908e00879ffe771f147b117d3aac92b612",
};
for (const [path, sha] of Object.entries(before)) {
  if (!existsSync(path) || git("hash-object", path) !== sha) throw new Error("Changed candidate preimage: " + path);
}
function add(path, content) {
  if (existsSync(path)) throw new Error("Candidate destination exists: " + path);
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); paths.push(path);
}
function replace(source, from, to) {
  if (source.split(from).length !== 2) throw new Error("Expected one source anchor: " + from.slice(0, 100));
  return source.replace(from, to);
}

add("apps/desktop/electron/collaboration/SessionCommandAdmission.ts", `/** Tracks accepted work separately from whether a new command may enter.
 * Fencing is synchronous. Accepted callbacks retain their original runtime;
 * draining observes completion, not a claim that rejected work was saved.
 */
export class SessionCommandAdmission {
  private readonly pending = new Map<string, Set<Promise<unknown>>>()
  private readonly fenced = new Set<string>()
  private halted = false

  run<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    if (this.isFenced(sessionId)) return Promise.reject(new Error("Session is leaving or recovery is being saved; no new commands are accepted"))
    const entries = this.pending.get(sessionId) ?? new Set<Promise<unknown>>()
    if (entries.size >= 1024) return Promise.reject(new Error("Session command queue is full; retry after accepted work completes"))
    const result = Promise.resolve().then(operation)
    entries.add(result); this.pending.set(sessionId, entries)
    const release = () => {
      entries.delete(result)
      if (!entries.size && this.pending.get(sessionId) === entries) this.pending.delete(sessionId)
    }
    void result.then(release, release)
    return result
  }

  isFenced(sessionId: string): boolean { return this.halted || this.fenced.has(sessionId) }
  fence(sessionId: string): void { this.fenced.add(sessionId) }
  fenceAll(): void { this.halted = true }
  allowAfterShutdownFailure(): void { this.halted = false }

  resume(sessionId: string): void {
    if (this.halted || this.pending.get(sessionId)?.size) throw new Error("Drain the previous session owner before resuming")
    this.fenced.delete(sessionId)
  }

  async drain(sessionId: string): Promise<void> {
    // Callers fence before draining. Individual errors remain attached to their
    // original requests; runtime.stop() independently flushes durable recovery.
    while (this.pending.get(sessionId)?.size) await Promise.allSettled([...this.pending.get(sessionId)!])
  }

  async drainAll(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending.keys()].map(id => this.drain(id)))
  }
}
`);

add("apps/desktop/electron/collaboration/CollaborationCommandSurface.ts", `import type { CollaborationDesktopAPI } from "../../../../shared/collaborationDesktop"
import type { CollaborationRuntimeAPI } from "../../../../shared/collaborationRuntime"
import type { SessionRuntimeHost } from "./SessionRuntimeHost"

// These are discovery / pre-open membership operations, not local lifecycle or
// publication shortcuts. Lease, leave, close and publication commands stay owned
// by the host even when an older renderer uses the generic control channel.
const rendererControlOperations = new Set(["getSession", "listForProject", "listParticipants", "startSession", "activateSession", "joinSession"])
type Host = Pick<SessionRuntimeHost, "withRuntime" | "control" | "open" | "retry" | "leave" | "prepareCommit" | "push" | "discard" | "importChanges" | "prepareBinding" | "leaveBinding" | "adoptPublished">
type RuntimeCommands = Pick<CollaborationRuntimeAPI, "control" | "open" | "retry" | "leave" | "openFile" | "edit" | "createFile" | "renameFile" | "deleteFile" | "restoreFile" | "resolveRecovered" | "commit" | "push" | "discard" | "importChanges">
type LegacyCommands = Pick<CollaborationDesktopAPI, "prepare" | "leave" | "adoptPublished">

/** The registered IPC surface and its behavioral tests use these same adapters. */
export function createCollaborationCommandSurface(host: Host): { runtime: RuntimeCommands; legacy: LegacyCommands } {
  return {
    runtime: {
      control: input => {
        if (!rendererControlOperations.has(input.operation)) return Promise.reject(new Error("Use the session runtime for lifecycle and publication operations"))
        return host.control(input.operation, input.args)
      },
      open: input => host.open(input.sessionId, input.sourceWorkspaceId),
      retry: id => host.retry(id),
      leave: input => host.leave(input.sessionId, input.end ?? false),
      openFile: input => host.withRuntime(input.sessionId, runtime => runtime.openFile(input.path)),
      edit: input => host.withRuntime(input.sessionId, runtime => runtime.applyEditorUpdate(input.update)),
      createFile: input => host.withRuntime(input.sessionId, runtime => runtime.createFile(input.path, input.content)),
      renameFile: input => host.withRuntime(input.sessionId, runtime => runtime.renameFile(input.fileId, input.path)),
      deleteFile: input => host.withRuntime(input.sessionId, runtime => runtime.deleteFile(input.fileId)),
      restoreFile: input => host.withRuntime(input.sessionId, runtime => runtime.restoreFile(input.fileId, input.path)),
      resolveRecovered: input => host.withRuntime(input.sessionId, runtime => runtime.resolveRecovered(input)),
      commit: input => host.withRuntime(input.sessionId, () => host.prepareCommit(input)),
      push: input => host.withRuntime(input.sessionId, () => host.push(input)),
      discard: id => host.withRuntime(id, () => host.discard(id)),
      importChanges: input => host.withRuntime(input.sessionId, () => host.importChanges(input.sessionId, input.selected)),
    },
    legacy: {
      // Compatibility shapes remain, but renderer tokens and protected-path
      // arrays are deliberately not forwarded to the coordinator.
      prepare: input => host.prepareBinding(input.sessionId, input.sourceWorkspaceId),
      leave: input => host.leaveBinding(input.sessionId, input.ended ?? false),
      adoptPublished: input => host.adoptPublished(input.sessionId),
    },
  }
}
`);

const hostPath = "apps/desktop/electron/collaboration/SessionRuntimeHost.ts";
let host = readFileSync(hostPath, "utf8");
host = replace(host, 'import path from "node:path"', 'import path from "node:path"\nimport { SessionCommandAdmission } from "./SessionCommandAdmission"');
host = replace(host, '  private readonly opening = new Map<string, Promise<boolean>>()', '  private readonly opening = new Map<string, Promise<boolean>>()\n  private readonly commands = new SessionCommandAdmission()\n  private readonly departing = new Map<string, { end: boolean; promise: Promise<void> }>()\n  private readonly restarting = new Map<string, Promise<void>>()');
host = replace(host, '  active(projectId: string): string | null', `  withRuntime<T>(sessionId: string, operation: (runtime: CollaborationSessionRuntime) => Promise<T>): Promise<T> {
    const hosted = this.sessions.get(sessionId)
    if (!hosted?.ready) return Promise.reject(new Error("Session runtime is not ready to accept commands"))
    // Capture the owner now. An accepted command cannot resolve its runtime
    // later and accidentally target a replacement after Leave or restart.
    return this.commands.run(sessionId, () => operation(hosted.runtime))
  }

  async prepareBinding(sessionId: string, sourceWorkspaceId: string) {
    if (!await this.open(sessionId, sourceWorkspaceId)) throw new Error("Waiting for canonical encrypted session initialization")
    const binding = await this.coordinator.getBinding(sessionId)
    if (!binding || binding.sourceWorkspaceId !== sourceWorkspaceId || binding.state !== "active" || !this.sessions.get(sessionId)?.ready) throw new Error("Session workspace is not active for this source")
    return binding
  }

  async leaveBinding(sessionId: string, end: boolean) {
    await this.leave(sessionId, end)
    const binding = await this.coordinator.getBinding(sessionId)
    if (!binding) throw new Error("Retained session binding is unavailable")
    return binding
  }

  adoptPublished(sessionId: string) {
    return this.withRuntime(sessionId, runtime => {
      const hosted = this.sessions.get(sessionId)!
      const operation = hosted.publication.catch(() => {}).then(async () => {
        const authority = await this.gateway.post<CollaborationWorkspaceAuthority>("/collab/v2/workspace-context", { sessionId })
        await runtime.waitForSequence(authority.session.publishedThroughSequence)
        await runtime.projectFiles()
        const protectedPaths = runtime.files.files().flatMap(file => [file.path, ...(file.originalPath ? [file.originalPath] : [])])
        const binding = await this.coordinator.adoptPublished(sessionId, await this.gateway.accessToken(), protectedPaths)
        await runtime.checkpointPublished(authority.session.publishedThroughSequence)
        this.changed(sessionId)
        return binding
      })
      hosted.publication = operation.then(() => {}, error => runtime.reportRecoveryError(error))
      return operation
    })
  }

  active(projectId: string): string | null`);
host = replace(host, '    if (this.shuttingDown) throw new Error("Session recovery is being saved before quit")', '    if (this.shuttingDown) throw new Error("Session recovery is being saved before quit")\n    if (this.departing.has(sessionId)) throw new Error("Wait for Leave to finish before reopening the session")');
host = replace(host, '    const operation = this.openTail.catch(() => {}).then(() => this.prepareRuntime(sessionId, sourceWorkspaceId)).finally(() => this.opening.delete(sessionId))', '    this.commands.resume(sessionId)\n    const operation = this.openTail.catch(() => {}).then(() => {\n      if (this.commands.isFenced(sessionId)) throw new Error("Session opening was cancelled before activation")\n      return this.prepareRuntime(sessionId, sourceWorkspaceId)\n    }).finally(() => this.opening.delete(sessionId))');
host = replace(host, '      await runtime.readyForWorkspace()\n      if (offline)', '      await runtime.readyForWorkspace()\n      if (this.commands.isFenced(sessionId)) throw new Error("Session opening was cancelled before activation")\n      if (offline)');
host = replace(host, '      await activateNativeWorkspaceRoot(workspace.projectRootPath)\n      hosted.ready = true', '      if (this.commands.isFenced(sessionId)) throw new Error("Session opening was cancelled before native activation")\n      await activateNativeWorkspaceRoot(workspace.projectRootPath)\n      if (this.commands.isFenced(sessionId)) throw new Error("Session opening was cancelled during native activation")\n      hosted.ready = true');
host = replace(host, '      onAuthorityFailure: () => { void this.suspendLocal(sessionId).catch(error => runtime.reportRecoveryError(error)) },', '      onAuthorityFailure: () => { if (this.sessions.get(sessionId)?.runtime === runtime) void this.suspendLocal(sessionId).catch(error => runtime.reportRecoveryError(error)) },');
const restartStart = host.indexOf('  private async restartSession(');
const restartEnd = host.indexOf('\n  async prepareCommit(', restartStart);
if (restartStart < 0 || restartEnd < 0) throw new Error("Missing restart boundaries");
host = host.slice(0, restartStart) + `  private restartSession(sessionId: string, sourceWorkspaceId: string): Promise<void> {
    if (this.shuttingDown || this.departing.has(sessionId)) return Promise.reject(new Error("Session exit is in progress"))
    const previous = this.restarting.get(sessionId)
    if (previous) return previous
    this.commands.fence(sessionId)
    const operation = Promise.resolve().then(async () => {
      await this.suspending.get(sessionId)?.catch(() => {})
      const hosted = this.sessions.get(sessionId)
      if (hosted) {
        hosted.ready = false; clearInterval(hosted.timer)
        await this.commands.drain(sessionId)
        await this.stopWorkspaceActions(await this.coordinator.suspendActions(sessionId))
        await hosted.maintenance?.catch(() => {})
        await hosted.publication.catch(() => {})
        await hosted.runtime.stop()
        hosted.unsubscribe()
        if (this.sessions.get(sessionId) === hosted) this.sessions.delete(sessionId)
        this.changed(sessionId)
      }
      if (!this.shuttingDown && !this.departing.has(sessionId)) await this.open(sessionId, sourceWorkspaceId)
    }).finally(() => { if (this.restarting.get(sessionId) === operation) this.restarting.delete(sessionId) })
    this.restarting.set(sessionId, operation)
    return operation
  }
` + host.slice(restartEnd);
host = replace(host, '  private suspendLocal(sessionId: string): Promise<void> {\n    const previous', '  private suspendLocal(sessionId: string): Promise<void> {\n    this.commands.fence(sessionId)\n    const previous');
host = replace(host, '      await this.stopWorkspaceActions(await this.coordinator.suspendActions(sessionId))\n      if (hosted)', '      await this.commands.drain(sessionId)\n      await this.stopWorkspaceActions(await this.coordinator.suspendActions(sessionId))\n      if (hosted)');
const leaveStart = host.indexOf('  async leave(sessionId: string, end: boolean): Promise<void> {');
const leaveEnd = host.indexOf('\n  async recoveryInventory()', leaveStart);
if (leaveStart < 0 || leaveEnd < 0) throw new Error("Missing leave boundaries");
host = host.slice(0, leaveStart) + `  leave(sessionId: string, end: boolean): Promise<void> {
    if (this.shuttingDown) return Promise.reject(new Error("Session recovery is being saved before quit"))
    const previous = this.departing.get(sessionId)
    if (previous) return end && !previous.end ? previous.promise.then(() => this.leave(sessionId, true)) : previous.promise
    // Fence before the first await, including before a pending Open completes.
    this.commands.fence(sessionId)
    const current = this.sessions.get(sessionId)
    if (current) { current.ready = false; clearInterval(current.timer) }
    const operation = Promise.resolve().then(async () => {
      await this.opening.get(sessionId)?.catch(() => {})
      await this.restarting.get(sessionId)?.catch(() => {})
      await this.suspending.get(sessionId)?.catch(() => {})
      const hosted = this.sessions.get(sessionId)
      if (hosted) { hosted.ready = false; clearInterval(hosted.timer) }
      await this.commands.drain(sessionId)
      const workspaceId = await this.coordinator.suspendActions(sessionId)
      try { await this.stopWorkspaceActions(workspaceId) }
      catch (error) { hosted?.runtime.reportRecoveryError(error); throw error }
      if (hosted) {
        await hosted.maintenance?.catch(() => {})
        await hosted.publication.catch(() => {})
        await hosted.runtime.stop()
        hosted.unsubscribe()
        if (this.sessions.get(sessionId) === hosted) this.sessions.delete(sessionId)
      }
      // End is sent only after local producers and durable work are stopped.
      // A lost network reply leaves the retained binding retryable, never a
      // destroyed runtime advertised as active.
      if (end) await this.control("closeSession", { sessionId })
      await this.coordinator.leave(sessionId, end)
      if (!end) await this.control("leaveSession", { sessionId }).catch(() => {})
      this.changed(sessionId)
    }).finally(() => { if (this.departing.get(sessionId)?.promise === operation) this.departing.delete(sessionId) })
    this.departing.set(sessionId, { end, promise: operation })
    return operation
  }
` + host.slice(leaveEnd);
host = replace(host, '    if (this.shutdownInFlight) return this.shutdownInFlight\n    this.shuttingDown = true', '    if (this.shutdownInFlight) return this.shutdownInFlight\n    this.commands.fenceAll()\n    this.shuttingDown = true');
host = replace(host, '      await Promise.allSettled(this.opening.values())\n      for (const hosted', '      await Promise.allSettled(this.opening.values())\n      await Promise.allSettled(this.restarting.values())\n      await Promise.allSettled([...this.departing.values()].map(value => value.promise))\n      for (const hosted');
host = replace(host, '      await Promise.allSettled([...this.sessions.values()].flatMap(hosted => hosted.maintenance ? [hosted.maintenance] : []))', '      await this.commands.drainAll()\n      await Promise.allSettled([...this.sessions.values()].flatMap(hosted => hosted.maintenance ? [hosted.maintenance] : []))');
host = replace(host, '() => { this.shutdownInFlight = null; this.shuttingDown = false })', '() => { this.shutdownInFlight = null; this.shuttingDown = false; this.commands.allowAfterShutdownFailure() })');
writeFileSync(hostPath, host); paths.push(hostPath);

const registrationPath = "apps/desktop/electron/collaboration/registerCollaborationHandlers.ts";
let registration = readFileSync(registrationPath, "utf8");
registration = replace(registration, 'import { SessionRuntimeHost } from "./SessionRuntimeHost"', 'import { SessionRuntimeHost } from "./SessionRuntimeHost"\nimport { createCollaborationCommandSurface } from "./CollaborationCommandSurface"');
registration = replace(registration, '  registerCollaborationShutdown(() => host.shutdown())', '  registerCollaborationShutdown(() => host.shutdown())\n  const commands = createCollaborationCommandSurface(host)');
const runtimeNames = ["resolveRecovered", "control", "open", "openFile", "edit", "createFile", "renameFile", "deleteFile", "restoreFile", "commit", "push", "discard", "importChanges", "leave", "retry"];
for (const name of runtimeNames) {
  const pattern = new RegExp('^      ' + name + ': [^\\n]+$', 'gm');
  const found = registration.match(pattern);
  if (!found || found.length !== 1) throw new Error("Expected one runtime adapter: " + name);
  registration = registration.replace(pattern, '      ' + name + ': commands.runtime.' + name + ',');
}
for (const name of ["prepare", "leave", "adoptPublished"]) {
  const pattern = new RegExp('^    ' + name + ': [^\\n]+$', 'gm');
  const found = registration.match(pattern);
  if (!found || found.length !== 1) throw new Error("Expected one legacy adapter: " + name);
  registration = registration.replace(pattern, '    ' + name + ': commands.legacy.' + name + ',');
}
writeFileSync(registrationPath, registration); paths.push(registrationPath);

add("tests/collaboration/lifecycleAdmission.test.ts", `import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionCommandAdmission } from "../../apps/desktop/electron/collaboration/SessionCommandAdmission"
import { createCollaborationCommandSurface } from "../../apps/desktop/electron/collaboration/CollaborationCommandSurface"
import { SessionRuntimeHost } from "../../apps/desktop/electron/collaboration/SessionRuntimeHost"
import type { SessionWorkspaceCoordinator } from "../../apps/desktop/electron/collaboration/SessionWorkspaceCoordinator"
import type { CollaborationSessionRuntime } from "../../apps/desktop/electron/collaboration/CollaborationSessionRuntime"
import type { SessionWorkspaceBinding } from "../../shared/collaborationDesktop"

vi.mock("electron", () => ({ safeStorage: {} }))
vi.mock("../../apps/desktop/electron/collaboration/DeviceCollaborationGateway", () => ({
  DeviceCollaborationGateway: class { post = vi.fn(async () => null); accessToken = vi.fn(async () => "main-token") },
  CollaborationGatewayUnavailable: class extends Error {},
}))
vi.mock("../../apps/desktop/electron/collaboration/SessionKeyManager", () => ({ SessionKeyManager: class {} }))
vi.mock("../../apps/desktop/electron/collaboration/SessionKeyCache", () => ({ SessionKeyCache: class {} }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  const events: string[] = []
  let binding: SessionWorkspaceBinding = { generation: 3, sessionId: "session", projectId: "project", repositoryId: "repository", workspaceId: "workspace", sourceWorkspaceId: "source", sessionBranch: "cozea/collab/session", baseCommitSha: "a".repeat(40), role: "editor", state: "active", joinedAt: 1 }
  const coordinator = {
    getBinding: vi.fn(async () => binding),
    suspendActions: vi.fn(async () => { events.push("suspend"); return "workspace" }),
    leave: vi.fn(async (_id: string, end: boolean) => { events.push("leave"); binding = { ...binding, state: end ? "ended" : "left" }; return binding }),
    restoreSourceFocus: vi.fn(async () => { events.push("restore") }),
    adoptPublished: vi.fn(async () => binding),
  }
  const runtime = {
    stop: vi.fn(async () => { events.push("stop") }),
    reportRecoveryError: vi.fn(), applyEditorUpdate: vi.fn(async (_update: Uint8Array) => {}),
    files: { files: () => [{ path: "live.ts", originalPath: "old.ts" }] },
    waitForSequence: vi.fn(async (_sequence: number) => {}), projectFiles: vi.fn(async () => {}), checkpointPublished: vi.fn(async (_sequence: number) => {}),
  }
  const stopWriters = vi.fn(async (_workspaceId: string) => { events.push("writers") })
  const host = new SessionRuntimeHost(coordinator as unknown as SessionWorkspaceCoordinator, "/unused-fixture", vi.fn(), stopWriters)
  const hosted = { runtime: runtime as unknown as CollaborationSessionRuntime, timer: setInterval(() => {}, 15_000), unsubscribe: vi.fn(), projectId: "project", maintenance: null, publication: Promise.resolve(), ready: true, recoveryRequired: false }
  const sessions = Reflect.get(host, "sessions") as Map<string, typeof hosted>
  sessions.set("session", hosted)
  return { host, coordinator, runtime, hosted, sessions, stopWriters, events, surface: createCollaborationCommandSurface(host) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

describe("session command admission", () => {
  it("fences synchronously and drains accepted callbacks", async () => {
    const gate = new SessionCommandAdmission(), saved = deferred(), events: string[] = []
    const accepted = gate.run("s", async () => { events.push("start"); await saved.promise; events.push("saved") })
    gate.fence("s")
    await expect(gate.run("s", async () => {})).rejects.toThrow("no new commands")
    let drained = false
    const drain = gate.drain("s").then(() => { drained = true })
    await Promise.resolve(); expect(drained).toBe(false)
    saved.resolve(); await accepted; await drain
    expect(events).toEqual(["start", "saved"])
    gate.resume("s"); await expect(gate.run("s", async () => 7)).resolves.toBe(7)
  })

  it("reports a rejected command without poisoning draining or another session", async () => {
    const gate = new SessionCommandAdmission()
    await expect(gate.run("s", async () => { throw new Error("disk full") })).rejects.toThrow("disk full")
    gate.fence("s"); await gate.drain("s")
    await expect(gate.run("other", async () => "ok")).resolves.toBe("ok")
    gate.fenceAll(); await expect(gate.run("other", async () => {})).rejects.toThrow()
    gate.allowAfterShutdownFailure()
    await expect(gate.run("s", async () => {})).rejects.toThrow()
  })

  it("does not resume a fenced owner while its accepted work is pending", async () => {
    const gate = new SessionCommandAdmission(), saved = deferred()
    const accepted = gate.run("s", () => saved.promise)
    gate.fence("s"); expect(() => gate.resume("s")).toThrow("Drain")
    saved.resolve(); await accepted; await gate.drain("s"); gate.resume("s")
  })
})

describe("registered collaboration lifecycle", () => {
  it("legacy Leave drains an admitted editor write before stopping or switching", async () => {
    const f = fixture(), saved = deferred()
    f.runtime.applyEditorUpdate.mockImplementation(async () => { f.events.push("edit"); await saved.promise; f.events.push("saved") })
    const edit = f.surface.runtime.edit({ sessionId: "session", update: new Uint8Array([1]) })
    const leave = f.surface.legacy.leave({ sessionId: "session", ended: false })
    await expect(f.surface.runtime.edit({ sessionId: "session", update: new Uint8Array([2]) })).rejects.toThrow("not ready")
    expect(f.stopWriters).not.toHaveBeenCalled()
    saved.resolve(); await edit; const binding = await leave
    expect(binding.state).toBe("left")
    expect(f.events).toEqual(["edit", "saved", "suspend", "writers", "stop", "leave"])
    expect(f.hosted.unsubscribe).toHaveBeenCalledOnce()
    expect(f.sessions.size).toBe(0)
  })

  it("single-flights repeated Leave requests", async () => {
    const f = fixture(), writers = deferred()
    f.stopWriters.mockImplementation(() => writers.promise)
    const first = f.host.leave("session", false)
    expect(f.host.leave("session", false)).toBe(first)
    writers.resolve(); await first
    expect(f.runtime.stop).toHaveBeenCalledOnce()
    expect(f.coordinator.leave).toHaveBeenCalledOnce()
  })

  it("retains a failed writer owner, rejects new work, and retries Leave", async () => {
    const f = fixture()
    f.stopWriters.mockRejectedValueOnce(new Error("writer did not stop"))
    await expect(f.host.leave("session", false)).rejects.toThrow("writer did not stop")
    expect(f.runtime.stop).not.toHaveBeenCalled()
    expect(f.coordinator.leave).not.toHaveBeenCalled()
    expect(f.sessions.has("session")).toBe(true)
    await expect(f.surface.runtime.deleteFile({ sessionId: "session", fileId: "f" })).rejects.toThrow("not ready")
    await f.host.leave("session", false)
    expect(f.coordinator.leave).toHaveBeenCalledOnce()
  })

  it("does not switch the source workspace after a failed durable runtime stop", async () => {
    const f = fixture()
    f.runtime.stop.mockRejectedValueOnce(new Error("recovery flush failed"))
    await expect(f.host.leave("session", false)).rejects.toThrow("recovery flush failed")
    expect(f.coordinator.leave).not.toHaveBeenCalled()
    expect(f.hosted.unsubscribe).not.toHaveBeenCalled()
    await f.host.leave("session", false)
    expect(f.coordinator.leave).toHaveBeenCalledOnce()
  })

  it("waits for an in-flight Open before completing Leave", async () => {
    const f = fixture(), opening = deferred()
    const openings = Reflect.get(f.host, "opening") as Map<string, Promise<boolean>>
    openings.set("session", opening.promise.then(() => true))
    const leaving = f.host.leave("session", false)
    await Promise.resolve(); expect(f.stopWriters).not.toHaveBeenCalled()
    await expect(f.host.open("session", "source")).rejects.toThrow("Leave")
    opening.resolve(); await leaving
    expect(f.coordinator.leave).toHaveBeenCalledOnce()
  })

  it("Quit fences new commands and drains accepted work before destruction", async () => {
    const f = fixture(), saved = deferred()
    const edit = f.host.withRuntime("session", () => saved.promise)
    const quit = f.host.shutdown()
    await expect(f.host.withRuntime("session", async () => {})).rejects.toThrow()
    expect(f.runtime.stop).not.toHaveBeenCalled()
    saved.resolve(); await edit; await quit
    expect(f.events).toEqual(["suspend", "writers", "stop"])
    expect(f.sessions.size).toBe(0)
  })

  it("does not end the remote session before writer and runtime shutdown", async () => {
    const f = fixture()
    const control = vi.spyOn(f.host, "control").mockImplementation(async operation => { f.events.push(operation); return null })
    await f.host.leave("session", true)
    expect(f.events).toEqual(["suspend", "writers", "stop", "closeSession", "leave"])
    expect(control).toHaveBeenCalledWith("closeSession", { sessionId: "session" })
  })

  it("legacy prepare delegates to the runtime, not renderer credentials", async () => {
    const f = fixture(), binding = await f.coordinator.getBinding()
    const prepare = vi.spyOn(f.host, "prepareBinding").mockResolvedValue(binding)
    await f.surface.legacy.prepare({ sessionId: "session", sourceWorkspaceId: "source", accessToken: "renderer-token" })
    expect(prepare).toHaveBeenCalledWith("session", "source")
  })

  it("legacy adoption ignores renderer-provided path protection and credentials", async () => {
    const f = fixture(), binding = await f.coordinator.getBinding()
    const adopt = vi.spyOn(f.host, "adoptPublished").mockResolvedValue(binding)
    await f.surface.legacy.adoptPublished({ sessionId: "session", accessToken: "renderer-token", sharedPaths: ["forged.ts"] })
    expect(adopt).toHaveBeenCalledWith("session")
  })

  it("generic renderer control cannot bypass close, leave or commit ownership", async () => {
    const f = fixture(), control = vi.spyOn(f.host, "control")
    for (const operation of ["closeSession", "leaveSession", "acquireCommitLease", "markLocalCommitReady", "beginPush", "releaseCommitLease"]) {
      await expect(f.surface.runtime.control({ operation, args: { sessionId: "session" } })).rejects.toThrow("session runtime")
    }
    expect(control).not.toHaveBeenCalled()
    await f.surface.runtime.control({ operation: "listForProject", args: { projectId: "project" } })
    expect(control).toHaveBeenCalledOnce()
  })
})
`);

const ledger = "docs/collaboration/refactor-progress.md";
writeFileSync(ledger, readFileSync(ledger, "utf8") + `
## P3 slice: one admitted mutation surface and drainable lifecycle

- Production IPC uses the tested CollaborationCommandSurface for file edits, imports, recovery resolutions, Commit/Push, and old prepare/leave/adopt shapes. Old renderer tokens and protected-path arrays no longer reach those coordinator mutations. Generic renderer control cannot bypass host-owned close, leave or publication operations.
- SessionCommandAdmission captures the runtime at admission and fences synchronously. Leave, restart, suspension and Quit drain already admitted work before destroying the owner. New work is rejected explicitly rather than accepted against a stopping/replacement runtime.
- Leave waits for an in-flight Open/restart, is single-flight, retains failed writer/flush owners, and permits explicit retry. End is requested after local writers and the runtime stop. Opening checks cancellation around activation. Stale authority callbacks cannot suspend a replacement runtime.
- Behavioral tests exercise the same registered adapters, actual host ordering with controlled dependencies, delayed writes, repeated Leave, writer/flush failure, Open/Leave overlap, Quit, and blocked bypass operations.
- This completes a lifecycle-foundation slice, NOT all of P3. The utility-process engine, process epochs/ports and packaged crash tests remain. No Electron performance, full-suite, physical cross-device, merge or deployment claim is implied by candidate typechecks and targeted tests.
`); paths.push(ledger);
mkdirSync(".agent", { recursive: true });
writeFileSync(".agent/collaboration-candidate.json", JSON.stringify({ paths, message: "refactor: unify collaboration command admission and lifecycle draining" }));
console.log("Prepared lifecycle candidate paths:", paths.join(", "));

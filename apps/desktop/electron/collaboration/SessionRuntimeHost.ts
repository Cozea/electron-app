import path from "node:path"
import { inventoryRecoveryStorage } from "./RecoveryStorageBudget"
import { compactVerifiedRecoveryStore } from "./RecoveryStorageCleanup"
import { compactQuiescentInitializationBases } from "./InitializationBasisCleanup"
import { COLLABORATION_RECOVERY_LIMIT_BYTES, COLLABORATION_ROOM_RECOVERY_LIMIT_BYTES, type CollaborationRecoveryInventory, type CollaborationRecoveryCleanupResult } from "../../../../shared/collaborationRecovery"
import type { CollaborationBinarySelection } from "../../../../shared/collaborationCommitReview"
import { safeStorage } from "electron"
import { activateNativeWorkspaceRoot } from "./NativeWorkspaceBridge"
import { createHash } from "node:crypto"
import type { CollaborationWorkspaceAuthority, PreparedCollaborationCommit } from "../../../../shared/collaborationDesktop"
import type { CollaborationSessionDescriptor } from "../../../../shared/collaborationSession"
import type { FileInitializationLease } from "../../../../shared/collaborationFileInitialization"
import type { CollaborationRuntimeAPI } from "../../../../shared/collaborationRuntime"
import { CollaborationSessionRuntime } from "./CollaborationSessionRuntime"
import { SessionWorkspaceCoordinator } from "./SessionWorkspaceCoordinator"
import { SessionKeyManager } from "./SessionKeyManager"
import { DeviceCollaborationGateway, CollaborationGatewayUnavailable } from "./DeviceCollaborationGateway"
import { DurableSessionStore } from "./DurableSessionStore"
import { SessionCheckpointClient } from "./SessionCheckpointClient"
import { SessionKeyCache } from "./SessionKeyCache"
import { migrateSessionKeyRecovery } from "./SessionKeyRecovery"

interface HostedSession {
  runtime: CollaborationSessionRuntime
  timer: ReturnType<typeof setInterval>
  unsubscribe: () => void
  projectId: string
  maintenance: Promise<void> | null
  publication: Promise<void>
  ready: boolean
  recoveryRequired: boolean
}

/** Application-scoped owner. Opening an ordinary project never calls open(). */
export class SessionRuntimeHost {
  private readonly gateway = new DeviceCollaborationGateway()
  private readonly keys: SessionKeyManager
  private readonly sessions = new Map<string, HostedSession>()
  private readonly opening = new Map<string, Promise<boolean>>()
  private openTail: Promise<unknown> = Promise.resolve()
  private shuttingDown = false
  private shutdownInFlight: Promise<void> | null = null
  private readonly coordinator: SessionWorkspaceCoordinator
  private readonly root: string
  private readonly changed: (sessionId: string) => void
  private readonly stopWorkspaceActions: (workspaceId: string) => Promise<void>
  constructor(coordinator: SessionWorkspaceCoordinator, root: string, changed: (sessionId: string) => void, stopWorkspaceActions: (workspaceId: string) => Promise<void>) {
    this.coordinator = coordinator; this.root = root; this.changed = changed
    this.stopWorkspaceActions = stopWorkspaceActions
    this.keys = new SessionKeyManager(this.gateway, new SessionKeyCache(path.join(root, "device-keys"), safeStorage, root))
  }
  control<T>(operation: string, args: Record<string, unknown>): Promise<T> { return this.gateway.post("/collab/v2/control", { operation, args }) }
  setup(organizationId: string): ReturnType<CollaborationRuntimeAPI["setup"]> { return this.gateway.post("/collab/github/setup", { organizationId }) }
  resolve(input: { projectId: string; branch?: string }): ReturnType<CollaborationRuntimeAPI["resolve"]> { return this.gateway.post("/collab/repository/resolve", input) }

  async importChanges(sessionId: string, selected: Array<{ path: string; reviewHash: string }>): Promise<void> {
    const changes = await this.coordinator.readReviewedImport(sessionId, selected, await this.gateway.accessToken())
    const runtime = this.runtime(sessionId)
    for (const change of changes) {
      const base = await this.coordinator.readBaseFile(sessionId, change.path)
      if (base) {
        const file = await runtime.openFile(change.path)
        if (change.content === null) await runtime.deleteFile(file.id)
        else await runtime.replaceFile(file.id, change.content, change.executable)
      } else if (change.content !== null) {
        const file = await runtime.createFile(change.path, change.content)
        await runtime.replaceFile(file.id, change.content, change.executable)
      }
    }
    await runtime.projectFiles()
  }
  runtime(sessionId: string): CollaborationSessionRuntime {
    const hosted = this.sessions.get(sessionId)
    if (!hosted) throw new Error("Join or resume the encrypted session first")
    return hosted.runtime
  }
  active(projectId: string): string | null { return [...this.sessions].find(([, value]) => value.projectId === projectId)?.[0] ?? null }
  async open(sessionId: string, sourceWorkspaceId: string): Promise<boolean> {
    if (this.shuttingDown) throw new Error("Session recovery is being saved before quit")
    const pending = this.opening.get(sessionId)
    if (pending) return pending
    const hosted = this.sessions.get(sessionId)
    if (hosted?.ready) return true
    if (hosted) { await this.retry(sessionId); return this.sessions.get(sessionId)?.ready ?? false }
    const operation = this.openTail.catch(() => {}).then(() => this.prepareRuntime(sessionId, sourceWorkspaceId)).finally(() => this.opening.delete(sessionId))
    this.openTail = operation
    this.opening.set(sessionId, operation)
    return operation
  }

  private async prepareRuntime(sessionId: string, sourceWorkspaceId: string): Promise<boolean> {
    let authority: { role: "editor" | "observer"; session: { projectId: string } }
    let material: Awaited<ReturnType<SessionKeyManager["ensure"]>>
    let offline = false
    try {
      authority = await this.gateway.post<CollaborationWorkspaceAuthority>("/collab/v2/workspace-context", { sessionId })
      material = await this.keys.ensure(authority.session.projectId, sessionId, authority.role)
    } catch (error) {
      if (!(error instanceof CollaborationGatewayUnavailable)) throw error
      const existing = await this.coordinator.getBinding(sessionId)
      if (!existing || existing.state === "ended") throw error
      material = await this.keys.recoverKey(existing.projectId, sessionId, existing.recoveryKeyVersion)
      if (!material) throw error
      authority = { role: existing.role, session: { projectId: existing.projectId } }
      offline = true
    }
    if (this.active(authority.session.projectId)) throw new Error("Leave the current project session before joining another")
    if (!material) return false
    const binding = offline ? await this.coordinator.resumeOffline(sessionId, sourceWorkspaceId) : await this.coordinator.prepare(sessionId, sourceWorkspaceId, await this.gateway.accessToken(), false)
    const workspace = await this.coordinator.workspaceForSession(sessionId)
    const store = new DurableSessionStore(this.root, material.session.roomId, material.keyVersion)
    const request = (body: Record<string, unknown>) => this.gateway.post("/collab/v2/checkpoint", { sessionId, ...body })
    const checkpoints = new SessionCheckpointClient({ sessionId, projectId: binding.projectId, roomId: material.session.roomId,
      role: authority.role, keyVersion: material.keyVersion, roomKeyBase64: material.roomKeyBase64, store, request })
    const runtime = new CollaborationSessionRuntime({ sessionId, role: authority.role, session: material.session, offline,
      encryption: material, store, checkpoints, refreshSession: () => this.keys.descriptor(binding.projectId, sessionId),
      claimFile: async fileId => await request({ operation: "file.claim", fileId }) as { lease?: FileInitializationLease; sequence?: number; waiting?: boolean },
      readBaseFile: relative => this.coordinator.readBaseFile(sessionId, relative),
      shouldTrackExternal: relative => this.coordinator.shouldTrackExternal(sessionId, relative),
      changedPaths: () => this.coordinator.changedPaths(sessionId),
      externalChanges: () => this.coordinator.externalChanges(sessionId),
      beforeReplay: async (acknowledgedUpdate, canonicalState) => {
        const previous = []
        for (const version of await this.keys.versions(sessionId)) {
          if (version >= material.keyVersion) continue
          const key = await this.keys.recoverKey(binding.projectId, sessionId, version)
          if (key) previous.push(key)
        }
        await migrateSessionKeyRecovery({ root: this.root, projectId: binding.projectId, sessionId, roomId: material.session.roomId, next: material, previous, acknowledgedUpdate, canonicalState, role: authority.role,
          claimFile: async fileId => await request({ operation: "file.claim", fileId }) as { lease?: FileInitializationLease; sequence?: number; waiting?: boolean } })
      },
      projection: { root: workspace.projectRootPath, recoveryRoot: path.join(this.root, "retained", createHash("sha256").update(sessionId).digest("hex")) },
      onPublication: (_sha, sequence) => {
        const hosted = this.sessions.get(sessionId)
        if (!hosted) return
        hosted.publication = hosted.publication.catch(() => {}).then(async () => {
          await runtime.waitForSequence(sequence)
          await runtime.projectFiles()
          const sharedPaths = runtime.files.files().flatMap(file => [file.path, ...(file.originalPath ? [file.originalPath] : [])])
          await this.coordinator.adoptPublished(sessionId, await this.gateway.accessToken(), sharedPaths)
          await runtime.checkpointPublished(sequence)
          this.changed(sessionId)
        })
        void hosted.publication.catch(error => runtime.reportRecoveryError(error))
      },
      onAuthorityFailure: () => { void this.suspendLocal(sessionId).catch(error => runtime.reportRecoveryError(error)) },
      onRecoveryRequired: () => { const hosted = this.sessions.get(sessionId); if (hosted) hosted.recoveryRequired = true },
    })
    const hosted: HostedSession = { runtime, projectId: binding.projectId, unsubscribe: runtime.subscribe(() => this.changed(sessionId)),
      timer: setInterval(() => {
        if (this.shuttingDown || hosted.maintenance || !hosted.ready) return
        let restart = false
        hosted.maintenance = (async () => {
          const liveAuthority = await this.gateway.post<CollaborationWorkspaceAuthority>("/collab/v2/workspace-context", { sessionId })
          if (liveAuthority.role !== authority.role) { restart = true; return }
          const refreshed = await this.keys.descriptor(binding.projectId, sessionId)
          if (hosted.recoveryRequired || refreshed.encryption.activeKeyVersion !== material.keyVersion) { restart = true; return }
          if (offline) {
            await runtime.reconnectAuthorized(refreshed)
            offline = false
          }
          await this.control("heartbeatParticipant", { sessionId })
          if (liveAuthority.session.publishedCommitSha) {
            const local = await this.coordinator.getBinding(sessionId)
            if (local?.baseCommitSha !== liveAuthority.session.publishedCommitSha) {
              await runtime.waitForSequence(liveAuthority.session.publishedThroughSequence)
              await runtime.projectFiles()
              await this.coordinator.adoptPublished(sessionId, await this.gateway.accessToken(), runtime.files.files().flatMap(file => [file.path, ...(file.originalPath ? [file.originalPath] : [])]))
            }
            await runtime.checkpointPublished(liveAuthority.session.publishedThroughSequence)
          }
          if (authority.role === "editor") {
            const rotation = await this.keys.rotationStatus(sessionId)
            if (rotation.required) {
              const next = await this.keys.prepareRotation(binding.projectId, sessionId)
              if (!next) { runtime.reportRecoveryError(new Error("Waiting for an authorized editor to finish room key rotation")); return }
              const rotatedRequest = (body: Record<string, unknown>) => request({ ...body, rotation: true, keyVersion: next.keyVersion })
              const inspected = await request({ operation: "inspect" }) as { headSequence: number }
              const frozen = await runtime.frozenCheckpoint(inspected.headSequence)
              const rotationClient = new SessionCheckpointClient({ sessionId, projectId: binding.projectId, roomId: next.session.roomId,
                ...next, role: "editor", store: new DurableSessionStore(this.root, next.session.roomId, next.keyVersion), request: rotatedRequest })
              // Claim/finalize is idempotent if GitHub/Convex or the room reply is
              // lost. Activation happens only after the room checkpoint is durable.
              await rotationClient.checkpoint(frozen.sequence, frozen.update)
              const status = await this.keys.rotationStatus(sessionId)
              restart = !status.required && status.currentKeyVersion === next.keyVersion
            } else await this.keys.supplyWaitingDevices(sessionId, material.roomKeyBase64, material.keyVersion)
          }
        })().finally(() => {
          hosted.maintenance = null
          if (restart && !this.shuttingDown && hosted.ready) void this.restartSession(sessionId, sourceWorkspaceId).catch(error => runtime.reportRecoveryError(error))
        })
        void hosted.maintenance.catch(error => runtime.reportRecoveryError(error))
      }, 15_000), maintenance: null, publication: Promise.resolve(), ready: false, recoveryRequired: false }
    this.sessions.set(sessionId, hosted)
    try {
      const ready = await runtime.start()
      if (!ready) { await this.suspendLocal(sessionId); return false }
      await runtime.readyForWorkspace()
      if (offline) await this.coordinator.resumeOffline(sessionId, sourceWorkspaceId, true)
      else {
        await this.coordinator.activate(sessionId, await this.gateway.accessToken())
        await this.coordinator.adoptPublished(sessionId, await this.gateway.accessToken(), runtime.files.files().flatMap(file => [file.path, ...(file.originalPath ? [file.originalPath] : [])]))
      }
      await this.coordinator.recordRecoveryKey(sessionId, material.keyVersion)
      await activateNativeWorkspaceRoot(workspace.projectRootPath)
      hosted.ready = true
      return true
    } catch (error) { await this.suspendLocal(sessionId); throw error }
  }

  private async restartSession(sessionId: string, sourceWorkspaceId: string): Promise<void> {
    const hosted = this.sessions.get(sessionId)
    if (!hosted) return
    hosted.ready = false
    clearInterval(hosted.timer)
    await this.stopWorkspaceActions(await this.coordinator.suspendActions(sessionId))
    await hosted.maintenance?.catch(() => {})
    await hosted.publication.catch(() => {})
    await hosted.runtime.stop()
    hosted.unsubscribe(); this.sessions.delete(sessionId)
    this.changed(sessionId)
    await this.open(sessionId, sourceWorkspaceId)
  }

  async prepareCommit(input: { sessionId: string; binaryPaths: string[]; binaryReviews?: CollaborationBinarySelection[]; message: string; authorName: string; authorEmail: string }): Promise<PreparedCollaborationCommit> {
    const runtime = this.runtime(input.sessionId)
    await this.control("acquireCommitLease", { sessionId: input.sessionId })
    let renewalError: unknown = null
    let renewing = false
    const timer = setInterval(() => {
      if (renewing) return
      renewing = true
      void this.control("renewCommitLease", { sessionId: input.sessionId }).catch(error => { renewalError = error }).finally(() => { renewing = false })
    }, 15_000)
    try {
      const snapshot = await runtime.captureCommit()
      if (renewalError) throw new Error("Commit lease could not be renewed; local edits remain recoverable")
      const prepared = await this.coordinator.prepareCommit({ ...input, accessToken: await this.gateway.accessToken(), throughSequence: snapshot.sequence, textChanges: snapshot.textChanges })
      await this.control("markLocalCommitReady", { sessionId: input.sessionId, commitSha: prepared.commitSha, coveredThroughSequence: prepared.throughSequence })
      return prepared
    } finally { clearInterval(timer) }
  }

  async push(input: { sessionId: string; commitSha: string }): Promise<PreparedCollaborationCommit> {
    const { sessionId, commitSha } = input
    this.runtime(sessionId)
    const prepared = await this.coordinator.getPrepared(sessionId)
    if (!prepared || prepared.commitSha !== commitSha) throw new Error("The prepared commit changed; review the exact commit before pushing")
    // A completed publication can be recovered without acquiring a new lease.
    try { return await this.coordinator.pushPrepared(sessionId, await this.gateway.accessToken()) } catch { /* Reauthorize the exact prepared identity below. */ }
    if (prepared.state === "discarded") throw new Error("This prepared commit was discarded")
    let session = await this.control<CollaborationSessionDescriptor>("getSession", { sessionId })
    if (!session) throw new Error("Session was not found")
    if (!session.pendingCommitSha && ["active", "commit_preparing"].includes(session.status) && session.baseCommitSha === prepared.parentCommitSha) {
      await this.control("acquireCommitLease", { sessionId })
      session = await this.control("markLocalCommitReady", { sessionId, commitSha: prepared.commitSha, coveredThroughSequence: prepared.throughSequence })
    } else session = await this.control<CollaborationSessionDescriptor>("recoverPreparedLease", { sessionId, commitSha: prepared.commitSha, coveredThroughSequence: prepared.throughSequence })
    if (session.status === "local_commit_ready") await this.control("beginPush", { sessionId })
    const timer = setInterval(() => { void this.control("renewCommitLease", { sessionId }).catch(() => {}) }, 15_000)
    try { return await this.coordinator.pushPrepared(sessionId, await this.gateway.accessToken()) }
    finally { clearInterval(timer) }
  }

  async discard(sessionId: string): Promise<void> {
    await this.coordinator.discardPrepared(sessionId, await this.gateway.accessToken())
    await this.control("releaseCommitLease", { sessionId })
    this.changed(sessionId)
  }

  private readonly suspending = new Map<string, Promise<void>>()
  private suspendLocal(sessionId: string): Promise<void> {
    const previous = this.suspending.get(sessionId)
    if (previous) return previous
    const operation = (async () => {
      const hosted = this.sessions.get(sessionId)
      if (hosted) { hosted.ready = false; clearInterval(hosted.timer) }
      await this.stopWorkspaceActions(await this.coordinator.suspendActions(sessionId))
      if (hosted) {
        await hosted.maintenance?.catch(() => {})
        await hosted.publication.catch(() => {})
        await hosted.runtime.stop()
        hosted.unsubscribe()
        if (this.sessions.get(sessionId) === hosted) this.sessions.delete(sessionId)
      }
      await this.coordinator.restoreSourceFocus(sessionId)
      this.changed(sessionId)
    })().finally(() => this.suspending.delete(sessionId))
    this.suspending.set(sessionId, operation)
    return operation
  }

  async leave(sessionId: string, end: boolean): Promise<void> {
    if (end) await this.control("closeSession", { sessionId })
    const hosted = this.sessions.get(sessionId)
    if (hosted) { hosted.ready = false; clearInterval(hosted.timer) }
    const workspaceId = await this.coordinator.suspendActions(sessionId)
    try { await this.stopWorkspaceActions(workspaceId) }
    catch (error) { hosted?.runtime.reportRecoveryError(error); throw error }
    if (hosted) {
      clearInterval(hosted.timer)
      await hosted.maintenance?.catch(() => {})
      await hosted.publication.catch(() => {})
      await hosted.runtime.stop()
      hosted.unsubscribe(); this.sessions.delete(sessionId)
    }
    await this.coordinator.leave(sessionId, end)
    if (!end) await this.control("leaveSession", { sessionId }).catch(() => {})
    this.changed(sessionId)
  }

  async recoveryInventory(): Promise<CollaborationRecoveryInventory> {
    return { ...await inventoryRecoveryStorage(this.root), limitBytes: COLLABORATION_RECOVERY_LIMIT_BYTES, roomLimitBytes: COLLABORATION_ROOM_RECOVERY_LIMIT_BYTES }
  }

  cleanupRecovery(sessionId: string): Promise<CollaborationRecoveryCleanupResult> {
    if (this.shuttingDown) return Promise.reject(new Error("Session recovery is being saved before quit"))
    // A queued Start cannot persist a new basis between inventory and deletion.
    const operation = this.openTail.catch(() => {}).then(() => this.compactRecovery(sessionId))
    this.openTail = operation
    return operation
  }

  private async compactRecovery(sessionId: string): Promise<CollaborationRecoveryCleanupResult> {
    const binding = await this.coordinator.getBinding(sessionId)
    if (!binding || binding.generation !== 3) throw new Error("Catalog-owned session recovery is unavailable")
    const policy = await this.coordinator.bindingForWorkspace(binding.workspaceId)
    if (policy?.sessionId !== sessionId || policy.projectId !== binding.projectId) throw new Error("Recovery workspace association is invalid")
    const versions = await this.keys.versions(sessionId)
    if (versions.length > 64) throw new Error("Recovery cleanup exceeds its bounded key inventory; all data was retained")
    const result = { files: 0, bytes: 0 }
    const keys = []
    for (const version of versions) {
      const key = await this.keys.recoverKey(binding.projectId, sessionId, version)
      if (!key) continue
      keys.push(key)
      const cleaned = await compactVerifiedRecoveryStore({ root: this.root, roomId: key.session.roomId, projectId: binding.projectId, sessionId, keyVersion: key.keyVersion, roomKeyBase64: key.roomKeyBase64 })
      result.files += cleaned.files; result.bytes += cleaned.bytes
    }
    // Failed owners remain in sessions until fully stopped, so they also pin bases.
    if (!this.sessions.has(sessionId) && keys.length === versions.length) {
      const current = await this.keys.recoverKey(binding.projectId, sessionId)
      if (current) {
        const cleaned = await compactQuiescentInitializationBases({ root: this.root, projectId: binding.projectId, sessionId, current, keys })
        result.files += cleaned.files; result.bytes += cleaned.bytes
        const retired = await this.keys.retireUnusedVersions(sessionId, current.keyVersion, cleaned.unusedKeyVersions)
        result.files += retired.files; result.bytes += retired.bytes
      }
    }
    return result
  }

  async retry(sessionId: string): Promise<void> {
    const hosted = this.sessions.get(sessionId)
    if (hosted?.ready) { await hosted.runtime.retry(); return }
    const binding = await this.coordinator.getBinding(sessionId)
    if (!binding) throw new Error("Session recovery is unavailable")
    if (hosted) await this.restartSession(sessionId, binding.sourceWorkspaceId)
    else await this.open(sessionId, binding.sourceWorkspaceId)
  }

  shutdown(): Promise<void> {
    if (this.shutdownInFlight) return this.shutdownInFlight
    this.shuttingDown = true
    const operation = (async () => {
      // A join already in flight must finish before taking the shutdown census.
      // No new open or maintenance-triggered restart may enter after this fence.
      await this.openTail.catch(() => {})
      await Promise.allSettled(this.opening.values())
      for (const hosted of this.sessions.values()) { hosted.ready = false; clearInterval(hosted.timer) }
      await Promise.allSettled([...this.sessions.values()].flatMap(hosted => hosted.maintenance ? [hosted.maintenance] : []))
      for (const [sessionId, hosted] of this.sessions) {
        await this.stopWorkspaceActions(await this.coordinator.suspendActions(sessionId))
        await hosted.publication.catch(() => {})
        await hosted.runtime.stop()
        hosted.unsubscribe()
        // Successful hosts are removed individually. A later failure must not
        // cause the next quit attempt to stop a destroyed CRDT owner twice.
        if (this.sessions.get(sessionId) === hosted) this.sessions.delete(sessionId)
      }
    })()
    this.shutdownInFlight = operation
    void operation.then(() => { this.shutdownInFlight = null }, () => { this.shutdownInFlight = null; this.shuttingDown = false })
    return operation
  }
}
